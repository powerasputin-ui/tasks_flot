import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@prisma/client";
import { startOfISOWeek } from "date-fns";

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
 * CHANGE_ATTENTION (решение заказчика: "все варианты"). Два триггера:
 *  - Куратор поставил "Опер" -> уведомляется владелец записи;
 *  - статус записи стал "На стопе" -> уведомляются все Кураторы.
 * Автор изменения себя не уведомляет.
 */
export async function notifyOperFlagSet(params: { name: string; ownerId: string | null; actorId: string; link: string }) {
  if (!params.ownerId || params.ownerId === params.actorId) return;
  await createNotification({
    userId: params.ownerId,
    type: "CHANGE_ATTENTION",
    message: `«${params.name}» передана на внимание руководителя (Опер)`,
    link: params.link,
  });
}

export async function notifyStatusChangedToStop(params: {
  statusId: string | null | undefined;
  name: string;
  actorId: string;
  link: string;
}) {
  if (!params.statusId) return;
  const status = await prisma.status.findUnique({ where: { id: params.statusId } });
  if (status?.name !== "На стопе") return;
  const curators = await prisma.user.findMany({ where: { role: "CURATOR", isActive: true, id: { not: params.actorId } } });
  await Promise.all(
    curators.map((c) =>
      createNotification({ userId: c.id, type: "CHANGE_ATTENTION", message: `«${params.name}» переведена в статус «На стопе»`, link: params.link })
    )
  );
}

/**
 * WEEKLY_UPDATE_DUE: владельцам треков без отправленного отчёта за текущую
 * неделю. Идемпотентно — повторный вызов в ту же неделю не дублирует напоминание.
 * Вызывается кнопкой Куратора и/или внешним планировщиком (CRON_SECRET).
 */
export async function remindWeeklyUpdates(): Promise<number> {
  const weekStart = startOfISOWeek(new Date());
  const tracks = await prisma.track.findMany({
    where: {
      archivedAt: null,
      ownerId: { not: null },
      weeklyUpdates: { none: { weekStart, status: "SUBMITTED" } },
    },
    select: { id: true, name: true, ownerId: true },
  });
  const already = await prisma.notification.findMany({
    where: { type: "WEEKLY_UPDATE_DUE", createdAt: { gte: weekStart } },
    select: { userId: true, link: true },
  });
  const sent = new Set(already.map((n) => `${n.userId}|${n.link}`));

  let count = 0;
  for (const t of tracks) {
    const link = `/tracks/${t.id}`;
    if (sent.has(`${t.ownerId}|${link}`)) continue;
    await createNotification({
      userId: t.ownerId!,
      type: "WEEKLY_UPDATE_DUE",
      message: `Заполните еженедельный отчёт по треку «${t.name}»`,
      link,
    });
    count++;
  }
  return count;
}

/**
 * EDIT_REQUEST: любой пользователь просит изменить чужую запись. Получатель —
 * владелец записи, а если владельца нет — все Кураторы.
 */
export async function createEditRequest(params: {
  requesterId: string;
  requesterName: string;
  ownerId: string | null;
  name: string;
  note: string;
  link: string;
}) {
  const recipients = params.ownerId
    ? [params.ownerId]
    : (await prisma.user.findMany({ where: { role: "CURATOR", isActive: true }, select: { id: true } })).map((u) => u.id);
  const targets = recipients.filter((id) => id !== params.requesterId);
  await Promise.all(
    targets.map((userId) =>
      createNotification({
        userId,
        type: "EDIT_REQUEST",
        message: `${params.requesterName} просит изменить «${params.name}»: ${params.note}`,
        link: params.link,
      })
    )
  );
  return targets.length;
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
