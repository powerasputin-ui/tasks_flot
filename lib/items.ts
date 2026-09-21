import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { canAssignResponsible, canCreateItem, canDeleteItem, canEditItem, canRestoreItem, canViewItems, type Actor } from "@/lib/permissions";
import { recordAudit, recordFieldChanges, TRACKED_ITEM_FIELDS } from "@/lib/audit";
import { flattenCustom, mergeCustomValues, type ColumnDef } from "@/lib/custom-columns";
import { getDicts } from "@/lib/dictionaries";
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
  customValues?: Record<string, string>;
};

/** ok-результат несёт сохранённую позицию, чтобы вызывающий вернул строку без повторного чтения из базы. */
export type ItemResult =
  | { ok: true; id: string; record: ItemRecord }
  | { ok: false; error: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "ARCHIVED" | "INVALID_REFERENCE" | "INVALID_CUSTOM" | "LOCKED"; currentVersion?: number; message?: string };

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
  const d = await getDicts();
  const okSeg = !f.segmentId || d.segments.get(f.segmentId)?.directorateId === directorateId;
  const okTrack = !f.trackId || d.tracks.get(f.trackId)?.directorateId === directorateId;
  const okUser = !f.responsibleId || d.users.get(f.responsibleId)?.directorateId === directorateId;
  return okSeg && okTrack && okUser;
}

export async function createItem(actor: Actor, input: ItemFields & { title: string }): Promise<ItemResult> {
  if (!canCreateItem(actor.role)) return { ok: false, error: "FORBIDDEN" };
  const directorateId = actor.directorateId;
  if (!directorateId) return { ok: false, error: "FORBIDDEN" };
  // Руководитель создаёт позиции только на себя: ответственным по умолчанию становится он сам.
  const responsibleId = actor.role === "HEAD" ? input.responsibleId ?? actor.id : input.responsibleId;
  if (!canAssignResponsible(actor, responsibleId)) return { ok: false, error: "FORBIDDEN" };

  if (!(await refsInDirectorate(directorateId, { ...input, responsibleId }))) return { ok: false, error: "INVALID_REFERENCE" };

  const { customValues, ...rest } = input;
  let custom: Record<string, string> = {};
  if (customValues) {
    const merged = mergeCustomValues(await activeColumnDefs(directorateId), {}, customValues);
    if (!merged.ok) return { ok: false, error: "INVALID_CUSTOM", message: merged.error };
    custom = merged.values;
  }

  try {
    const item = await prisma.operationalItem.create({
      data: { ...rest, customValues: custom, responsibleId, directorateId, createdById: actor.id, updatedById: actor.id },
    });
    await recordAudit({ entityType: "OperationalItem", entityId: item.id, actorId: actor.id, action: "CREATE" });
    return { ok: true, id: item.id, record: item };
  } catch (e) {
    if (isForeignKeyError(e)) return { ok: false, error: "INVALID_REFERENCE" };
    throw e;
  }
}

export async function updateItem(actor: Actor, id: string, input: ItemFields & { version: number }): Promise<ItemResult> {
  const { version, customValues, ...fields } = input;
  if (!canViewItems(actor.role)) return { ok: false, error: "NOT_FOUND" };
  const existing = await prisma.operationalItem.findUnique({ where: { id } });
  if (!existing || !actor.directorateId || existing.directorateId !== actor.directorateId) return { ok: false, error: "NOT_FOUND" };
  if (!canEditItem(actor, existing)) return { ok: false, error: "FORBIDDEN" };
  if (existing.archivedAt) return { ok: false, error: "ARCHIVED" };
  if (await lockedForHead(actor, existing)) return { ok: false, error: "LOCKED", message: "Идёт сборка директором: поданные позиции сейчас не меняются. Дождитесь возврата с замечанием." };
  // Сменить ответственного на другого может только куратор.
  if (fields.responsibleId !== undefined && !canAssignResponsible(actor, fields.responsibleId)) {
    return { ok: false, error: "FORBIDDEN" };
  }

  if (!(await refsInDirectorate(actor.directorateId, fields))) return { ok: false, error: "INVALID_REFERENCE" };

  // Значения своих колонок: проверяем тип и сливаем с уже сохранёнными.
  const existingCustom = (existing.customValues ?? {}) as Record<string, string>;
  let nextCustom: Record<string, string> | undefined;
  if (customValues) {
    const merged = mergeCustomValues(await activeColumnDefs(actor.directorateId), existingCustom, customValues);
    if (!merged.ok) return { ok: false, error: "INVALID_CUSTOM", message: merged.error };
    nextCustom = merged.values;
  }

  try {
    // Изменение и журнал — в одной транзакции (журнал не должен расходиться с данными).
    // update с условием по версии: если версия ушла вперёд, Prisma бросает P2025 → конфликт.
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.operationalItem.update({
        where: { id, version },
        data: { ...fields, ...(nextCustom ? { customValues: nextCustom } : {}), updatedById: actor.id, version: { increment: 1 } },
      });
      await recordFieldChanges(
        {
          entityType: "OperationalItem",
          entityId: id,
          actorId: actor.id,
          // значения своих колонок идут в журнал отдельными полями custom:<id>
          before: { ...existing, ...flattenCustom(existing.customValues) },
          after: { ...row, ...flattenCustom(row.customValues) },
          trackedFields: [...TRACKED_ITEM_FIELDS, ...Object.keys({ ...flattenCustom(existing.customValues), ...flattenCustom(row.customValues) })],
          // позиция уже отправлена куратору и остаётся отправленной — правка идёт как «после отправки»
          afterSubmission: existing.operFlag && row.operFlag,
        },
        tx
      );
      return row;
    });
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

  const record = await prisma.$transaction(async (tx) => {
    const row = await tx.operationalItem.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null, updatedById: actor.id, version: { increment: 1 } },
    });
    await recordAudit({ entityType: "OperationalItem", entityId: id, actorId: actor.id, action: archived ? "ARCHIVE" : "RESTORE" }, tx);
    return row;
  });
  return { ok: true, id, record };
}

export const ITEM_ERROR_STATUS: Record<Exclude<ItemResult, { ok: true }>["error"], number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  ARCHIVED: 409,
  INVALID_REFERENCE: 400,
  INVALID_CUSTOM: 400,
  LOCKED: 409,
};
