import { prisma } from "@/lib/prisma";
import { getDicts } from "@/lib/dictionaries";
import { recordAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { isDirectorial, type Actor } from "@/lib/permissions";
import { statusForColumn } from "@/lib/tracker";
import { directorsOf, publishItem, wasConfirmed, trackerLink } from "@/lib/workflow-server";
import { canEditItem } from "@/lib/permissions";

/**
 * Действия ЗГД в трекере и ответы на них — всё идёт через директора (иерархия):
 * на контроль, запрос статуса (ответ директора подтверждает состояние для ЗГД), комментарий, поручение.
 * И просьба о переносе срока поручения / задачи на контроле: руководитель просит, директор решает.
 */
export type ZgdResult<T = unknown> = { ok: true; data: T } | { ok: false; status: number; error: string; message?: string };

const fail = (status: number, message: string, error = status === 400 ? "INVALID_INPUT" : status === 404 ? "NOT_FOUND" : "FORBIDDEN"): ZgdResult<never> => ({ ok: false, status, error, message });
const nameOf = async (id: string) => (await getDicts()).users.get(id)?.name ?? "—";
const clip = (s: unknown, max = 2000) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const zgdLink = (id: string) => `/tracker?view=timeline&item=${id}`;

async function zgdItem(actor: Actor, itemId: string) {
  if (actor.role !== "EXECUTIVE") return null;
  return prisma.operationalItem.findFirst({ where: { id: itemId, archivedAt: null, publishedAt: { not: null } } });
}

/** ЗГД берёт задачу на контроль / снимает: директор видит метку, перенос срока — только с его согласия. */
export async function setControl(actor: Actor, itemId: string, on: boolean): Promise<ZgdResult<{ zgdControl: boolean }>> {
  const item = await zgdItem(actor, itemId);
  if (!item) return fail(404, "Задача не найдена.");
  // напрямую, без смены версии и updatedAt: это пометка ЗГД, а не правка дирекции
  await prisma.$executeRaw`UPDATE "operational_items" SET "zgdControl" = ${on} WHERE "id" = ${itemId}`;
  await recordAudit({ entityType: "OperationalItem", entityId: itemId, actorId: actor.id, action: "UPDATE", fieldName: "zgdControl", before: String(item.zgdControl), after: String(on) });
  const who = await nameOf(actor.id);
  for (const uid of await directorsOf(item.directorateId)) await createNotification({ userId: uid, type: "ZGD_COMMENT", message: `${who} ${on ? "взял(а) на контроль" : "снял(а) с контроля"} «${item.title.slice(0, 110)}»`, link: trackerLink(item) });
  return { ok: true, data: { zgdControl: on } };
}

/** ЗГД запрашивает статус: вопрос со сроком ответа — директору дирекции. */
export async function askStatus(actor: Actor, itemId: string, text: unknown, dueAt: Date | null): Promise<ZgdResult<{ id: string }>> {
  const item = await zgdItem(actor, itemId);
  if (!item || !item.directorateId) return fail(404, "Задача не найдена.");
  const q = clip(text, 1000);
  if (q.length < 3) return fail(400, "Напишите, что нужно уточнить.");
  const who = await nameOf(actor.id);
  const r = await prisma.zgdRequest.create({ data: { itemId, directorateId: item.directorateId, askedById: actor.id, askedByName: who, text: q, dueAt } });
  await recordAudit({ entityType: "OperationalItem", entityId: itemId, actorId: actor.id, action: "UPDATE", fieldName: "zgdRequest", after: q });
  for (const uid of await directorsOf(item.directorateId)) await createNotification({ userId: uid, type: "ZGD_REQUEST", message: `${who} запросил(а) статус «${item.title.slice(0, 90)}»${dueAt ? ` — ответ к ${dueAt.toLocaleDateString("ru-RU")}` : ""}: ${q.slice(0, 120)}`, link: trackerLink(item) });
  return { ok: true, data: { id: r.id } };
}

/** Директор отвечает на запрос ЗГД: ответ + подтверждение текущего состояния задачи для ЗГД. */
export async function answerRequest(actor: Actor, requestId: string, answer: unknown): Promise<ZgdResult<{ id: string }>> {
  if (!isDirectorial(actor.role) || actor.viewAs) return fail(403, "Отвечает на запросы ЗГД директор.");
  const r = await prisma.zgdRequest.findUnique({ where: { id: requestId }, include: { item: true } });
  if (!r || r.directorateId !== actor.directorateId) return fail(404, "Запрос не найден.");
  if (r.answeredAt) return fail(409, "На запрос уже ответили.", "CONFLICT");
  const a = clip(answer, 2000);
  if (a.length < 3) return fail(400, "Напишите ответ.");
  const me = { id: actor.id, name: await nameOf(actor.id) };
  const done = await prisma.zgdRequest.updateMany({ where: { id: requestId, answeredAt: null }, data: { answer: a, answeredById: me.id, answeredByName: me.name, answeredAt: new Date() } });
  if (!done.count) return fail(409, "На запрос уже ответили.", "CONFLICT");
  await recordAudit({ entityType: "OperationalItem", entityId: r.itemId, actorId: actor.id, action: "UPDATE", fieldName: "zgdAnswer", after: a });
  // ответ — само решение: ЗГД видит ответ, карточка у него остаётся в последнем подтверждённом виде
  await publishItem(r.item, me, `ответил(а) на запрос ЗГД: ${a.slice(0, 200)}`, { skip: [r.askedById], only: [], wasConfirmed: wasConfirmed(r.item) });
  await createNotification({ userId: r.askedById, type: "ZGD_ANSWER", message: `${me.name} ответил(а) по «${r.item.title.slice(0, 90)}»: ${a.slice(0, 160)}`, link: zgdLink(r.itemId) });
  return { ok: true, data: { id: requestId } };
}

/** Комментарий ЗГД к задаче — директору и ответственному (замечания задачи, ItemNote). */
export async function zgdComment(actor: Actor, itemId: string, text: unknown): Promise<ZgdResult<{ id: string }>> {
  const item = await zgdItem(actor, itemId);
  if (!item) return fail(404, "Задача не найдена.");
  const t = clip(text, 2000);
  if (t.length < 2) return fail(400, "Напишите комментарий.");
  const note = await prisma.itemNote.create({ data: { itemId, authorId: actor.id, text: t } });
  const who = await nameOf(actor.id);
  const to = new Set([...(await directorsOf(item.directorateId)), ...(item.responsibleId ? [item.responsibleId] : [])]);
  for (const uid of to) await createNotification({ userId: uid, type: "ZGD_COMMENT", message: `${who} прокомментировал(а) «${item.title.slice(0, 90)}»: ${t.slice(0, 140)}`, link: trackerLink(item) });
  return { ok: true, data: { id: note.id } };
}

/** Поручение ЗГД: новая задача дирекции (без ответственного — его назначает директор), на контроле ЗГД. */
/** Исполнитель поручения — действующий сотрудник этой дирекции, который ведёт позиции: руководитель, директор, админ «подаёт как руководитель». */
async function assignee(directorateId: string, responsibleId: unknown) {
  if (typeof responsibleId !== "string" || !responsibleId) return null;
  return prisma.user.findFirst({ where: { id: responsibleId, directorateId, isActive: true, OR: [{ role: { in: ["HEAD", "DIRECTOR"] } }, { role: "ADMIN", submits: true }] }, select: { id: true, name: true } });
}

export async function createOrder(actor: Actor, input: { directorateId: unknown; title: unknown; expectedResult: unknown; deadline: Date | null; responsibleId?: unknown }): Promise<ZgdResult<{ id: string }>> {
  if (actor.role !== "EXECUTIVE" || actor.viewAs) return fail(403, "Поручение даёт ЗГД.");
  const directorateId = typeof input.directorateId === "string" ? input.directorateId : "";
  const dir = directorateId ? await prisma.directorate.findFirst({ where: { id: directorateId, isActive: true } }) : null;
  if (!dir) return fail(400, "Выберите дирекцию.");
  const title = clip(input.title, 300);
  const expectedResult = clip(input.expectedResult, 2000);
  if (title.length < 3) return fail(400, "Сформулируйте поручение.");
  if (expectedResult.length < 3) return fail(400, "Опишите ожидаемый результат — по нему директор примет работу.");
  if (!input.deadline) return fail(400, "Укажите срок.");
  // исполнителя можно выбрать сразу; иначе его назначает директор
  const resp = await assignee(dir.id, input.responsibleId);
  if (input.responsibleId && !resp) return fail(400, "Исполнитель не найден в этой дирекции.");
  const statuses = await prisma.status.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, trackerColumn: true } });
  const who = await nameOf(actor.id);
  const now = new Date();
  const item = await prisma.operationalItem.create({
    data: {
      title, expectedResult, deadline: input.deadline, originalDeadline: input.deadline, statusId: statusForColumn("TODO", statuses), directorateId: dir.id,
      responsibleId: resp?.id ?? null,
      origin: "ZGD", assignedById: actor.id, assignedByName: who, assignedAt: now, zgdControl: true, createdById: actor.id, updatedById: actor.id,
    },
  });
  await recordAudit({ entityType: "OperationalItem", entityId: item.id, actorId: actor.id, action: "CREATE" });
  await publishItem(item, { id: actor.id, name: who }, "дал(а) поручение");
  // директор узнаёт всегда (иерархия), исполнитель — если выбран сразу
  for (const uid of await directorsOf(dir.id)) if (uid !== resp?.id) await createNotification({ userId: uid, type: "ZGD_ORDER", message: `Поручение ЗГД (${who}): «${title.slice(0, 120)}», срок ${input.deadline.toLocaleDateString("ru-RU")}${resp ? ` — исполнитель ${resp.name}` : " — назначьте ответственного"}`, link: trackerLink(item) });
  if (resp) await createNotification({ userId: resp.id, type: "ZGD_ORDER", message: `Вам поручение ЗГД (${who}): «${title.slice(0, 120)}», срок ${input.deadline.toLocaleDateString("ru-RU")}`, link: trackerLink(item) });
  return { ok: true, data: { id: item.id } };
}

/** Поручение директора сотруднику своей дирекции: что сделать, ожидаемый результат, срок, исполнитель (обязателен). */
export async function directorOrder(actor: Actor, input: { responsibleId: unknown; title: unknown; expectedResult: unknown; deadline: Date | null; segmentId?: unknown }): Promise<ZgdResult<{ id: string }>> {
  if (!isDirectorial(actor.role) || actor.viewAs || !actor.directorateId) return fail(403, "Поручение даёт директор.");
  const title = clip(input.title, 300);
  const expectedResult = clip(input.expectedResult, 2000);
  if (title.length < 3) return fail(400, "Сформулируйте поручение.");
  if (expectedResult.length < 3) return fail(400, "Опишите ожидаемый результат — по нему вы примете работу.");
  if (!input.deadline) return fail(400, "Укажите срок.");
  const resp = await assignee(actor.directorateId, input.responsibleId);
  if (!resp) return fail(400, "Выберите исполнителя из своей дирекции.");
  const segmentId = typeof input.segmentId === "string" && input.segmentId ? input.segmentId : null;
  if (segmentId && !(await prisma.segment.findFirst({ where: { id: segmentId, directorateId: actor.directorateId } }))) return fail(400, "Сегмент не найден.");
  const statuses = await prisma.status.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, trackerColumn: true } });
  const who = await nameOf(actor.id);
  const item = await prisma.operationalItem.create({
    data: {
      title, expectedResult, deadline: input.deadline, originalDeadline: input.deadline, statusId: statusForColumn("TODO", statuses), directorateId: actor.directorateId,
      segmentId, responsibleId: resp.id, origin: "DIRECTOR", assignedById: actor.id, assignedByName: who, assignedAt: new Date(), createdById: actor.id, updatedById: actor.id,
    },
  });
  await recordAudit({ entityType: "OperationalItem", entityId: item.id, actorId: actor.id, action: "CREATE" });
  if (resp.id !== actor.id) await createNotification({ userId: resp.id, type: "ZGD_ORDER", message: `Поручение директора (${who}): «${title.slice(0, 120)}», срок ${input.deadline.toLocaleDateString("ru-RU")}`, link: trackerLink(item) });
  return { ok: true, data: { id: item.id } };
}

/** Руководитель просит перенести срок поручения ЗГД / задачи на контроле: решает директор. */
export async function requestDeadline(actor: Actor, itemId: string, newDeadline: Date | null, reason: unknown): Promise<ZgdResult<{ id: string }>> {
  const item = await prisma.operationalItem.findFirst({ where: { id: itemId, directorateId: actor.directorateId ?? "-", archivedAt: null } });
  if (!item) return fail(404, "Задача не найдена.");
  if (!canEditItem(actor, item) || actor.viewAs) return fail(403, "Просить перенос может ответственный за задачу.");
  const why = clip(reason, 500);
  if (!newDeadline) return fail(400, "Укажите новый срок.");
  if (why.length < 3) return fail(400, "Укажите причину переноса.");
  if (await prisma.deadlineRequest.findFirst({ where: { itemId, decision: null } })) return fail(409, "Просьба о переносе уже ждёт решения директора.", "CONFLICT");
  const me = await nameOf(actor.id);
  const r = await prisma.deadlineRequest.create({ data: { itemId, requestedById: actor.id, requestedByName: me, newDeadline, reason: why } });
  await recordAudit({ entityType: "OperationalItem", entityId: itemId, actorId: actor.id, action: "UPDATE", fieldName: "deadlineRequest", after: `${newDeadline.toISOString().slice(0, 10)}: ${why}` });
  for (const uid of await directorsOf(item.directorateId)) if (uid !== actor.id) await createNotification({ userId: uid, type: "DEADLINE_REQUEST", message: `${me} просит перенести срок «${item.title.slice(0, 90)}» на ${newDeadline.toLocaleDateString("ru-RU")}: ${why.slice(0, 120)}`, link: trackerLink(item) });
  return { ok: true, data: { id: r.id } };
}

/** Директор решает по просьбе о переносе: согласовать (срок меняется, ЗГД видит подтверждение) или отклонить с комментарием. */
export async function decideDeadline(actor: Actor, requestId: string, approve: boolean, comment: unknown): Promise<ZgdResult<{ id: string }>> {
  if (!isDirectorial(actor.role) || actor.viewAs) return fail(403, "Перенос срока согласует директор.");
  const r = await prisma.deadlineRequest.findUnique({ where: { id: requestId }, include: { item: true } });
  if (!r || r.item.directorateId !== actor.directorateId || r.item.archivedAt) return fail(404, "Просьба не найдена.");
  if (r.decision) return fail(409, "По просьбе уже решили.", "CONFLICT");
  const c = clip(comment, 500);
  if (!approve && c.length < 3) return fail(400, "Напишите, почему перенос не согласован.");
  const me = { id: actor.id, name: await nameOf(actor.id) };
  const done = await prisma.deadlineRequest.updateMany({ where: { id: requestId, decision: null }, data: { decision: approve ? "APPROVED" : "REJECTED", decidedById: me.id, decidedByName: me.name, decidedAt: new Date(), comment: c || null } });
  if (!done.count) return fail(409, "По просьбе уже решили.", "CONFLICT");
  let item = r.item;
  if (approve) {
    item = await prisma.operationalItem.update({ where: { id: r.itemId }, data: { deadline: r.newDeadline, originalDeadline: r.item.originalDeadline ?? r.item.deadline, updatedById: me.id, version: { increment: 1 } } });
    await recordAudit({ entityType: "OperationalItem", entityId: r.itemId, actorId: actor.id, action: "DEADLINE_CHANGE", fieldName: "deadline", before: r.item.deadline?.toISOString() ?? null, after: r.newDeadline.toISOString() });
    await recordAudit({ entityType: "OperationalItem", entityId: r.itemId, actorId: actor.id, action: "UPDATE", fieldName: "deadlineReason", after: r.reason });
    await publishItem(item, me, `согласовал(а) перенос срока: ${r.reason.slice(0, 160)}`, { only: ["deadline", "originalDeadline"], wasConfirmed: wasConfirmed(r.item) });
  }
  await createNotification({ userId: r.requestedById, type: "DEADLINE_REQUEST", message: `${me.name} ${approve ? "согласовал(а)" : "не согласовал(а)"} перенос срока «${r.item.title.slice(0, 90)}»${c ? `: ${c.slice(0, 120)}` : ""}`, link: trackerLink(r.item) });
  return { ok: true, data: { id: requestId } };
}

/** Для карточки ЗГД: его запросы и ответы, комментарии (только по задачам, которые ЗГД видит — подтверждённым). */
export async function zgdItemInfo(actor: Actor, itemId: string) {
  if (actor.role !== "EXECUTIVE") return null;
  const [requests, notes] = await Promise.all([
    prisma.zgdRequest.findMany({ where: { itemId }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.itemNote.findMany({ where: { itemId, author: { role: "EXECUTIVE" } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, text: true, createdAt: true, author: { select: { name: true } } } }),
  ]);
  return { requests, notes };
}
