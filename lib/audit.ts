import { prisma } from "@/lib/prisma";
import type { AuditAction } from "@prisma/client";

type AuditableEntity = "Track" | "Task" | "VesselOption";

/**
 * Раздел 27-29 ТЗ: append-only журнал. Никогда не удаляется обычным пользователем.
 * Один вызов = одна запись на одно изменившееся поле (раздел 26, Weekly Diff "Было -> Стало").
 */
export async function recordAudit(params: {
  entityType: AuditableEntity;
  entityId: string;
  actorId: string | null;
  action: AuditAction;
  fieldName?: string;
  before?: string | null;
  after?: string | null;
}) {
  return prisma.auditEvent.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      actorId: params.actorId,
      action: params.action,
      fieldName: params.fieldName,
      before: params.before ?? null,
      after: params.after ?? null,
    },
  });
}

const FIELD_TO_ACTION: Record<string, AuditAction> = {
  statusId: "STATUS_CHANGE",
  deadline: "DEADLINE_CHANGE",
  ownerId: "OWNER_CHANGE",
  attractivenessId: "ATTRACTIVENESS_CHANGE",
  operFlag: "OPER_FLAG_CHANGE",
};

/**
 * Сравнивает before/after объекты и создаёт по одному AuditEvent на каждое
 * изменившееся отслеживаемое поле. Используется в UPDATE-обработчиках Track/Task/VesselOption.
 */
export async function recordFieldChanges(params: {
  entityType: AuditableEntity;
  entityId: string;
  actorId: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  trackedFields: string[];
}) {
  const events: Promise<unknown>[] = [];
  for (const field of params.trackedFields) {
    const beforeVal = params.before[field];
    const afterVal = params.after[field];
    if (serialize(beforeVal) === serialize(afterVal)) continue;

    const action = FIELD_TO_ACTION[field] ?? "UPDATE";
    events.push(
      recordAudit({
        entityType: params.entityType,
        entityId: params.entityId,
        actorId: params.actorId,
        action,
        fieldName: field,
        before: serialize(beforeVal),
        after: serialize(afterVal),
      })
    );
  }
  await Promise.all(events);
}

function serialize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
