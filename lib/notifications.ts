import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@prisma/client";

/** Уведомления — только внутри приложения (без e-mail). Триггеры цикла оперативки — этап 3. */
export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  message: string;
  link?: string;
}) {
  return prisma.notification.create({
    data: { userId: params.userId, type: params.type, message: params.message, link: params.link },
  });
}
