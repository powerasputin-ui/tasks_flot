import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@prisma/client";

/** Раздел 33 ТЗ: только in-app. */
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

/**
 * Ищет "@Имя Фамилия" в тексте комментария среди реальных пользователей и
 * создаёт им уведомление MENTION (раздел 33: "Вас упомянули"). Сопоставление
 * только по точному совпадению полного имени — без фантазийного NLP.
 */
export async function notifyMentions(params: {
  text: string;
  actorId: string;
  actorName: string;
  entityType: string;
  entityId: string;
  link: string;
}) {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  const mentioned = users.filter((u) => u.id !== params.actorId && params.text.includes(`@${u.name}`));

  await Promise.all(
    mentioned.map((u) =>
      createNotification({
        userId: u.id,
        type: "MENTION",
        message: `${params.actorName} упомянул(а) вас в комментарии`,
        link: params.link,
      })
    )
  );

  return mentioned.length;
}
