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

/** `/table?item=1` + дирекция → `/table?item=1&dir=…`. */
export function withDirectorate(link: string | undefined, directorateId: string | null | undefined): string | undefined {
  if (!link || !directorateId) return link;
  return `${link}${link.includes("?") ? "&" : "?"}dir=${encodeURIComponent(directorateId)}`;
}
