import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { canAssignResponsible, canCreateItem, canDeleteItem, canEditItem, canRestoreItem, canViewItems, type Actor } from "@/lib/permissions";
import { recordAudit, recordFieldChanges, TRACKED_ITEM_FIELDS } from "@/lib/audit";

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
};

export type ItemResult =
  | { ok: true; id: string }
  | { ok: false; error: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "ARCHIVED" | "INVALID_REFERENCE"; currentVersion?: number };

function isForeignKeyError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";
}

export async function createItem(actor: Actor, input: ItemFields & { title: string }): Promise<ItemResult> {
  if (!canCreateItem(actor.role)) return { ok: false, error: "FORBIDDEN" };
  // Руководитель создаёт позиции только на себя: ответственным по умолчанию становится он сам.
  const responsibleId = actor.role === "HEAD" ? input.responsibleId ?? actor.id : input.responsibleId;
  if (!canAssignResponsible(actor, responsibleId)) return { ok: false, error: "FORBIDDEN" };

  try {
    const item = await prisma.operationalItem.create({
      data: { ...input, responsibleId, createdById: actor.id, updatedById: actor.id },
    });
    await recordAudit({ entityType: "OperationalItem", entityId: item.id, actorId: actor.id, action: "CREATE" });
    return { ok: true, id: item.id };
  } catch (e) {
    if (isForeignKeyError(e)) return { ok: false, error: "INVALID_REFERENCE" };
    throw e;
  }
}

export async function updateItem(actor: Actor, id: string, input: ItemFields & { version: number }): Promise<ItemResult> {
  const { version, ...fields } = input;
  if (!canViewItems(actor.role)) return { ok: false, error: "NOT_FOUND" };
  const existing = await prisma.operationalItem.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "NOT_FOUND" };
  if (!canEditItem(actor, existing)) return { ok: false, error: "FORBIDDEN" };
  if (existing.archivedAt) return { ok: false, error: "ARCHIVED" };
  // Сменить ответственного на другого может только куратор.
  if (fields.responsibleId !== undefined && !canAssignResponsible(actor, fields.responsibleId)) {
    return { ok: false, error: "FORBIDDEN" };
  }

  try {
    return await prisma.$transaction(async (tx): Promise<ItemResult> => {
      const { count } = await tx.operationalItem.updateMany({
        where: { id, version },
        data: { ...fields, updatedById: actor.id, version: { increment: 1 } },
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
          before: existing,
          after: updated,
          trackedFields: TRACKED_ITEM_FIELDS,
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
};
