import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";
import { describeDiff, type MemoDiff } from "@/lib/memo-changes";

/** Правки одного человека подряд (с паузами меньше этого) — один «сеанс»: одна строка журнала и одно уведомление. */
export const SESSION_MS = 15 * 60 * 1000;

type Who = { id: string; name: string; role: string };
type CycleRef = { id: string; number: number; directorateId: string | null };

const zero: MemoDiff = { changed: 0, added: 0, removed: 0, hidden: 0, shown: 0, title: false, meeting: false };
const sum = (a: MemoDiff, b: MemoDiff): MemoDiff => ({
  changed: a.changed + b.changed,
  added: a.added + b.added,
  removed: a.removed + b.removed,
  hidden: a.hidden + b.hidden,
  shown: a.shown + b.shown,
  title: a.title || b.title,
  meeting: a.meeting || b.meeting,
});
const parse = (s: string | null): MemoDiff => {
  try {
    return { ...zero, ...(JSON.parse(s ?? "{}") as Partial<MemoDiff>) };
  } catch {
    return zero;
  }
};

/**
 * Директорам дирекции (кроме самого автора) — о том, что справку трогал кто-то другой.
 * Директора в дирекции нет (только завели или он ушёл) — узнают админы: иначе о правках не узнает никто.
 */
export async function notifyDirectors(who: Who, cycle: CycleRef, message: string): Promise<void> {
  if (who.role === "DIRECTOR" || !cycle.directorateId) return; // директор правит свою справку — себя не уведомляем
  const hasDirector = (await prisma.user.count({ where: { directorateId: cycle.directorateId, role: "DIRECTOR", isActive: true } })) > 0;
  const to = await prisma.user.findMany({
    where: hasDirector ? { directorateId: cycle.directorateId, role: "DIRECTOR", isActive: true, id: { not: who.id } } : { role: "ADMIN", isActive: true, id: { not: who.id } },
    select: { id: true },
  });
  for (const d of to) await createNotification({ userId: d.id, type: "CHANGE_ATTENTION", message, link: "/operativka", directorateId: cycle.directorateId });
}

/**
 * Журнал правок справки: сеанс одного человека — одна запись (`before` — начало сеанса, `after` — накопленные изменения).
 * В начале сеанса директору уходит уведомление, если правит не он. Возвращает true, если начат новый сеанс.
 */
export async function logMemoEdit(who: Who, cycle: CycleRef, diff: MemoDiff, now = new Date()): Promise<boolean> {
  const last = await prisma.auditEvent.findFirst({
    where: { entityType: "Memo", entityId: cycle.id, actorId: who.id, fieldName: "draft", timestamp: { gte: new Date(now.getTime() - SESSION_MS) } },
    orderBy: { timestamp: "desc" },
  });
  if (last) {
    await prisma.auditEvent.update({ where: { id: last.id }, data: { after: JSON.stringify(sum(parse(last.after), diff)), timestamp: now } });
    return false;
  }
  await prisma.auditEvent.create({ data: { entityType: "Memo", entityId: cycle.id, actorId: who.id, action: "UPDATE", fieldName: "draft", before: now.toISOString(), after: JSON.stringify(diff) } });
  await notifyDirectors(who, cycle, `${who.name} правит черновик справки (оперативка №${cycle.number}): ${describeDiff(diff)}. Изменённые пункты отмечены в справке.`);
  return true;
}

/** Событие справки целиком (сборка начата, отправлена ЗГД) — в журнал и директору, если это сделал не он. */
export async function logMemoEvent(who: Who, cycle: CycleRef, kind: "review" | "sent", message: string): Promise<void> {
  await prisma.auditEvent.create({ data: { entityType: "Memo", entityId: cycle.id, actorId: who.id, action: "UPDATE", fieldName: kind, before: new Date().toISOString() } });
  await notifyDirectors(who, cycle, message);
}

export type MemoLogEntry = { id: string; who: string; kind: "draft" | "review" | "sent"; from: string; to: string; summary: string };

/** История правок справки для показа в редакторе: новые сверху. */
export async function memoHistory(cycleId: string): Promise<MemoLogEntry[]> {
  const rows = await prisma.auditEvent.findMany({
    where: { entityType: "Memo", entityId: cycleId },
    orderBy: { timestamp: "desc" },
    take: 100,
    select: { id: true, fieldName: true, before: true, after: true, timestamp: true, actor: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    who: r.actor?.name ?? "—",
    kind: r.fieldName === "review" ? "review" : r.fieldName === "sent" ? "sent" : "draft",
    from: r.before ?? r.timestamp.toISOString(),
    to: r.timestamp.toISOString(),
    summary: r.fieldName === "review" ? "начал сборку" : r.fieldName === "sent" ? "отправил справку ЗГД" : describeDiff(parse(r.after)),
  }));
}
