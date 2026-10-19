import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDicts } from "@/lib/dictionaries";
import { recordAudit } from "@/lib/audit";
import { createNotification, withDirectorate } from "@/lib/notifications";
import { canViewItems, isDirectorial, type Actor } from "@/lib/permissions";
import { normalizeFiles, readFiles } from "@/lib/item-files";
import { statusForColumn, type TrackerColumnKey } from "@/lib/tracker";
import { changedSincePublish, checkAction, DECISION_TEXT, TARGET_COLUMN, type WorkflowAction, type WorkflowInput } from "@/lib/workflow";
import type { ItemRecord } from "@/lib/table-view";
import { STOP_STATUS } from "@/lib/statuses";
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
  /** Решение директора: ЗГД применяет только эти поля (статус, приёмка, стоп, отмена, срок); нет — весь снимок. */
  only?: string[];
};

/** Поля, которые меняет решение по задаче (принять, вернуть, отменить, переоткрыть, стоп). */
export const DECISION_FIELDS = ["statusName", "statusColor", "review", "cancelReason", "blockedBy", "blockedUntil"];

/**
 * Время подтверждения записи: «сейчас», но не раньше её времени правки. Время правки ставит Prisma, «сейчас» — сервер, и часы
 * расходятся на миллисекунды (так поручение ЗГД сразу после создания выглядело «не подтверждённым»). Подтверждаем ровно то
 * состояние, с которого снят снимок: правка после него будет позже и останется неподтверждённой.
 */
export const confirmedAt = (now: Date, item: { updatedAt: Date }) => (item.updatedAt.getTime() > now.getTime() ? item.updatedAt : now);

/** До этого изменения у задачи не было неподтверждённых для ЗГД правок. */
export const wasConfirmed = (item: { publishedAt: Date | null; updatedAt: Date }) => !changedSincePublish(item.updatedAt, item.publishedAt);

const iso = (d: Date | null) => (d ? d.toISOString() : null);

type Review = Prisma.TaskReviewGetPayload<object>;

/** Снимки пачкой: одна выборка сдач на все задачи (а не запрос на каждую — на сотне задач это минуты и таймаут). */
export async function snapshotsOf(items: ItemRecord[], db: Db = prisma): Promise<Map<string, PublishedSnapshot>> {
  const [d, reviews] = await Promise.all([getDicts(), items.length ? db.taskReview.findMany({ where: { itemId: { in: items.map((i) => i.id) } }, orderBy: { submittedAt: "desc" } }) : Promise.resolve([] as Review[])]);
  const last = new Map<string, Review>();
  for (const r of reviews) if (!last.has(r.itemId)) last.set(r.itemId, r);
  return new Map(items.map((i) => [i.id, snapshotFrom(i, last.get(i.id) ?? null, d)]));
}

export async function snapshotOf(item: ItemRecord, db: Db = prisma): Promise<PublishedSnapshot> {
  const [d, review] = await Promise.all([getDicts(), db.taskReview.findFirst({ where: { itemId: item.id }, orderBy: { submittedAt: "desc" } })]);
  return snapshotFrom(item, review, d);
}

function snapshotFrom(item: ItemRecord, review: Review | null, d: Awaited<ReturnType<typeof getDicts>>): PublishedSnapshot {
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

/** Снимок как стабильная строка (ключи по порядку): jsonb в базе хранит их в своём порядке — сравнивать надо так. */
function stable(v: unknown): string {
  const norm = (x: unknown): unknown => (Array.isArray(x) ? x.map(norm) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, val]) => [k, norm(val)])) : x);
  return JSON.stringify(norm(JSON.parse(JSON.stringify(v ?? null))));
}

/**
 * Подтвердить для ЗГД сразу много задач полным снимком (блокер, отмена, сдача — не только поля таблицы), пачкой:
 * дирекция может вести сотни позиций, а запрос на каждую — это минуты и таймаут сервера.
 *  · dedupe — при отправке справки не плодить копии: если полный снимок не изменился с прошлого подтверждения, строку не пишем
 *    (иначе база растёт на «задачи × недели»; состояние у ЗГД то же, а дату справки несёт сама справка);
 *  · notify — ЗГД, взявший задачу на контроль, узнаёт о подтверждённом изменении (для кнопки «Обновить для ЗГД»; при отправке
 *    справки он и так получает «пришла справка»).
 */
export async function publishAll(items: ItemRecord[], actor: { id: string; name: string }, reason: string, opts: { dedupe?: boolean; notify?: boolean } = {}): Promise<number> {
  const list = items.filter((i) => i.directorateId);
  if (!list.length) return 0;
  const ids = list.map((i) => i.id);
  const snaps = await snapshotsOf(list);
  let fresh = list;
  if (opts.dedupe) {
    // сравниваем только с полными подтверждениями: решение директора (поле only) ЗГД применяет частично
    const prev = await prisma.$queryRaw<Array<{ itemId: string; snapshot: unknown }>>`SELECT DISTINCT ON ("itemId") "itemId", "snapshot" FROM "item_publications" WHERE "itemId" IN (${Prisma.join(ids)}) AND ("snapshot"->'only') IS NULL ORDER BY "itemId", "publishedAt" DESC`;
    const same = new Set(prev.filter((p) => stable(p.snapshot) === stable(snaps.get(p.itemId))).map((p) => p.itemId));
    fresh = list.filter((i) => !same.has(i.id));
  }
  const now = new Date();
  if (fresh.length) {
    await prisma.itemPublication.createMany({
      data: fresh.map((i) => ({ itemId: i.id, directorateId: i.directorateId!, publishedById: actor.id, publishedByName: actor.name, reason, snapshot: snaps.get(i.id) as unknown as Prisma.InputJsonValue, publishedAt: confirmedAt(now, i) })),
    });
  }
  // «подтверждено» — у всех выбранных, даже если новой строки не понадобилось; запись, чьё время правки «впереди» часов сервера, —
  // своим временем правки (редкость: расхождение часов на миллисекунды)
  await prisma.$executeRaw`UPDATE "operational_items" SET "publishedAt" = ${now} WHERE "id" IN (${Prisma.join(ids)})`;
  for (const i of list) if (confirmedAt(now, i) !== now) await prisma.$executeRaw`UPDATE "operational_items" SET "publishedAt" = ${i.updatedAt} WHERE "id" = ${i.id}`;
  if (opts.notify) {
    const controlled = list.filter((i) => i.zgdControl);
    if (controlled.length) {
      const zgd = await prisma.user.findMany({ where: { role: "EXECUTIVE", isActive: true }, select: { id: true } });
      for (const i of controlled) for (const u of zgd) if (u.id !== actor.id) await createNotification({ userId: u.id, type: "ZGD_UPDATE", message: `${actor.name}: ${reason} — «${i.title.slice(0, 100)}»`, link: `/tracker?view=timeline&item=${i.id}` });
    }
  }
  return fresh.length;
}

/**
 * Подтвердить состояние одной задачи для ЗГД: решение директора (принял, вернул, ответил, согласовал перенос…).
 * ЗГД видит только последнее подтверждённое — черновики дирекции ему не видны.
 */
export async function publishItem(item: ItemRecord, actor: { id: string; name: string }, reason: string, opts: { db?: Db; skip?: string[]; only?: string[]; wasConfirmed?: boolean } = {}): Promise<void> {
  if (!item.directorateId) return;
  const db = opts.db ?? prisma;
  const skipUserIds = opts.skip ?? [];
  // решение директора уходит ЗГД без черновых правок карточки: снимок полный (для истории), применяются только поля решения
  const snapshot: PublishedSnapshot = { ...(await snapshotOf(item, db)), ...(opts.only ? { only: opts.only } : {}) };
  const now = confirmedAt(new Date(), item);
  await db.itemPublication.create({ data: { itemId: item.id, directorateId: item.directorateId, publishedById: actor.id, publishedByName: actor.name, reason, snapshot: snapshot as unknown as Prisma.InputJsonValue, publishedAt: now } });
  // напрямую: обычный update сдвинул бы updatedAt («давно не трогали» и «не подтверждено» сравнивают с ним).
  // Только решение, а в карточке остались неподтверждённые правки — у директора она по-прежнему «не подтверждена»
  if (!opts.only || opts.wasConfirmed) await db.$executeRaw`UPDATE "operational_items" SET "publishedAt" = ${now} WHERE "id" = ${item.id}`;
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
  const onStop = !!item.statusId && d.statuses.get(item.statusId)?.name === STOP_STATUS;
  const err = checkAction(actor, { column, responsibleId: item.responsibleId, createdById: item.createdById, blocked: !!item.blockedBy || onStop, archived: !!item.archivedAt }, action, input);
  if (err) return { ok: false, status: err.startsWith("Укажите") || err.startsWith("Опишите") || err.startsWith("Напишите") ? 400 : 403, error: err.startsWith("Укажите") || err.startsWith("Опишите") || err.startsWith("Напишите") ? "INVALID_INPUT" : "FORBIDDEN", message: err };

  // как и обычная правка: пока директор собирает справку, руководитель не меняет поданные позиции
  if (actor.role === "HEAD" && item.operFlag && (await prisma.cycle.findFirst({ where: { directorateId: item.directorateId ?? "-", status: "IN_REVIEW" }, select: { id: true } })))
    return { ok: false, status: 409, error: "LOCKED", message: "Идёт сборка справки директором: поданные позиции сейчас не меняются. Дождитесь отправки справки или возврата позиции директором." };
  const me = { id: actor.id, name: d.users.get(actor.id)?.name ?? "—" };
  const statuses = [...d.statuses].map(([sid, s]) => ({ id: sid, name: s.name, trackerColumn: s.trackerColumn }));
  const target = TARGET_COLUMN[action];
  // «Принять» / «Вернуть» / «Отменить» — в первый статус колонки по порядку (Настройки → Статусы), не «На стопе»
  const ordered = await prisma.status.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, trackerColumn: true } });
  const pool = ordered.length ? ordered : statuses;
  const working = pool.filter((s) => s.name !== STOP_STATUS);
  let statusId = target ? statusForColumn(target, working) : undefined;
  // «Поставить на стоп» — статус «На стопе» (если он заведён); «Снять со стопа» — обратно «В работе»
  if (action === "block") statusId = pool.find((s) => s.name === STOP_STATUS)?.id;
  if (action === "unblock" && onStop) statusId = statusForColumn("DOING", working);
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
      // решение директора — ЗГД видит само решение (статус, приёмку, стоп, отмену), без черновых правок карточки
      if (isDirectorial(actor.role) && action !== "submit") await publishItem(row, me, DECISION_TEXT[action], { db: tx, only: DECISION_FIELDS, wasConfirmed: wasConfirmed(item) });
      return row;
    }, { timeout: 15_000, maxWait: 5_000 });

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
