import { prisma } from "@/lib/prisma";
import { createNotification, withDirectorate } from "@/lib/notifications";

/** Повторные правки одной позиции одним человеком в течение этого времени — одно уведомление (обновляется). */
export const ITEM_NOTIFY_MS = 30 * 60 * 1000;

const LABEL: Record<string, string> = {
  title: "задача",
  cost: "оценка",
  comment: "комментарий",
  segmentId: "сегмент",
  trackId: "трек",
  attractivenessId: "привлекательность",
  responsibleId: "ответственный",
  deadline: "срок",
  statusId: "статус",
  operFlag: "отправка директору",
  customValues: "свои столбцы",
  files: "файлы",
};

const same = (a: unknown, b: unknown) => (a instanceof Date || b instanceof Date ? String(a && new Date(a as Date).getTime()) === String(b && new Date(b as Date).getTime()) : JSON.stringify(a ?? null) === JSON.stringify(b ?? null));

/** Какие поля позиции поменялись — человеческими словами. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(LABEL).filter((k) => !same(before[k], after[k])).map((k) => LABEL[k]);
}

/**
 * Позицию изменил не её ответственный (директор, админ) — ответственному уходит уведомление «кто и что поменял».
 * Серия правок одного человека за ITEM_NOTIFY_MS — одно уведомление: непрочитанное обновляется, а не множится.
 */
export async function notifyOwnerOfEdit(
  actor: { id: string; name?: string },
  item: { id: string; title: string; responsibleId: string | null; directorateId?: string | null },
  what: string,
  now = new Date()
): Promise<void> {
  if (!item.responsibleId || item.responsibleId === actor.id) return;
  const who = actor.name ?? "Кто-то";
  const link = withDirectorate(`/table?item=${item.id}`, item.directorateId) ?? "";
  const message = `${who} ${what} вашу позицию «${item.title.slice(0, 120)}»`;
  const recent = await prisma.notification.findFirst({
    where: { userId: item.responsibleId, type: "CHANGE_ATTENTION", link, isRead: false, message: { startsWith: `${who} ` }, createdAt: { gte: new Date(now.getTime() - ITEM_NOTIFY_MS) } },
    orderBy: { createdAt: "desc" },
  });
  if (recent) await prisma.notification.update({ where: { id: recent.id }, data: { message, createdAt: now } });
  else await createNotification({ userId: item.responsibleId, type: "CHANGE_ATTENTION", message, link });
}

/**
 * Позицию удалили навсегда — об этом должны узнать: директор дирекции (если директора нет — админы) и ответственный,
 * если удалял не он. Иначе позиция исчезла бы бесследно.
 */
export async function notifyPurge(actor: { id: string; name?: string }, item: { title: string; responsibleId: string | null; directorateId: string | null }): Promise<void> {
  if (!item.directorateId) return;
  const directors = await prisma.user.findMany({ where: { directorateId: item.directorateId, role: "DIRECTOR", isActive: true }, select: { id: true } });
  const leads = directors.length ? directors : await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  const to = new Set([...leads.map((u) => u.id), ...(item.responsibleId ? [item.responsibleId] : [])]);
  to.delete(actor.id);
  const message = `${actor.name ?? "Кто-то"} удалил(а) навсегда позицию «${item.title.slice(0, 120)}» — восстановить её нельзя.`;
  for (const userId of to) await createNotification({ userId, type: "CHANGE_ATTENTION", message, link: "/archive", directorateId: item.directorateId });
}
