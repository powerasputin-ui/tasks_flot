import { prisma } from "@/lib/prisma";
import { getDicts } from "@/lib/dictionaries";
import { loadTableRows, type TableRow } from "@/lib/table-view";
import { signals, todayMsk, type FactEvent, type FactItem } from "@/lib/ai-table";
import { loadVersionTable } from "@/lib/archive-table-load";
import { buildSentTracker, columnByName, type SentRow, type SentVersion } from "@/lib/tracker-sent";
import { buildEvents, motionOf, type MemoSent, type TrackerColumnKey, type TrackerEvent } from "@/lib/tracker";

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

// ---------- ЗГД: трекер по отправленным справкам ----------

/** Снимки таблиц всех отправленных справок (ЗГД видит отправленное всех дирекций). */
async function loadSentVersions(): Promise<SentVersion[]> {
  const [versions, dirs] = await Promise.all([
    prisma.memoVersion.findMany({
      orderBy: { sentAt: "asc" },
      select: { id: true, cycleId: true, directorateId: true, sentAt: true, title: true, rows: true, columns: true, sources: true, cycle: { select: { snapshot: true } } },
    }),
    prisma.directorate.findMany({ select: { id: true, name: true, shortName: true } }),
  ]);
  const dirName = new Map(dirs.map((d) => [d.id, d.shortName || d.name]));
  const out: SentVersion[] = [];
  for (const v of versions) {
    const t = await loadVersionTable(v, v.cycle.snapshot);
    out.push({ directorateId: v.directorateId, directorateName: dirName.get(v.directorateId) ?? "Дирекция", sentAt: v.sentAt, title: v.title, rows: t.rows });
  }
  return out;
}

const sentFact = (r: SentRow): FactItem => ({
  id: r.id,
  title: r.name,
  comment: r.comment,
  segment: r.segmentName,
  track: r.trackName,
  owner: r.ownerName,
  author: null,
  editor: null,
  status: r.statusName,
  attention: null,
  cost: null,
  deadline: r.deadline ? new Date(r.deadline) : null,
  submitted: r.submitted,
  archived: false,
  files: [],
  createdAt: new Date(r.asOf),
  updatedAt: new Date(r.asOf),
  directorate: r.directorateName,
});

const KIND_ACTION: Partial<Record<TrackerEvent["kind"], string>> = { status: "STATUS_CHANGE", deadline: "DEADLINE_CHANGE", owner: "OWNER_CHANGE", archived: "ARCHIVE" };

/** Трекер ЗГД для страницы: состояние на последнюю справку каждой дирекции и история между справками. */
export async function loadSentTracker(): Promise<TrackerData & { mode: "sent" }> {
  const [sent, statuses] = await Promise.all([
    loadSentVersions().then(buildSentTracker),
    prisma.status.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true, trackerColumn: true } }),
  ]);
  const idByName = new Map(statuses.map((s) => [s.name, s.id]));
  const rows = sent.rows.map((r) => ({
    id: r.id,
    segmentId: r.segmentId,
    segmentName: r.segmentName,
    trackId: null,
    trackName: r.trackName,
    name: r.name,
    cost: null,
    attractivenessId: null,
    ownerId: r.ownerName, // у ЗГД фильтр «Ответственный» — по имени из снимка
    ownerName: r.ownerName,
    deadline: r.deadline,
    statusId: r.statusName ? idByName.get(r.statusName) ?? null : null,
    statusName: r.statusName,
    statusColor: r.statusColor,
    operFlag: r.submitted,
    comment: r.comment,
    version: 0,
    archived: false,
    createdById: "",
    createdByName: "",
    updatedAt: r.asOf,
    directorateId: r.directorateId,
    directorateName: r.directorateName,
    asOf: r.asOf,
  }));
  const hot = Object.fromEntries(signals(sent.rows.map(sentFact), todayMsk()).map((s) => [s.item.id, s.reasons]));
  return { mode: "sent", rows: rows as unknown as TableRow[], statuses, events: sent.events, hot, since: sent.since };
}

/** Факты для ИИ ЗГД: позиции из последних справок с движением по трекеру и журнал — разница между справками. */
export async function loadSentFacts(): Promise<{ items: FactItem[]; events: FactEvent[]; dict: { owners: string[]; segments: string[]; tracks: string[]; statuses: string[] } } | null> {
  const [sent, statuses] = await Promise.all([loadSentVersions().then(buildSentTracker), prisma.status.findMany({ select: { name: true, trackerColumn: true } })]);
  if (!sent.rows.length) return null;
  const cols = new Map(statuses.map((s) => [s.name, s.trackerColumn]));
  const byItem = new Map<string, TrackerEvent[]>();
  for (const e of sent.events) byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), e]);
  const items = sent.rows.map((r) => ({ ...sentFact(r), motion: motionOf(byItem.get(r.id) ?? [], columnByName(r.statusName, cols)) }));
  const events: FactEvent[] = sent.events
    .filter((e) => e.kind !== "text" && e.kind !== "memo")
    .map((e) => ({ itemId: e.itemId, at: new Date(e.at), who: e.who, action: e.kind === "submitted" ? "OPER_FLAG_CHANGE" : KIND_ACTION[e.kind] ?? "NOTE", field: KIND_ACTION[e.kind] ? null : e.text, before: e.before ?? null, after: e.kind === "submitted" ? "true" : e.after ?? null }));
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x))];
  return { items, events, dict: { owners: uniq(items.map((i) => i.owner)), segments: uniq(items.map((i) => i.segment)), tracks: uniq(items.map((i) => i.track)), statuses: statuses.map((s) => s.name) } };
}
