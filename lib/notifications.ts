import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@prisma/client";

/** Уведомления — только внутри приложения (без e-mail). Триггеры цикла оперативки — этап 3. */
export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  message: string;
  link?: string;
  /** Дирекция, к которой относится ссылка: админ, работающий сейчас в другой, переключится на неё при переходе. */
  directorateId?: string | null;
}) {
  return prisma.notification.create({
    data: { userId: params.userId, type: params.type, message: params.message, link: withDirectorate(params.link, params.directorateId) },
  });
}

/**
 * Очистка старых уведомлений (ежедневно, cron): прочитанные живут 60 дней, непрочитанные — 180. Иначе таблица растёт без
 * конца, а колокольчик у людей показывает давно неактуальное. scope.userIds — только для проверок.
 */
export const READ_KEEP_DAYS = 60;
export const UNREAD_KEEP_DAYS = 180;
export async function pruneNotifications(now: Date = new Date(), scope?: { userIds: string[] }): Promise<number> {
  const day = 24 * 3600 * 1000;
  const who = scope ? { userId: { in: scope.userIds } } : {};
  const read = await prisma.notification.deleteMany({ where: { ...who, isRead: true, createdAt: { lt: new Date(now.getTime() - READ_KEEP_DAYS * day) } } });
  const unread = await prisma.notification.deleteMany({ where: { ...who, createdAt: { lt: new Date(now.getTime() - UNREAD_KEEP_DAYS * day) } } });
  return read.count + unread.count;
}

/** `/table?item=1` + дирекция → `/table?item=1&dir=…`. */
export function withDirectorate(link: string | undefined, directorateId: string | null | undefined): string | undefined {
  if (!link || !directorateId) return link;
  return `${link}${link.includes("?") ? "&" : "?"}dir=${encodeURIComponent(directorateId)}`;
}
