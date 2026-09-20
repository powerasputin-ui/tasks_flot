import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { canAssignResponsible, canCreateItem, canDeleteItem, canEditItem, canRestoreItem, canViewItems, type Actor } from "@/lib/permissions";
import { recordAudit, recordFieldChanges, TRACKED_ITEM_FIELDS } from "@/lib/audit";
import { flattenCustom, mergeCustomValues, type ColumnDef } from "@/lib/custom-columns";

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

export type ItemResult =
  | { ok: true; id: string }
  | { ok: false; error: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "ARCHIVED" | "INVALID_REFERENCE" | "INVALID_CUSTOM"; currentVersion?: number; message?: string };

function isForeignKeyError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";
}

async function activeColumnDefs(): Promise<ColumnDef[]> {
  const cols = await prisma.customColumn.findMany({ where: { isActive: true } });
  return cols.map((c) => ({ id: c.id, name: c.name, type: c.type, options: c.options }));
}

export async function createItem(actor: Actor, input: ItemFields & { title: string }): Promise<ItemResult> {
  if (!canCreateItem(actor.role)) return { ok: false, error: "FORBIDDEN" };
  // Руководитель создаёт позиции только на себя: ответственным по умолчанию становится он сам.
  const responsibleId = actor.role === "HEAD" ? input.responsibleId ?? actor.id : input.responsibleId;
  if (!canAssignResponsible(actor, responsibleId)) return { ok: false, error: "FORBIDDEN" };

  const { customValues, ...rest } = input;
  let custom: Record<string, string> = {};
  if (customValues) {
    const merged = mergeCustomValues(await activeColumnDefs(), {}, customValues);
    if (!merged.ok) return { ok: false, error: "INVALID_CUSTOM", message: merged.error };
    custom = merged.values;
  }

  try {
    const item = await prisma.operationalItem.create({
      data: { ...rest, customValues: custom, responsibleId, createdById: actor.id, updatedById: actor.id },
    });
    await recordAudit({ entityType: "OperationalItem", entityId: item.id, actorId: actor.id, action: "CREATE" });
    return { ok: true, id: item.id };
  } catch (e) {
    if (isForeignKeyError(e)) return { ok: false, error: "INVALID_REFERENCE" };
    throw e;
  }
}

export async function updateItem(actor: Actor, id: string, input: ItemFields & { version: number }): Promise<ItemResult> {
  const { version, customValues, ...fields } = input;
  if (!canViewItems(actor.role)) return { ok: false, error: "NOT_FOUND" };
  const existing = await prisma.operationalItem.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "NOT_FOUND" };
  if (!canEditItem(actor, existing)) return { ok: false, error: "FORBIDDEN" };
  if (existing.archivedAt) return { ok: false, error: "ARCHIVED" };
  // Сменить ответственного на другого может только куратор.
  if (fields.responsibleId !== undefined && !canAssignResponsible(actor, fields.responsibleId)) {
    return { ok: false, error: "FORBIDDEN" };
  }

  // Значения своих колонок: проверяем тип и сливаем с уже сохранёнными.
  const existingCustom = (existing.customValues ?? {}) as Record<string, string>;
  let nextCustom: Record<string, string> | undefined;
  if (customValues) {
    const merged = mergeCustomValues(await activeColumnDefs(), existingCustom, customValues);
    if (!merged.ok) return { ok: false, error: "INVALID_CUSTOM", message: merged.error };
    nextCustom = merged.values;
  }

  try {
    return await prisma.$transaction(async (tx): Promise<ItemResult> => {
      const { count } = await tx.operationalItem.updateMany({
        where: { id, version },
        data: { ...fields, ...(nextCustom ? { customValues: nextCustom } : {}), updatedById: actor.id, version: { increment: 1 } },
      });
      if (count === 0) {
        const current = await tx.operationalItem.findUnique({ where: { id }, select: { version: true } });
        return { ok: false, error: "CONFLICT", currentVersion: current?.version };
      }
      const updated = await tx.operationalItem.findUniqueOrThrow({ where: { id } });
      await recordFieldChanges(
        {
          entityType: "OperationalItem",
          entityId: id,
          actorId: actor.id,
          // значения своих колонок идут в журнал отдельными полями custom:<id>
          before: { ...existing, ...flattenCustom(existing.customValues) },
          after: { ...updated, ...flattenCustom(updated.customValues) },
          trackedFields: [...TRACKED_ITEM_FIELDS, ...Object.keys({ ...flattenCustom(existing.customValues), ...flattenCustom(updated.customValues) })],
        },
        tx
      );
      return { ok: true, id };
    });
  } catch (e) {
    if (isForeignKeyError(e)) return { ok: false, error: "INVALID_REFERENCE" };
    throw e;
  }
}

/** Удаление = архивирование (физического удаления позиций нет). archived=false возвращает из архива. */
export async function setItemArchived(actor: Actor, id: string, archived: boolean): Promise<ItemResult> {
  if (!canViewItems(actor.role)) return { ok: false, error: "NOT_FOUND" };
  const existing = await prisma.operationalItem.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "NOT_FOUND" };
  if (!(archived ? canDeleteItem(actor, existing) : canRestoreItem(actor, existing))) return { ok: false, error: "FORBIDDEN" };
  if (archived === (existing.archivedAt !== null)) return { ok: true, id }; // уже в нужном состоянии

  await prisma.$transaction(async (tx) => {
    await tx.operationalItem.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null, updatedById: actor.id, version: { increment: 1 } },
    });
    await recordAudit({ entityType: "OperationalItem", entityId: id, actorId: actor.id, action: archived ? "ARCHIVE" : "RESTORE" }, tx);
  });
  return { ok: true, id };
}

export const ITEM_ERROR_STATUS: Record<Exclude<ItemResult, { ok: true }>["error"], number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  ARCHIVED: 409,
  INVALID_REFERENCE: 400,
  INVALID_CUSTOM: 400,
};
