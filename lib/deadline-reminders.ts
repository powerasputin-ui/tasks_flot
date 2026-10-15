import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";
import { loadColumnLabels } from "@/lib/column-labels";
import { PROTECTED_STATUSES } from "@/lib/statuses";

/**
 * Напоминания по срокам позиций (раз в день, тем же cron, что и «не подал»):
 * ответственному — за 2 дня до срока и в первый день просрочки; директору и админу дирекции — сводка новых просрочек.
 * Не напоминаем по удалённым, без срока, без ответственного и по закрытым статусам («Завершено», «Не актуально»).
 */

export const SOON_DAYS = 2;
const DAY = 86400000;

/** День по Москве (полночь UTC этого дня) — срок хранится датой без времени (полночь UTC), сервер живёт в UTC. */
export function mskDay(now: Date): number {
  const msk = new Date(now.getTime() + 3 * 3600 * 1000);
  return Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate());
}

const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export type ReminderItem = {
  id: string;
  title: string;
  deadline: Date | null;
  responsibleId: string | null;
  statusName: string | null;
  archived: boolean;
  directorateId: string | null;
  /** Колонка трекера: «Выполнено» / «Не показывать» — закрыта; «На проверке» — ждёт директора. */
  column?: string | null;
};

/** Кому и о чём напомнить сегодня: «скоро срок» (через SOON_DAYS дня) и «просрочено со вчера». */
export function pickDeadlineReminders<T extends ReminderItem>(items: T[], now: Date): { soon: T[]; overdue: T[] } {
  const today = mskDay(now);
  const soon: T[] = [];
  const overdue: T[] = [];
  for (const i of items) {
    if (i.archived || !i.deadline || !i.responsibleId) continue;
    if (i.statusName && PROTECTED_STATUSES.includes(i.statusName)) continue;
    if (i.column === "DONE" || i.column === "HIDDEN") continue;
    const diff = Math.round((dayOf(i.deadline) - today) / DAY);
    // сдана на проверку: торопить исполнителя незачем — «скоро срок» не шлём, просрочка идёт директору в сводку
    if (diff === SOON_DAYS && i.column !== "REVIEW") soon.push(i);
    else if (diff === -1) overdue.push(i);
  }
  return { soon, overdue };
}

const ru = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "UTC" });
const short = (t: string) => (t.length > 80 ? `${t.slice(0, 80)}…` : t);

/** Отправить сегодняшние напоминания. Повторный запуск в тот же день ничего не дублирует. */
export async function sendDeadlineReminders(now: Date = new Date()): Promise<{ soon: number; overdue: number; summaries: number }> {
  const today = mskDay(now);
  const from = new Date(today - DAY);
  const to = new Date(today + (SOON_DAYS + 1) * DAY);
  const rows = await prisma.operationalItem.findMany({
    where: { archivedAt: null, responsibleId: { not: null }, deadline: { gte: from, lt: to } },
    select: { id: true, title: true, deadline: true, responsibleId: true, directorateId: true, status: { select: { name: true, trackerColumn: true } } },
  });
  const items: ReminderItem[] = rows.map((r) => ({ id: r.id, title: r.title, deadline: r.deadline, responsibleId: r.responsibleId, statusName: r.status?.name ?? null, archived: false, directorateId: r.directorateId, column: r.status?.trackerColumn ?? null }));
  const { soon, overdue } = pickDeadlineReminders(items, now);
  if (soon.length + overdue.length === 0) return { soon: 0, overdue: 0, summaries: 0 };

  // антидубль: такое же уведомление по этой позиции за последние 20 часов (cron раз в сутки) второй раз не шлём
  const since = new Date(Date.now() - 20 * 3600 * 1000);
  const already = await prisma.notification.findMany({
    where: { type: { in: ["DEADLINE_SOON", "DEADLINE_OVERDUE"] }, createdAt: { gte: since } },
    select: { userId: true, type: true, link: true },
  });
  const sent = (userId: string, type: string, itemId: string) => already.some((n) => n.userId === userId && n.type === type && (n.link ?? "").includes(`item=${itemId}`));

  const labels = new Map<string, string>();
  const word = async (dir: string | null) => {
    const key = dir ?? "";
    if (!labels.has(key)) labels.set(key, dir ? (await loadColumnLabels(dir)).deadline.toLowerCase() : "срок");
    return labels.get(key)!;
  };

  let soonSent = 0;
  for (const i of soon) {
    if (sent(i.responsibleId!, "DEADLINE_SOON", i.id)) continue;
    await createNotification({
      userId: i.responsibleId!,
      type: "DEADLINE_SOON",
      message: `Через ${SOON_DAYS} дня ${await word(i.directorateId)} по «${short(i.title)}» — ${ru(i.deadline!)}`,
      link: `/table?item=${i.id}`,
      directorateId: i.directorateId,
    });
    soonSent++;
  }

  let overdueSent = 0;
  const fresh: ReminderItem[] = [];
  for (const i of overdue) {
    // на проверке — ждёт решения директора: исполнителю не пишем, директор увидит в сводке
    if (i.column === "REVIEW") {
      fresh.push(i);
      continue;
    }
    if (sent(i.responsibleId!, "DEADLINE_OVERDUE", i.id)) continue;
    await createNotification({
      userId: i.responsibleId!,
      type: "DEADLINE_OVERDUE",
      message: `Просрочен ${await word(i.directorateId)} по «${short(i.title)}» (${ru(i.deadline!)}) — обновите статус или ${await word(i.directorateId)}`,
      link: `/table?item=${i.id}`,
      directorateId: i.directorateId,
    });
    overdueSent++;
    fresh.push(i);
  }

  // сводка новых просрочек директорам и админам дирекции — одним сообщением
  let summaries = 0;
  const byDir = new Map<string, ReminderItem[]>();
  for (const i of fresh) if (i.directorateId) byDir.set(i.directorateId, [...(byDir.get(i.directorateId) ?? []), i]);
  // сводка — без ссылки на позицию; сданные на проверку не помечаются личным напоминанием, поэтому при повторном
  // запуске в тот же день их не повторяем тому, кто сводку уже получил
  const summarized = (userId: string) => already.some((n) => n.userId === userId && n.type === "DEADLINE_OVERDUE" && !(n.link ?? "").includes("item="));
  for (const [dir, all] of byDir) {
    const leads = await prisma.user.findMany({ where: { directorateId: dir, role: { in: ["DIRECTOR", "ADMIN"] }, isActive: true }, select: { id: true } });
    for (const l of leads) {
      const list = summarized(l.id) ? all.filter((i) => i.column !== "REVIEW") : all;
      if (!list.length) continue;
      if (list.every((i) => i.responsibleId === l.id && i.column !== "REVIEW")) continue; // свои просрочки он уже получил лично
      const names = list.slice(0, 3).map((i) => `«${short(i.title)}»`).join(", ") + (list.length > 3 ? ` и ещё ${list.length - 3}` : "");
      await createNotification({
        userId: l.id,
        type: "DEADLINE_OVERDUE",
        message: `Просрочено со вчерашнего дня: ${list.length} ${list.length === 1 ? "позиция" : list.length < 5 ? "позиции" : "позиций"} — ${names}${list.some((i) => i.column === "REVIEW") ? " (часть уже сдана и ждёт вашей приёмки)" : ""}`,
        link: "/table",
        directorateId: dir,
      });
      summaries++;
    }
  }
  return { soon: soonSent, overdue: overdueSent, summaries };
}
