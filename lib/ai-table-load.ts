import { prisma } from "@/lib/prisma";
import { canViewItems, type Actor } from "@/lib/permissions";
import { readFiles } from "@/lib/item-files";
import type { FactEvent, FactItem } from "@/lib/ai-table";

const JOURNAL_DAYS = 14;

/**
 * Все позиции дирекции (с удалёнными) и журнал правок за 14 дней — с теми же правами, что таблица в интерфейсе
 * (ЗГД таблицы не видит — для него null). Один запрос на позиции со связанными именами.
 */
export async function loadTableFacts(actor: Actor, directorateId?: string | null): Promise<{ items: FactItem[]; events: FactEvent[]; dict: { owners: string[]; segments: string[]; tracks: string[]; statuses: string[] } } | null> {
  const dir = directorateId ?? actor.directorateId;
  if (!canViewItems(actor.role) || !dir || (actor.directorateId && dir !== actor.directorateId)) return null;
  const [rows, segments, tracks, statuses, attractiveness, users] = await Promise.all([
    prisma.operationalItem.findMany({
      where: { directorateId: dir },
      select: {
        id: true, title: true, comment: true, cost: true, deadline: true, operFlag: true, archivedAt: true, createdAt: true, updatedAt: true, files: true,
        segment: { select: { name: true } }, track: { select: { name: true } }, status: { select: { name: true } }, attractiveness: { select: { name: true } },
        responsible: { select: { name: true } }, createdBy: { select: { name: true } }, updatedBy: { select: { name: true } },
      },
    }),
    prisma.segment.findMany({ where: { directorateId: dir }, select: { name: true } }),
    prisma.track.findMany({ where: { directorateId: dir }, select: { name: true } }),
    prisma.status.findMany({ select: { id: true, name: true } }),
    prisma.attractiveness.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ where: { directorateId: dir }, select: { id: true, name: true } }),
  ]);
  const items: FactItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    comment: r.comment,
    segment: r.segment?.name ?? null,
    track: r.track?.name ?? null,
    owner: r.responsible?.name ?? null,
    author: r.createdBy?.name ?? null,
    editor: r.updatedBy?.name ?? null,
    status: r.status?.name ?? null,
    attention: r.attractiveness?.name ?? null,
    cost: r.cost,
    deadline: r.deadline,
    submitted: r.operFlag,
    archived: !!r.archivedAt,
    files: readFiles(r.files).map((f) => ({ name: f.name, path: f.path })),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
  // в журнале статус, ответственный и «внимание» записаны id — показываем названиями
  const names = new Map<string, string>([...statuses, ...attractiveness, ...users].map((x) => [x.id, x.name]));
  const since = new Date(Date.now() - JOURNAL_DAYS * 86400000);
  const audit = await prisma.auditEvent.findMany({
    where: { entityType: "OperationalItem", entityId: { in: rows.map((r) => r.id) }, timestamp: { gte: since } },
    select: { entityId: true, timestamp: true, action: true, fieldName: true, before: true, after: true, actor: { select: { name: true } } },
    orderBy: { timestamp: "desc" },
    take: 400,
  });
  const nameOf = (v: string | null) => (v ? names.get(v) ?? v : null);
  const events: FactEvent[] = audit.map((a) => ({
    itemId: a.entityId,
    at: a.timestamp,
    who: a.actor?.name ?? null,
    action: a.action,
    field: a.fieldName,
    before: ["STATUS_CHANGE", "OWNER_CHANGE", "ATTRACTIVENESS_CHANGE"].includes(a.action) ? nameOf(a.before) : a.before,
    after: ["STATUS_CHANGE", "OWNER_CHANGE", "ATTRACTIVENESS_CHANGE"].includes(a.action) ? nameOf(a.after) : a.after,
  }));
  const owners = [...new Set(items.map((i) => i.owner).filter((x): x is string => !!x))];
  return { items, events, dict: { owners, segments: segments.map((s) => s.name), tracks: tracks.map((t) => t.name), statuses: statuses.map((s) => s.name) } };
}
