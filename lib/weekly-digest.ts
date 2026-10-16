import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";
import type { SignalKind } from "@/lib/ai-table";
import { columnOf, type TrackerColumnKey, type TrackerEvent } from "@/lib/tracker";

/**
 * Сводка за неделю (понедельник, вместе с напоминаниями о сроках): ЗГД — по его поручениям и задачам на контроле
 * (только подтверждённое директором), директору — что ждёт его решения. Одно уведомление на человека, пустых не шлём.
 */
const DAY = 24 * 3600 * 1000;
const STOP_LONG_DAYS = 7;

export type DigestItem = {
  id: string;
  column: TrackerColumnKey;
  kinds: SignalKind[];
  blockedBy: string | null;
  /** События задачи (журнал у директора, подтверждения — у ЗГД): из них — когда приняли и с какого дня на стопе. */
  events: TrackerEvent[];
};

const lastAt = (events: TrackerEvent[], test: (e: TrackerEvent) => boolean) => events.filter(test).map((e) => new Date(e.at).getTime()).sort((a, b) => b - a)[0] ?? null;
const accepted = (e: TrackerEvent) => e.kind === "workflow" && /^(принят|принял)/.test(e.text);
const stopped = (e: TrackerEvent) => e.kind === "workflow" && /^(на стопе|поставил\(а\) на стоп)/.test(e.text);
const n = (x: number, one: string, few: string, many: string) => {
  const a = x % 10, b = x % 100;
  return `${x} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`;
};
const join = (parts: Array<string | null>) => parts.filter(Boolean).join("; ");

/** ЗГД: что с его поручениями и задачами на контроле за неделю. null — сказать нечего. */
export function zgdDigest(items: DigestItem[], now: Date): string | null {
  if (!items.length) return null;
  const weekAgo = now.getTime() - 7 * DAY;
  const done = items.filter((i) => i.column === "DONE" && (lastAt(i.events, accepted) ?? 0) >= weekAgo).length;
  const open = items.filter((i) => i.column !== "DONE" && i.column !== "HIDDEN");
  const overdue = open.filter((i) => i.kinds.includes("overdue")).length;
  const slipped = open.filter((i) => i.kinds.includes("slipped")).length;
  const stop = open.filter((i) => !!i.blockedBy).length;
  const waiting = open.filter((i) => i.kinds.includes("request")).length;
  const body = join([
    done ? `принято за неделю — ${done}` : null,
    overdue ? `просрочено — ${overdue}` : null,
    slipped ? `исходный срок сорван — ${slipped}` : null,
    stop ? `на стопе — ${stop}` : null,
    waiting ? `ждут ответа директора на ваш запрос — ${waiting}` : null,
  ]);
  if (!body && !open.length) return null;
  return `Сводка за неделю: в работе ${n(open.length, "ваша задача", "ваши задачи", "ваших задач")} (поручения и на контроле)${body ? `; ${body}` : " — без отклонений"}.`;
}

/** Директор: что ждёт его решения. null — ничего не ждёт. */
export function directorDigest(items: DigestItem[], now: Date): string | null {
  const open = items.filter((i) => i.column !== "DONE" && i.column !== "HIDDEN");
  const review = open.filter((i) => i.column === "REVIEW").length;
  const moves = open.filter((i) => i.kinds.includes("deadlineRequest")).length;
  const requests = open.filter((i) => i.kinds.includes("request")).length;
  const longStop = open.filter((i) => i.blockedBy && (lastAt(i.events, stopped) ?? now.getTime()) <= now.getTime() - STOP_LONG_DAYS * DAY).length;
  const overdue = open.filter((i) => i.kinds.includes("overdue")).length;
  const body = join([
    review ? `ждут вашей приёмки — ${review}` : null,
    moves ? `просьбы о переносе срока — ${moves}` : null,
    requests ? `запросы ЗГД без ответа — ${requests}` : null,
    longStop ? `на стопе дольше недели — ${longStop}` : null,
    overdue ? `просрочено — ${overdue}` : null,
  ]);
  return body ? `Сводка за неделю: ${body}.` : null;
}

/** Понедельник по Москве. */
export const isMondayMsk = (now: Date) => new Date(now.getTime() + 3 * 3600 * 1000).getUTCDay() === 1;

async function sentRecently(userId: string, now: Date): Promise<boolean> {
  return !!(await prisma.notification.findFirst({ where: { userId, type: "WEEKLY_UPDATE_DUE", createdAt: { gte: new Date(now.getTime() - 6 * DAY) } }, select: { id: true } }));
}

const byItem = (events: TrackerEvent[]) => {
  const m = new Map<string, TrackerEvent[]>();
  for (const e of events) m.set(e.itemId, [...(m.get(e.itemId) ?? []), e]);
  return m;
};

/** Разослать сводки (вызывает ежедневный cron по понедельникам; повторный запуск в ту же неделю ничего не шлёт). */
export async function sendWeeklyDigests(now: Date = new Date()): Promise<{ zgd: number; directors: number }> {
  // загрузчики трекера тянут много зависимостей — подключаем только когда сводки действительно собираем
  const { loadTracker, loadSentTracker } = await import("@/lib/tracker-load");
  const { directorsOf } = await import("@/lib/workflow-server");
  let zgd = 0;
  let directors = 0;

  // директорам — по живым данным своей дирекции
  const dirs = await prisma.directorate.findMany({ where: { isActive: true }, select: { id: true } });
  for (const d of dirs) {
    const t = await loadTracker(d.id);
    const cols = new Map(t.statuses.map((s) => [s.id, s.trackerColumn]));
    const ev = byItem(t.events);
    const items: DigestItem[] = t.rows.map((r) => ({ id: r.id, column: columnOf(r.statusId, cols), kinds: (t.hot[r.id]?.kinds ?? []) as SignalKind[], blockedBy: r.blockedBy, events: ev.get(r.id) ?? [] }));
    const text = directorDigest(items, now);
    if (!text) continue;
    const link = items.some((i) => i.column === "REVIEW") ? "/tracker?kind=review" : "/tracker";
    for (const uid of await directorsOf(d.id)) {
      if (await sentRecently(uid, now)) continue;
      await createNotification({ userId: uid, type: "WEEKLY_UPDATE_DUE", message: text, link, directorateId: d.id });
      directors++;
    }
  }

  // ЗГД — по подтверждённому директорами: его поручения и задачи на контроле
  const executives = await prisma.user.findMany({ where: { role: "EXECUTIVE", isActive: true }, select: { id: true } });
  if (executives.length) {
    const t = await loadSentTracker();
    const cols = new Map(t.statuses.map((s) => [s.name, s.trackerColumn]));
    const ev = byItem(t.events);
    const rows = t.rows as unknown as Array<{ id: string; statusName: string | null; origin: string | null; assignedById?: string | null; zgdControl: boolean; blockedBy: string | null }>;
    for (const u of executives) {
      const mine = rows.filter((r) => (r.origin === "ZGD" && r.assignedById === u.id) || r.zgdControl);
      const items: DigestItem[] = mine.map((r) => ({ id: r.id, column: (r.statusName ? cols.get(r.statusName) : null) ?? "TODO", kinds: (t.hot[r.id]?.kinds ?? []) as SignalKind[], blockedBy: r.blockedBy, events: ev.get(r.id) ?? [] }));
      const text = zgdDigest(items, now);
      if (!text || (await sentRecently(u.id, now))) continue;
      const link = mine.some((r) => r.origin === "ZGD" && r.assignedById === u.id) ? "/tracker?scope=mine" : "/tracker?scope=control";
      await createNotification({ userId: u.id, type: "WEEKLY_UPDATE_DUE", message: text, link });
      zgd++;
    }
  }
  return { zgd, directors };
}
