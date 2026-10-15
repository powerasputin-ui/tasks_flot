import { prisma } from "@/lib/prisma";
import { canViewItems, type Actor } from "@/lib/permissions";
import { readFiles } from "@/lib/item-files";
import type { FactEvent, FactItem } from "@/lib/ai-table";
import { buildEvents, columnOf, motionOf, type TrackerEvent } from "@/lib/tracker";
import type { TrackerColumn } from "@prisma/client";

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
        id: true, statusId: true, title: true, comment: true, cost: true, blockedBy: true, blockedUntil: true, expectedResult: true, originalDeadline: true, origin: true, zgdControl: true, deadline: true, operFlag: true, archivedAt: true, createdAt: true, updatedAt: true, files: true,
        segment: { select: { name: true } }, track: { select: { name: true } }, status: { select: { name: true } }, attractiveness: { select: { name: true } },
        responsible: { select: { name: true } }, createdBy: { select: { name: true } }, updatedBy: { select: { name: true } },
      },
    }),
    prisma.segment.findMany({ where: { directorateId: dir }, select: { name: true } }),
    prisma.track.findMany({ where: { directorateId: dir }, select: { name: true } }),
    prisma.status.findMany({ select: { id: true, name: true, trackerColumn: true } }),
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
    blockedBy: r.blockedBy,
    blockedUntil: r.blockedUntil,
    expectedResult: r.expectedResult,
    originalDeadline: r.originalDeadline,
    origin: r.origin,
    zgdControl: r.zgdControl,
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
  await attachMotion(items, rows.map((r) => ({ id: r.id, statusId: r.statusId })), statuses, [...statuses, ...users], dir);
  const owners = [...new Set(items.map((i) => i.owner).filter((x): x is string => !!x))];
  return { items, events, dict: { owners, segments: segments.map((s) => s.name), tracks: tracks.map((t) => t.name), statuses: statuses.map((s) => s.name) } };
}

/** Движение по «Трекеру» (весь журнал + отправленные справки) — в каждую позицию: колонка, переносы срока, простой, история. */
async function attachMotion(items: FactItem[], rows: Array<{ id: string; statusId: string | null }>, statuses: Array<{ id: string; trackerColumn: TrackerColumn | null }>, named: Array<{ id: string; name: string }>, dir: string) {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return;
  const [audit, versions, requests, pendingDl] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { entityType: "OperationalItem", entityId: { in: ids } },
      orderBy: { timestamp: "asc" },
      select: { entityId: true, action: true, fieldName: true, before: true, after: true, timestamp: true, actor: { select: { name: true } } },
    }),
    prisma.memoVersion.findMany({ where: { directorateId: dir }, orderBy: { sentAt: "asc" }, select: { title: true, sentAt: true, sources: true } }),
    prisma.zgdRequest.findMany({ where: { itemId: { in: ids }, answeredAt: null }, select: { itemId: true, dueAt: true } }),
    prisma.deadlineRequest.findMany({ where: { itemId: { in: ids }, decision: null }, select: { itemId: true, newDeadline: true, reason: true } }),
  ]);
  const known = new Set(ids);
  const names = new Map(named.map((x) => [x.id, x.name]));
  const events = buildEvents(
    audit.map((a) => ({ ...a, who: a.actor?.name ?? null })),
    versions.map((v) => ({ at: v.sentAt, title: v.title, itemIds: (Array.isArray(v.sources) ? (v.sources as Array<{ id?: string }>) : []).map((x) => x.id ?? "").filter((id) => known.has(id)) })),
    { status: names, user: names },
  );
  const byItem = new Map<string, TrackerEvent[]>();
  for (const e of events) byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), e]);
  const cols = new Map(statuses.map((st) => [st.id, st.trackerColumn]));
  const statusOf = new Map(rows.map((r) => [r.id, r.statusId]));
  for (const i of items) {
    i.motion = motionOf(byItem.get(i.id) ?? [], columnOf(statusOf.get(i.id), cols));
    const rq = requests.filter((q) => q.itemId === i.id);
    const dl = pendingDl.find((x) => x.itemId === i.id);
    if (dl) i.pendingDeadline = { newDeadline: dl.newDeadline, reason: dl.reason };
    if (rq.length) i.openRequests = { count: rq.length, dueAt: rq.map((q) => q.dueAt).filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime())[0] ?? null };
  }
}
