import { prisma } from "@/lib/prisma";

/**
 * Журнал правок для трекера и ИИ. Читать его целиком при каждом открытии нельзя: он только растёт (каждая правка, подача,
 * действие — строка, в ней тексты «было / стало» до 2000 знаков). Берём окно по времени и потолок по числу строк:
 * свежее важнее старого, а «история известна с …» честно показывает, с какого момента данные есть.
 */
export const AUDIT_WINDOW_DAYS = 540;
export const AUDIT_MAX_ROWS = 15_000;

const DAY = 24 * 3600 * 1000;

export type AuditRow = {
  entityId: string;
  action: string;
  fieldName: string | null;
  before: string | null;
  after: string | null;
  timestamp: Date;
  actor: { name: string } | null;
};

/** События позиций за окно, по возрастанию времени; truncated — старое отрезано (по окну или потолку). */
export async function loadAuditWindow(ids: string[], opts: { now?: Date; days?: number; max?: number } = {}): Promise<{ rows: AuditRow[]; truncated: boolean }> {
  if (!ids.length) return { rows: [], truncated: false };
  const now = opts.now ?? new Date();
  const max = opts.max ?? AUDIT_MAX_ROWS;
  const since = new Date(now.getTime() - (opts.days ?? AUDIT_WINDOW_DAYS) * DAY);
  // свежие первыми и на одну лишнюю — по ней видно, что потолок сработал
  const rows = await prisma.auditEvent.findMany({
    where: { entityType: "OperationalItem", entityId: { in: ids }, timestamp: { gte: since } },
    orderBy: { timestamp: "desc" },
    take: max + 1,
    select: { entityId: true, action: true, fieldName: true, before: true, after: true, timestamp: true, actor: { select: { name: true } } },
  });
  const capped = rows.length > max;
  if (capped) rows.pop();
  const olderOutside = !capped && !!(await prisma.auditEvent.findFirst({ where: { entityType: "OperationalItem", entityId: { in: ids }, timestamp: { lt: since } }, select: { id: true } }));
  return { rows: rows.reverse(), truncated: capped || olderOutside };
}
