import { prisma } from "@/lib/prisma";
import type { AuditAction, Prisma } from "@prisma/client";

export type AuditableEntity = "OperationalItem";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Append-only журнал (TZ_v4, раздел 4): один вызов = одна запись на одно
 * изменившееся поле (кто, что, было → стало). Никогда не удаляется.
 */
export async function recordAudit(
  params: {
    entityType: AuditableEntity;
    entityId: string;
    actorId: string | null;
    action: AuditAction;
    fieldName?: string;
    before?: string | null;
    after?: string | null;
    afterSubmission?: boolean;
  },
  db: Db = prisma
) {
  return db.auditEvent.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      actorId: params.actorId,
      action: params.action,
      fieldName: params.fieldName,
      before: params.before ?? null,
      after: params.after ?? null,
      afterSubmission: params.afterSubmission ?? false,
    },
  });
}

const FIELD_TO_ACTION: Record<string, AuditAction> = {
  statusId: "STATUS_CHANGE",
  deadline: "DEADLINE_CHANGE",
  responsibleId: "OWNER_CHANGE",
  attractivenessId: "ATTRACTIVENESS_CHANGE",
  operFlag: "OPER_FLAG_CHANGE",
};

export const TRACKED_ITEM_FIELDS = [
  "title",
  "cost",
  "comment",
  "segmentId",
  "trackId",
  "attractivenessId",
  "responsibleId",
  "deadline",
  "statusId",
  "operFlag",
];

export type FieldChange = { field: string; before: string | null; after: string | null };

/** Чистая функция: какие из отслеживаемых полей изменились (без обращения к БД). */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const b = serialize(before[field]);
    const a = serialize(after[field]);
    if (b !== a) changes.push({ field, before: b, after: a });
  }
  return changes;
}

export async function recordFieldChanges(
  params: {
    entityType: AuditableEntity;
    entityId: string;
    actorId: string | null;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    trackedFields: string[];
    afterSubmission?: boolean;
  },
  db: Db = prisma
) {
  const changes = diffFields(params.before, params.after, params.trackedFields);
  // одним запросом: в транзакции параллельные записи всё равно идут по очереди, а каждая стоит обмена с базой
  if (changes.length > 0) {
    await db.auditEvent.createMany({
      data: changes.map((c) => ({
        entityType: params.entityType,
        entityId: params.entityId,
        actorId: params.actorId,
        action: FIELD_TO_ACTION[c.field] ?? "UPDATE",
        fieldName: c.field,
        before: c.before,
        after: c.after,
        afterSubmission: params.afterSubmission ?? false,
      })),
    });
  }
  return changes;
}

function serialize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
