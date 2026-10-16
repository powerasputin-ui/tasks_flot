import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { canAssignResponsible, canCreateItem, canDeleteItem, canEditItem, canPurgeItem, canRestoreItem, canViewItems, isDirectorial, isSubmitter, type Actor } from "@/lib/permissions";
import { recordAudit, recordFieldChanges, TRACKED_ITEM_FIELDS } from "@/lib/audit";
import { changedFields, notifyOwnerOfEdit, notifyPurge } from "@/lib/item-notify";
import { flattenCustom, mergeCustomValues, type ColumnDef } from "@/lib/custom-columns";
import { getDicts, invalidateDicts, type Dicts } from "@/lib/dictionaries";
import { createNotification } from "@/lib/notifications";
import { deadlineChangeError, directStatusError, stopStatusError } from "@/lib/workflow";
import { STOP_STATUS } from "@/lib/statuses";
import { filesText, normalizeFiles, readFiles } from "@/lib/item-files";
import { randomUUID } from "node:crypto";
import type { ItemRecord } from "@/lib/table-view";

/**
 * Сервис позиций оперативки. Вся логика прав и версий здесь, API-маршруты только
 * разбирают запрос и переводят результат в HTTP-статус.
 */
export type ItemFields = {
  title?: string;
  segmentId?: string | null;
  trackId?: string | null;
  cost?: string | null;
  attractivenessId?: string | null;
  responsibleId?: string | null;
  deadline?: Date | null;
  statusId?: string | null;
  comment?: string | null;
  operFlag?: boolean;
  /** Поручение: какой результат ожидается. */
  expectedResult?: string | null;
  /** Причина переноса срока (обязательна, если срок уже был и меняется) — в журнал, не в строку. */
  deadlineReason?: string;
  customValues?: Record<string, string>;
  /** Ссылки на файлы общего диска: id у новых не нужен. */
  files?: Array<{ id?: string; path: string }>;
};

/** ok-результат несёт сохранённую позицию, чтобы вызывающий вернул строку без повторного чтения из базы. */
export type ItemResult =
  | { ok: true; id: string; record: ItemRecord }
  | { ok: false; error: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "ARCHIVED" | "INVALID_REFERENCE" | "INVALID_CUSTOM" | "INVALID_FILES" | "LOCKED" | "INVALID_INPUT"; currentVersion?: number; message?: string };

function isForeignKeyError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";
}

// Активные свои колонки берём из кэша справочников (lib/dictionaries), а не отдельным запросом.
async function activeColumnDefs(directorateId: string): Promise<ColumnDef[]> {
  return (await getDicts()).customColumns.filter((c) => c.directorateId === directorateId);
}

/**
 * Пока директор собирает оперативку («Сборка»), руководитель не меняет уже поданные позиции: иначе итог расходится с тем,
 * что директор видит и утверждает. Вернувшуюся с замечанием (галка снята) и новые позиции править можно.
 */
async function lockedForHead(actor: Actor, existing: { operFlag: boolean }): Promise<boolean> {
  if (actor.role !== "HEAD" || !existing.operFlag || !actor.directorateId) return false;
  return !!(await prisma.cycle.findFirst({ where: { directorateId: actor.directorateId, status: "IN_REVIEW" }, select: { id: true } }));
}

/** Сегмент, трек и ответственный должны быть из дирекции актора: иначе через чужой id можно «привязаться» к чужой дирекции. */
async function refsInDirectorate(directorateId: string, f: { segmentId?: string | null; trackId?: string | null; responsibleId?: string | null }): Promise<boolean> {
  const ok = (d: Dicts) =>
    (!f.segmentId || d.segments.get(f.segmentId)?.directorateId === directorateId) &&
    (!f.trackId || d.tracks.get(f.trackId)?.directorateId === directorateId) &&
    (!f.responsibleId || d.users.get(f.responsibleId)?.directorateId === directorateId);
  if (ok(await getDicts())) return true;
  // справочник в памяти живёт минуту и у каждого сервера свой: сотрудника, сегмент или трек могли завести только что
  // на другом — перечитываем один раз, прежде чем отказать
  invalidateDicts();
  return ok(await getDicts());
}

/** Значения своих колонок; колонку могли добавить только что на другом сервере — при отказе справочник перечитывается. */
async function mergeCustom(directorateId: string, existing: Record<string, string>, patch: Record<string, string>) {
  const first = mergeCustomValues(await activeColumnDefs(directorateId), existing, patch);
  if (first.ok) return first;
  invalidateDicts();
  return mergeCustomValues(await activeColumnDefs(directorateId), existing, patch);
}

/**
 * Прямая смена статуса: в «На проверке», «Выполнено», «Не актуально» и из них — только действиями трекера
 * (сдать / принять / вернуть / отменить / переоткрыть, lib/workflow.ts). null — можно.
 */
async function statusError(from: string | null | undefined, to: string | null | undefined): Promise<string | null> {
  const d = await getDicts();
  const col = (id: string | null | undefined) => (id ? d.statuses.get(id)?.trackerColumn ?? "TODO" : "TODO");
  const stop = (id: string | null | undefined) => !!id && d.statuses.get(id)?.name === STOP_STATUS;
  return directStatusError(col(from), col(to)) ?? stopStatusError(stop(from), stop(to));
}

/** Колонка трекера по статусу позиции. */
async function columnOfStatus(id: string | null): Promise<string> {
  return (id ? (await getDicts()).statuses.get(id)?.trackerColumn : null) ?? "TODO";
}

const REVIEW_LOCK = "Задача на проверке у директора: правки — после его решения (принять или вернуть на доработку).";

export async function createItem(actor: Actor, input: ItemFields & { title: string }): Promise<ItemResult> {
  if (!canCreateItem(actor.role)) return { ok: false, error: "FORBIDDEN" };
  const directorateId = actor.directorateId;
  if (!directorateId) return { ok: false, error: "FORBIDDEN" };
  // Кто подаёт позиции как руководитель (руководитель; админ или директор с «Подаёт как руководитель»), создаёт их на себя:
  // ответственным по умолчанию становится он сам — иначе его поданная позиция не засчитывается ему в подаче и напоминаниях.
  const responsibleId = isSubmitter(actor) ? input.responsibleId ?? actor.id : input.responsibleId;
  if (!canAssignResponsible(actor, responsibleId)) return { ok: false, error: "FORBIDDEN" };

  if (!(await refsInDirectorate(directorateId, { ...input, responsibleId }))) return { ok: false, error: "INVALID_REFERENCE" };
  const createStatusError = await statusError(null, input.statusId);
  if (createStatusError) return { ok: false, error: "FORBIDDEN", message: createStatusError };

  const { customValues, files, deadlineReason: _reason, ...rest } = input;
  void _reason;
  let nextFiles: ReturnType<typeof readFiles> = [];
  if (files) {
    const f = normalizeFiles(files, [], randomUUID);
    if (!f.ok) return { ok: false, error: "INVALID_FILES", message: f.error };
    nextFiles = f.files;
  }
  let custom: Record<string, string> = {};
  if (customValues) {
    const merged = await mergeCustom(directorateId, {}, customValues);
    if (!merged.ok) return { ok: false, error: "INVALID_CUSTOM", message: merged.error };
    custom = merged.values;
  }

  try {
    const item = await prisma.operationalItem.create({
      data: { ...rest, originalDeadline: rest.deadline ?? null, customValues: custom, files: nextFiles, responsibleId, directorateId, createdById: actor.id, updatedById: actor.id },
    });
    await recordAudit({ entityType: "OperationalItem", entityId: item.id, actorId: actor.id, action: "CREATE" });
    return { ok: true, id: item.id, record: item };
  } catch (e) {
    if (isForeignKeyError(e)) return { ok: false, error: "INVALID_REFERENCE" };
    throw e;
  }
}

export async function updateItem(actor: Actor, id: string, input: ItemFields & { version: number }): Promise<ItemResult> {
  const { version, customValues, files, deadlineReason, ...fields } = input;
  if (!canViewItems(actor.role)) return { ok: false, error: "NOT_FOUND" };
  const existing = await prisma.operationalItem.findUnique({ where: { id } });
  if (!existing || !actor.directorateId || existing.directorateId !== actor.directorateId) return { ok: false, error: "NOT_FOUND" };
  if (!canEditItem(actor, existing)) return { ok: false, error: "FORBIDDEN" };
  if (existing.archivedAt) return { ok: false, error: "ARCHIVED" };
  if (await lockedForHead(actor, existing)) return { ok: false, error: "LOCKED", message: "Идёт сборка директором: поданные позиции сейчас не меняются. Дождитесь отправки справки или возврата позиции директором." };
  // сдана на проверку: до решения директора исполнитель задачу не правит — директор принимает то, что сдали;
  // отметку «в справку» («Опер») менять можно
  if (!isDirectorial(actor.role) && (await columnOfStatus(existing.statusId)) === "REVIEW") {
    const onlyOper = Object.entries(fields).every(([k, v]) => k === "operFlag" || v === undefined) && !customValues && !files;
    if (!onlyOper) return { ok: false, error: "LOCKED", message: REVIEW_LOCK };
  }
  // Формулировку поручения (ЗГД или директора) и ожидаемый результат задаёт тот, кто поручил: исполнитель их не
  // переписывает — иначе принимать работу пришлось бы уже не по тому, что поручали. Ход работы — в комментарии.
  if (existing.origin && !isDirectorial(actor.role)) {
    const titleChanged = fields.title !== undefined && fields.title.trim() !== existing.title.trim();
    const resultChanged = fields.expectedResult !== undefined && (fields.expectedResult ?? "").trim() !== (existing.expectedResult ?? "").trim();
    if (titleChanged || resultChanged) return { ok: false, error: "FORBIDDEN", message: "Это поручение: формулировку и ожидаемый результат меняет директор. Ход работы пишите в комментарии." };
  }
  // Сменить ответственного на другого может только куратор.
  if (fields.responsibleId !== undefined && !canAssignResponsible(actor, fields.responsibleId)) {
    return { ok: false, error: "FORBIDDEN" };
  }

  if (!(await refsInDirectorate(actor.directorateId, fields))) return { ok: false, error: "INVALID_REFERENCE" };
  if (fields.statusId !== undefined && fields.statusId !== existing.statusId) {
    const err = await statusError(existing.statusId, fields.statusId);
    if (err) return { ok: false, error: "FORBIDDEN", message: err };
  }
  // перенос срока — с причиной; у поручения ЗГД и задачи на контроле руководитель только просит (решает директор)
  if (fields.deadline !== undefined) {
    const err = deadlineChangeError(actor, existing, fields.deadline, deadlineReason);
    if (err) return { ok: false, error: existing.zgdControl || existing.origin ? "FORBIDDEN" : "INVALID_INPUT", message: err };
  }

  // Значения своих колонок: проверяем тип и сливаем с уже сохранёнными.
  const existingCustom = (existing.customValues ?? {}) as Record<string, string>;
  let nextCustom: Record<string, string> | undefined;
  if (customValues) {
    const merged = await mergeCustom(actor.directorateId, existingCustom, customValues);
    if (!merged.ok) return { ok: false, error: "INVALID_CUSTOM", message: merged.error };
    nextCustom = merged.values;
  }

  let nextFiles: ReturnType<typeof readFiles> | undefined;
  if (files) {
    const f = normalizeFiles(files, readFiles(existing.files), randomUUID);
    if (!f.ok) return { ok: false, error: "INVALID_FILES", message: f.error };
    nextFiles = f.files;
  }

  try {
    // Изменение и журнал — в одной транзакции (журнал не должен расходиться с данными).
    // update с условием по версии: если версия ушла вперёд, Prisma бросает P2025 → конфликт.
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.operationalItem.update({
        where: { id, version },
        data: {
          ...fields,
          // исходный срок — первый поставленный, дальше не меняется
          ...(fields.deadline && !existing.originalDeadline ? { originalDeadline: fields.deadline } : {}),
          ...(nextCustom ? { customValues: nextCustom } : {}),
          ...(nextFiles ? { files: nextFiles } : {}),
          updatedById: actor.id,
          version: { increment: 1 },
        },
      });
      await recordFieldChanges(
        {
          entityType: "OperationalItem",
          entityId: id,
          actorId: actor.id,
          // значения своих колонок идут в журнал отдельными полями custom:<id>
          before: { ...existing, files: filesText(existing.files), ...flattenCustom(existing.customValues) },
          after: { ...row, files: filesText(row.files), ...flattenCustom(row.customValues) },
          trackedFields: [...TRACKED_ITEM_FIELDS, "files", ...Object.keys({ ...flattenCustom(existing.customValues), ...flattenCustom(row.customValues) })],
          // позиция уже отправлена куратору и остаётся отправленной — правка идёт как «после отправки»
          afterSubmission: existing.operFlag && row.operFlag,
        },
        tx
      );
      // директор сам поменял срок — открытая просьба о переносе закрыта (иначе сигнал «перенос ждёт решения» висел бы)
      if (isDirectorial(actor.role) && fields.deadline !== undefined && (existing.deadline?.getTime() ?? null) !== (row.deadline?.getTime() ?? null)) {
        await tx.deadlineRequest.updateMany({ where: { itemId: id, decision: null }, data: { decision: "CLOSED", decidedById: actor.id, decidedByName: (await tx.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? null, decidedAt: new Date(), comment: "директор сам изменил срок" } });
      }
      // причина переноса — рядом с самим переносом в журнале
      if (deadlineReason?.trim() && existing.deadline && row.deadline && existing.deadline.getTime() !== row.deadline.getTime()) {
        await recordAudit({ entityType: "OperationalItem", entityId: id, actorId: actor.id, action: "UPDATE", fieldName: "deadlineReason", after: deadlineReason.trim().slice(0, 500) }, tx);
      }
      return row;
    });
    const touched = changedFields(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
    if (touched.length) await notifyOwnerOfEdit(actor as Actor & { name?: string }, existing, `изменил (${touched.join(", ")})`);
    return { ok: true, id, record: updated };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      const current = await prisma.operationalItem.findUnique({ where: { id }, select: { version: true } });
      return { ok: false, error: "CONFLICT", currentVersion: current?.version };
    }
    if (isForeignKeyError(e)) return { ok: false, error: "INVALID_REFERENCE" };
    throw e;
  }
}

/** Удаление = архивирование (физического удаления позиций нет). archived=false возвращает из архива. */
export async function setItemArchived(actor: Actor, id: string, archived: boolean): Promise<ItemResult> {
  if (!canViewItems(actor.role)) return { ok: false, error: "NOT_FOUND" };
  const existing = await prisma.operationalItem.findUnique({ where: { id } });
  if (!existing || !actor.directorateId || existing.directorateId !== actor.directorateId) return { ok: false, error: "NOT_FOUND" };
  if (!(archived ? canDeleteItem(actor, existing) : canRestoreItem(actor, existing))) return { ok: false, error: "FORBIDDEN" };
  if (archived === (existing.archivedAt !== null)) return { ok: true, id, record: existing }; // уже в нужном состоянии
  if (await lockedForHead(actor, existing)) return { ok: false, error: "LOCKED", message: "Идёт сборка директором: поданные позиции сейчас не меняются." };
  if (archived && !isDirectorial(actor.role) && (await columnOfStatus(existing.statusId)) === "REVIEW") return { ok: false, error: "LOCKED", message: REVIEW_LOCK };

  const record = await prisma.$transaction(async (tx) => {
    const row = await tx.operationalItem.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null, updatedById: actor.id, version: { increment: 1 } },
    });
    await recordAudit({ entityType: "OperationalItem", entityId: id, actorId: actor.id, action: archived ? "ARCHIVE" : "RESTORE" }, tx);
    return row;
  });
  await notifyOwnerOfEdit(actor as Actor & { name?: string }, existing, archived ? "удалил" : "вернул из удалённых");
  // поручение ЗГД или задача на его контроле: иначе она молча пропадёт (или появится) у него в трекере
  if (existing.origin === "ZGD" || existing.zgdControl) {
    const who = (await getDicts()).users.get(actor.id)?.name ?? "Директор";
    const zgd = await prisma.user.findMany({ where: { role: "EXECUTIVE", isActive: true }, select: { id: true } });
    for (const u of zgd) await createNotification({ userId: u.id, type: "ZGD_UPDATE", message: `${who} ${archived ? "удалил(а)" : "вернул(а) из удалённых"} «${existing.title.slice(0, 100)}» (${existing.origin === "ZGD" ? "ваше поручение" : "на вашем контроле"})`, link: "/tracker" });
  }
  return { ok: true, id, record };
}

/**
 * Удалить навсегда: только позицию из «Удалённых». Стираются сама позиция, её комментарии, история правок
 * и уведомления со ссылкой на неё. Отправленные справки не меняются — в них хранится свой снимок.
 */
export async function purgeItem(actor: Actor, id: string): Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" | "FORBIDDEN" | "ARCHIVED" | "HAS_DECISIONS"; message?: string }> {
  if (!canViewItems(actor.role)) return { ok: false, error: "NOT_FOUND" };
  const existing = await prisma.operationalItem.findUnique({ where: { id } });
  if (!existing || !actor.directorateId || existing.directorateId !== actor.directorateId) return { ok: false, error: "NOT_FOUND" };
  if (!canPurgeItem(actor, existing)) return { ok: false, error: "FORBIDDEN" };
  // навсегда — только из «Удалённых»: рабочую позицию сначала удаляют обычным способом
  if (existing.archivedAt === null) return { ok: false, error: "ARCHIVED" };
  // история решений — доказательство: если по задаче уже были сдача/приёмка, подтверждение для ЗГД, запрос или поручение ЗГД,
  // навсегда её не стираем (остаётся в «Удалённых» вместе с историей)
  const [reviews, pubs, reqs] = await Promise.all([prisma.taskReview.count({ where: { itemId: id } }), prisma.itemPublication.count({ where: { itemId: id } }), prisma.zgdRequest.count({ where: { itemId: id } })]);
  if (reviews || pubs || reqs || existing.origin === "ZGD") return { ok: false, error: "HAS_DECISIONS", message: "По задаче есть решения или она видна ЗГД — удалить навсегда нельзя: история решений должна сохраниться. Задача остаётся в «Удалённых»." };
  await prisma.$transaction(async (tx) => {
    await tx.itemNote.deleteMany({ where: { itemId: id } });
    await tx.auditEvent.deleteMany({ where: { entityType: "OperationalItem", entityId: id } });
    await tx.notification.deleteMany({ where: { link: { contains: `item=${id}` } } });
    await tx.operationalItem.delete({ where: { id } });
  });
  await notifyPurge(actor as Actor & { name?: string }, existing);
  return { ok: true };
}

export const ITEM_ERROR_STATUS: Record<Exclude<ItemResult, { ok: true }>["error"], number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  ARCHIVED: 409,
  INVALID_REFERENCE: 400,
  INVALID_CUSTOM: 400,
  INVALID_FILES: 400,
  LOCKED: 409,
  INVALID_INPUT: 400,
};
