import { prisma } from "@/lib/prisma";
import { getDicts } from "@/lib/dictionaries";
import { loadTableRows, type TableRow } from "@/lib/table-view";
import { signals, todayMsk, type FactItem } from "@/lib/ai-table";
import { buildEvents, type MemoSent, type TrackerColumnKey, type TrackerEvent } from "@/lib/tracker";

export type TrackerData = {
  rows: TableRow[];
  statuses: Array<{ id: string; name: string; color: string | null; trackerColumn: TrackerColumnKey | null }>;
  events: TrackerEvent[];
  /** «Горит» — то же правило, что у ИИ (lib/ai-table.ts signals): id позиции → причины. */
  hot: Record<string, string[]>;
  /** С какого дня ведётся журнал — история раньше этой даты неизвестна. */
  since: string | null;
};

/** Позиция таблицы в виде «факта» для правила «горит». */
const toFact = (r: TableRow): FactItem => ({
  id: r.id,
  title: r.name,
  comment: r.comment,
  segment: r.segmentName,
  track: r.trackName,
  owner: r.ownerName,
  author: r.createdByName,
  editor: null,
  status: r.statusName,
  attention: r.attractivenessName,
  cost: r.cost,
  deadline: r.deadline,
  submitted: r.operFlag,
  archived: r.archived,
  files: r.files,
  createdAt: r.updatedAt,
  updatedAt: r.updatedAt,
});

/** Права проверяет маршрут (canViewItems); данные — только своей дирекции, только действующие позиции. */
export async function loadTracker(directorateId: string): Promise<TrackerData> {
  const [rows, dicts, statuses, versions] = await Promise.all([
    loadTableRows("active", directorateId),
    getDicts(),
    prisma.status.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true, trackerColumn: true } }),
    prisma.memoVersion.findMany({ where: { directorateId }, orderBy: { sentAt: "asc" }, select: { title: true, sentAt: true, sources: true } }),
  ]);
  const ids = rows.map((r) => r.id);
  const audit = ids.length
    ? await prisma.auditEvent.findMany({
        where: { entityType: "OperationalItem", entityId: { in: ids } },
        orderBy: { timestamp: "asc" },
        select: { entityId: true, action: true, fieldName: true, before: true, after: true, timestamp: true, actor: { select: { name: true } } },
      })
    : [];
  const known = new Set(ids);
  const memos: MemoSent[] = versions.map((v) => ({
    at: v.sentAt,
    title: v.title,
    itemIds: (Array.isArray(v.sources) ? (v.sources as Array<{ id?: string }>) : []).map((s) => s.id ?? "").filter((id) => known.has(id)),
  }));
  const events = buildEvents(
    audit.map((a) => ({ ...a, who: a.actor?.name ?? null })),
    memos,
    { status: new Map([...dicts.statuses].map(([id, s]) => [id, s.name])), user: new Map([...dicts.users].map(([id, u]) => [id, u.name])) },
  );
  const hot = Object.fromEntries(signals(rows.map(toFact), todayMsk()).map((s) => [s.item.id, s.reasons]));
  return { rows, statuses, events, hot, since: audit[0]?.timestamp.toISOString() ?? null };
}
