import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDicts } from "@/lib/dictionaries";
import { recordAudit } from "@/lib/audit";
import { createNotification, withDirectorate } from "@/lib/notifications";
import { canViewItems, isDirectorial, type Actor } from "@/lib/permissions";
import { normalizeFiles, readFiles } from "@/lib/item-files";
import { statusForColumn, type TrackerColumnKey } from "@/lib/tracker";
import { checkAction, DECISION_TEXT, TARGET_COLUMN, type WorkflowAction, type WorkflowInput } from "@/lib/workflow";
import type { ItemRecord } from "@/lib/table-view";
import { randomUUID } from "node:crypto";

type Db = Prisma.TransactionClient | typeof prisma;

/** Состояние задачи, которое видит ЗГД: подтверждено директором (снимок полей + последняя сдача/решение). */
export type PublishedSnapshot = {
  title: string;
  comment: string | null;
  expectedResult: string | null;
  segmentId: string | null;
  segmentName: string | null;
  trackName: string | null;
  ownerName: string | null;
  statusName: string | null;
  statusColor: string | null;
  column: TrackerColumnKey;
  deadline: string | null;
  originalDeadline: string | null;
  blockedBy: string | null;
  blockedUntil: string | null;
  cancelReason: string | null;
  origin: string | null;
  assignedByName: string | null;
  zgdControl: boolean;
  submitted: boolean;
  review: { result: string; submittedByName: string; submittedAt: string; decision: string | null; decidedByName: string | null; comment: string | null } | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function snapshotOf(item: ItemRecord, db: Db = prisma): Promise<PublishedSnapshot> {
  const [d, review] = await Promise.all([getDicts(), db.taskReview.findFirst({ where: { itemId: item.id }, orderBy: { submittedAt: "desc" } })]);
  const status = item.statusId ? d.statuses.get(item.statusId) : undefined;
  return {
    title: item.title,
    comment: item.comment,
    expectedResult: item.expectedResult,
    segmentId: item.segmentId,
    segmentName: item.segmentId ? d.segments.get(item.segmentId)?.name ?? null : null,
    trackName: item.trackId ? d.tracks.get(item.trackId)?.name ?? null : null,
    ownerName: item.responsibleId ? d.users.get(item.responsibleId)?.name ?? null : null,
    statusName: status?.name ?? null,
    statusColor: status?.color ?? null,
    column: status?.trackerColumn ?? "TODO",
    deadline: iso(item.deadline),
    originalDeadline: iso(item.originalDeadline),
    blockedBy: item.blockedBy,
    blockedUntil: iso(item.blockedUntil),
    cancelReason: item.cancelReason,
    origin: item.origin,
    assignedByName: item.assignedByName,
    zgdControl: item.zgdControl,
    submitted: item.operFlag,
    review: review ? { result: review.result, submittedByName: review.submittedByName, submittedAt: review.submittedAt.toISOString(), decision: review.decision, decidedByName: review.decidedByName, comment: review.comment } : null,
  };
}

/**
 * Подтвердить состояние задачи для ЗГД: решение директора (принял, вернул, ответил, согласовал перенос…), отправка
 * справки или кнопка «Обновить для ЗГД». ЗГД видит только последнее подтверждённое — черновики дирекции ему не видны.
 */
export async function publishItem(item: ItemRecord, actor: { id: string; name: string }, reason: string, db: Db = prisma, skipUserIds: string[] = []): Promise<void> {
  if (!item.directorateId) return;
  const snapshot = await snapshotOf(item, db);
  const now = new Date();
  await db.itemPublication.create({ data: { itemId: item.id, directorateId: item.directorateId, publishedById: actor.id, publishedByName: actor.name, reason, snapshot: snapshot as unknown as Prisma.InputJsonValue, publishedAt: now } });
  // напрямую: обычный update сдвинул бы updatedAt («давно не трогали» и «не подтверждено» сравнивают с ним)
  await db.$executeRaw`UPDATE "operational_items" SET "publishedAt" = ${now} WHERE "id" = ${item.id}`;
  // ЗГД, взявший задачу на контроль, узнаёт о подтверждённом изменении
  if (item.zgdControl) {
    const zgd = await db.user.findMany({ where: { role: "EXECUTIVE", isActive: true }, select: { id: true } });
    // автору и тем, кто уже получил своё уведомление об этом же (ответ на запрос), — не дублируем
    for (const u of zgd) if (u.id !== actor.id && !skipUserIds.includes(u.id)) await createNotification({ userId: u.id, type: "ZGD_UPDATE", message: `${actor.name}: ${reason} — «${item.title.slice(0, 100)}»`, link: `/tracker?view=timeline&item=${item.id}` });
  }
}

/** Директора дирекции (если их нет — админы): им уходят сдачи на проверку, запросы ЗГД, просьбы о переносе. */
export async function directorsOf(directorateId: string | null): Promise<string[]> {
  if (!directorateId) return [];
  const d = await prisma.user.findMany({ where: { directorateId, role: "DIRECTOR", isActive: true }, select: { id: true } });
  if (d.length) return d.map((u) => u.id);
  return (await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } })).map((u) => u.id);
}

export const trackerLink = (item: { id: string; directorateId: string | null }) => withDirectorate(`/tracker?item=${item.id}`, item.directorateId) ?? `/tracker?item=${item.id}`;

export type TransitionResult = { ok: true; record: ItemRecord } | { ok: false; status: number; error: string; message?: string };

/**
 * Действие трекера над задачей: сдать / принять / вернуть / заблокировать / снять блок / отменить / переоткрыть.
 * Права и обязательные поля — lib/workflow.ts; здесь — запись, журнал, уведомления, подтверждение для ЗГД.
 */
export async function performTransition(actor: Actor, id: string, action: WorkflowAction, input: WorkflowInput & { version: number; blockedUntil?: Date | null; files?: Array<{ id?: string; path: string }> }): Promise<TransitionResult> {
  if (!canViewItems(actor.role)) return { ok: false, status: 404, error: "NOT_FOUND" };
  const item = await prisma.operationalItem.findUnique({ where: { id } });
  if (!item || !actor.directorateId || item.directorateId !== actor.directorateId) return { ok: false, status: 404, error: "NOT_FOUND" };
  if (item.version !== input.version) return { ok: false, status: 409, error: "CONFLICT", message: "Задачу только что изменил кто-то другой — обновите и повторите." };
  const d = await getDicts();
  const column: TrackerColumnKey = (item.statusId ? d.statuses.get(item.statusId)?.trackerColumn : null) ?? "TODO";
  const err = checkAction(actor, { column, responsibleId: item.responsibleId, createdById: item.createdById, blocked: !!item.blockedBy, archived: !!item.archivedAt }, action, input);
  if (err) return { ok: false, status: err.startsWith("Укажите") || err.startsWith("Опишите") || err.startsWith("Напишите") ? 400 : 403, error: err.startsWith("Укажите") || err.startsWith("Опишите") || err.startsWith("Напишите") ? "INVALID_INPUT" : "FORBIDDEN", message: err };

  const me = { id: actor.id, name: d.users.get(actor.id)?.name ?? "—" };
  const statuses = [...d.statuses].map(([sid, s]) => ({ id: sid, trackerColumn: s.trackerColumn }));
  const target = TARGET_COLUMN[action];
  // «Принять» / «Вернуть» / «Отменить» — в первый статус колонки по порядку (Настройки → Статусы)
  const ordered = await prisma.status.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, trackerColumn: true } });
  const statusId = target ? statusForColumn(target, ordered.length ? ordered : statuses) : undefined;
  if (target && !statusId) return { ok: false, status: 400, error: "INVALID_INPUT", message: "Для этого шага не настроен статус (Настройки → Статусы → колонки трекера)." };

  let files: ReturnType<typeof readFiles> = [];
  if (action === "submit" && input.files?.length) {
    const f = normalizeFiles(input.files, [], randomUUID);
    if (!f.ok) return { ok: false, status: 400, error: "INVALID_FILES", message: f.error };
    files = f.files;
  }
  const text = (s?: string) => (s ?? "").trim().slice(0, 2000);

  try {
    const record = await prisma.$transaction(async (tx) => {
      const data: Prisma.OperationalItemUpdateInput = { updatedBy: { connect: { id: actor.id } }, version: { increment: 1 } };
      if (statusId) data.status = { connect: { id: statusId } };
      if (action === "block") Object.assign(data, { blockedBy: text(input.blockedBy), blockedUntil: input.blockedUntil ?? null });
      if (action === "unblock" || action === "submit" || action === "cancel") Object.assign(data, { blockedBy: null, blockedUntil: null });
      if (action === "cancel") data.cancelReason = text(input.reason);
      if (action === "reopen") data.cancelReason = null;
      const row = await tx.operationalItem.update({ where: { id, version: input.version }, data });

      if (action === "submit") await tx.taskReview.create({ data: { itemId: id, submittedById: me.id, submittedByName: me.name, result: text(input.result), files: files as unknown as Prisma.InputJsonValue } });
      if (action === "accept" || action === "return") {
        const open = await tx.taskReview.findFirst({ where: { itemId: id, decision: null }, orderBy: { submittedAt: "desc" } });
        if (open) await tx.taskReview.update({ where: { id: open.id }, data: { decision: action === "accept" ? "ACCEPTED" : "RETURNED", decidedById: me.id, decidedByName: me.name, decidedAt: new Date(), comment: action === "return" ? text(input.comment) : text(input.comment) || null } });
      }
      // журнал: смена статуса (как при обычной правке) + само действие с текстом (результат, причина, на чём ждём)
      if (statusId && statusId !== item.statusId) await recordAudit({ entityType: "OperationalItem", entityId: id, actorId: actor.id, action: "STATUS_CHANGE", fieldName: "statusId", before: item.statusId, after: statusId }, tx);
      const note = action === "submit" ? text(input.result) : action === "return" || action === "accept" ? text(input.comment) : action === "block" ? text(input.blockedBy) : action === "cancel" || action === "reopen" ? text(input.reason) : "";
      await recordAudit({ entityType: "OperationalItem", entityId: id, actorId: actor.id, action: "UPDATE", fieldName: `workflow:${action}`, after: note || null }, tx);
      // решение директора — подтверждённое состояние для ЗГД
      if (isDirectorial(actor.role) && action !== "submit") await publishItem(row, me, DECISION_TEXT[action], tx);
      return row;
    });

    // уведомления — после записи
    const link = trackerLink(item);
    const title = item.title.slice(0, 110);
    if (action === "submit") {
      for (const uid of await directorsOf(item.directorateId)) if (uid !== actor.id) await createNotification({ userId: uid, type: "REVIEW_SUBMITTED", message: `${me.name} сдал(а) на проверку «${title}»: ${text(input.result).slice(0, 140)}`, link });
    } else if (action === "accept" || action === "return") {
      const review = await prisma.taskReview.findFirst({ where: { itemId: id }, orderBy: { submittedAt: "desc" }, select: { submittedById: true } });
      const to = new Set([review?.submittedById, item.responsibleId].filter((x): x is string => !!x && x !== actor.id));
      for (const uid of to) await createNotification({ userId: uid, type: "REVIEW_DECIDED", message: action === "accept" ? `${me.name} принял(а) «${title}»` : `${me.name} вернул(а) на доработку «${title}»: ${text(input.comment).slice(0, 140)}`, link });
    }
    return { ok: true, record };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return { ok: false, status: 409, error: "CONFLICT", message: "Задачу только что изменил кто-то другой — обновите и повторите." };
    throw e;
  }
}
