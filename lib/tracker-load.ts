import { prisma } from "@/lib/prisma";
import { getDicts } from "@/lib/dictionaries";
import { loadTableRows, type TableRow } from "@/lib/table-view";
import { signals, todayMsk, type FactEvent, type FactItem } from "@/lib/ai-table";
import { loadVersionTable } from "@/lib/archive-table-load";
import { buildZgdTracker, columnByName, type Publication, type SentRow, type SentVersion } from "@/lib/tracker-sent";
import type { PublishedSnapshot } from "@/lib/workflow-server";
import { buildEvents, columnOf, motionOf, type HotInfo, type MemoSent, type TrackerColumnKey, type TrackerEvent } from "@/lib/tracker";

export type TrackerData = {
  rows: TableRow[];
  statuses: Array<{ id: string; name: string; color: string | null; trackerColumn: TrackerColumnKey | null }>;
  events: TrackerEvent[];
  /** «Горит» — то же правило, что у ИИ (lib/ai-table.ts signals): id позиции → причины. */
  hot: Record<string, HotInfo>;
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
  blockedBy: r.blockedBy,
  blockedUntil: r.blockedUntil,
  expectedResult: r.expectedResult,
  originalDeadline: r.originalDeadline,
  origin: r.origin,
  zgdControl: r.zgdControl,
});

/** Права проверяет маршрут (canViewItems); данные — только своей дирекции, только действующие позиции. */
export async function loadTracker(directorateId: string): Promise<TrackerData> {
  const [rows, dicts, statuses, versions] = await Promise.all([
    loadTableRows("active", directorateId),
    getDicts(),
    prisma.status.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true, trackerColumn: true } }),
    prisma.memoVersion.findMany({ where: { directorateId }, orderBy: { sentAt: "asc" }, select: { title: true, sentAt: true, sources: true, revision: true } }),
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
    revision: v.revision,
    itemIds: (Array.isArray(v.sources) ? (v.sources as Array<{ id?: string }>) : []).map((s) => s.id ?? "").filter((id) => known.has(id)),
  }));
  const events = buildEvents(
    audit.map((a) => ({ ...a, who: a.actor?.name ?? null })),
    memos,
    { status: new Map([...dicts.statuses].map(([id, s]) => [id, s.name])), user: new Map([...dicts.users].map(([id, u]) => [id, u.name])) },
  );
  // сигналы: с движением по трекеру (ждёт приёмки) и открытыми запросами ЗГД
  const byItem = new Map<string, TrackerEvent[]>();
  for (const e of events) byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), e]);
  const cols = new Map(statuses.map((s) => [s.id, s.trackerColumn]));
  const [requests, pendingDl] = ids.length
    ? await Promise.all([
        prisma.zgdRequest.findMany({ where: { itemId: { in: ids }, answeredAt: null }, select: { itemId: true, dueAt: true } }),
        prisma.deadlineRequest.findMany({ where: { itemId: { in: ids }, decision: null }, select: { itemId: true, newDeadline: true, reason: true } }),
      ])
    : [[], []];
  const facts = rows.map((r) => {
    const rq = requests.filter((q) => q.itemId === r.id);
    const due = rq.map((q) => q.dueAt).filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const dl = pendingDl.find((x) => x.itemId === r.id);
    return { ...toFact(r), motion: motionOf(byItem.get(r.id) ?? [], columnOf(r.statusId, cols)), openRequests: rq.length ? { count: rq.length, dueAt: due } : undefined, pendingDeadline: dl ? { newDeadline: dl.newDeadline, reason: dl.reason } : null };
  });
  const hot = Object.fromEntries(signals(facts, todayMsk()).map((s) => [s.item.id, { kinds: s.kinds, reasons: s.reasons }]));
  return { rows, statuses, events, hot, since: audit[0]?.timestamp.toISOString() ?? null };
}

// ---------- ЗГД: трекер по отправленным справкам ----------

/** Снимки таблиц всех отправленных справок (ЗГД видит отправленное всех дирекций). */
async function loadZgdSources(): Promise<{ versions: SentVersion[]; publications: Publication[] }> {
  const { versions, cutoffs } = await loadSentVersions();
  // у дирекции, чью историю ограничили, подтверждения старше окна тоже не нужны — иначе они растут быстрее справок
  const pubs = await prisma.itemPublication.findMany({
    where: cutoffs.size ? { OR: [{ directorateId: { notIn: [...cutoffs.keys()] } }, ...[...cutoffs].map(([directorateId, at]) => ({ directorateId, publishedAt: { gte: at } }))] } : undefined,
    orderBy: { publishedAt: "asc" },
    select: { itemId: true, directorateId: true, publishedAt: true, publishedByName: true, reason: true, snapshot: true },
  });
  const dirs = new Map((await prisma.directorate.findMany({ select: { id: true, name: true, shortName: true } })).map((d) => [d.id, d.shortName || d.name]));
  const publications: Publication[] = pubs.map((p) => {
    const sn = p.snapshot as unknown as PublishedSnapshot;
    return {
      itemId: p.itemId,
      directorateId: p.directorateId,
      directorateName: dirs.get(p.directorateId) ?? "Дирекция",
      at: p.publishedAt,
      who: p.publishedByName,
      reason: p.reason,
      state: {
        name: sn.title, comment: sn.comment, segmentId: sn.segmentId, segmentName: sn.segmentName, trackName: sn.trackName, ownerName: sn.ownerName, statusName: sn.statusName, statusColor: sn.statusColor,
        deadline: sn.deadline, submitted: sn.submitted, expectedResult: sn.expectedResult, originalDeadline: sn.originalDeadline, blockedBy: sn.blockedBy, blockedUntil: sn.blockedUntil,
        cancelReason: sn.cancelReason, origin: sn.origin, zgdControl: sn.zgdControl, review: sn.review ? { result: sn.review.result, decision: sn.review.decision, decidedByName: sn.review.decidedByName, comment: sn.review.comment } : null,
      },
      only: sn.only,
    };
  });
  return { versions, publications };
}

/** Последнее подтверждённое (то, что ЗГД видит сейчас) по задачам дирекции. */
export async function zgdStateFor(directorateId: string): Promise<Map<string, SentRow>> {
  const { versions, publications } = await loadZgdSources();
  const built = buildZgdTracker(versions.filter((v) => v.directorateId === directorateId), publications.filter((p) => p.directorateId === directorateId));
  return new Map(built.rows.map((r) => [r.id, r]));
}

/** Сколько последних справок каждой дирекции читает трекер ЗГД: полная выгрузка всех таблиц за все годы растёт на каждом открытии. */
const ZGD_HISTORY_VERSIONS = 26;

async function loadSentVersions(): Promise<{ versions: SentVersion[]; cutoffs: Map<string, Date> }> {
  // сначала лёгкий список (без тяжёлых таблиц), потом — тяжёлое только по нужным
  const meta = await prisma.memoVersion.findMany({ orderBy: { sentAt: "desc" }, select: { id: true, directorateId: true, sentAt: true } });
  const taken = new Map<string, number>();
  const keep: string[] = [];
  const cutoffs = new Map<string, Date>();
  for (const m of meta) {
    const n = taken.get(m.directorateId) ?? 0;
    if (n < ZGD_HISTORY_VERSIONS) {
      keep.push(m.id);
      taken.set(m.directorateId, n + 1);
      if (n + 1 === ZGD_HISTORY_VERSIONS) cutoffs.set(m.directorateId, m.sentAt);
    }
  }
  const [versions, dirs] = await Promise.all([
    prisma.memoVersion.findMany({
      where: { id: { in: keep } },
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
  return { versions: out, cutoffs };
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
  confirmed: `${new Date(r.asOf).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })} (${r.confirmedBy})`,
  blockedBy: r.blockedBy,
  blockedUntil: r.blockedUntil ? new Date(r.blockedUntil) : null,
  expectedResult: r.expectedResult,
  originalDeadline: r.originalDeadline ? new Date(r.originalDeadline) : null,
  origin: r.origin,
  zgdControl: r.zgdControl,
});

const KIND_ACTION: Partial<Record<TrackerEvent["kind"], string>> = { status: "STATUS_CHANGE", deadline: "DEADLINE_CHANGE", owner: "OWNER_CHANGE", archived: "ARCHIVE" };

/** Трекер ЗГД для страницы: состояние на последнюю справку каждой дирекции и история между справками. */
export async function loadSentTracker(): Promise<TrackerData & { mode: "sent"; directorates: Array<{ id: string; name: string }>; people: Array<{ id: string; name: string; directorateId: string; role: string }> }> {
  const [built, statuses, directorates] = await Promise.all([
    loadZgdSources().then((x) => buildZgdTracker(x.versions, x.publications)),
    prisma.status.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true, trackerColumn: true } }),
    prisma.directorate.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, shortName: true } }),
  ]);
  // исполнители поручений ЗГД: действующие сотрудники дирекций, которые отвечают за позиции
  const people = await prisma.user.findMany({ where: { isActive: true, directorateId: { not: null }, OR: [{ role: { in: ["HEAD", "DIRECTOR"] } }, { role: "ADMIN", submits: true }] }, orderBy: { name: "asc" }, select: { id: true, name: true, directorateId: true, role: true } });
  // «на контроле» и поручения — пометки самого ЗГД: берём живые; удалённые дирекцией задачи у ЗГД не показываем
  const ids = built.rows.map((r) => r.id);
  const [live, requests] = await Promise.all([
    ids.length ? prisma.operationalItem.findMany({ where: { id: { in: ids } }, select: { id: true, zgdControl: true, origin: true, assignedById: true, archivedAt: true } }) : [],
    ids.length ? prisma.zgdRequest.findMany({ where: { itemId: { in: ids }, answeredAt: null }, select: { itemId: true, dueAt: true } }) : [],
  ]);
  const liveById = new Map(live.map((l) => [l.id, l]));
  const sent = { ...built, rows: built.rows.filter((r) => liveById.has(r.id) && !liveById.get(r.id)!.archivedAt).map((r) => ({ ...r, zgdControl: liveById.get(r.id)!.zgdControl, origin: liveById.get(r.id)!.origin })) };
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
    inMemo: r.inMemo,
    confirmedBy: r.confirmedBy,
    expectedResult: r.expectedResult,
    originalDeadline: r.originalDeadline,
    blockedBy: r.blockedBy,
    blockedUntil: r.blockedUntil,
    cancelReason: r.cancelReason,
    origin: r.origin,
    zgdControl: r.zgdControl,
    review: r.review,
    assignedById: liveById.get(r.id)?.assignedById ?? null,
  }));
  // движение по истории подтверждений: «на проверке N дн.», закрыта ли по колонке — как у директора, но по тому, что видит ЗГД
  const cols = new Map(statuses.map((st) => [st.name, st.trackerColumn]));
  const byItem = new Map<string, TrackerEvent[]>();
  for (const e of sent.events) byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), e]);
  const facts = sent.rows.map((r) => {
    const rq = requests.filter((q) => q.itemId === r.id);
    return { ...sentFact(r), motion: motionOf(byItem.get(r.id) ?? [], columnByName(r.statusName, cols)), openRequests: rq.length ? { count: rq.length, dueAt: rq.map((q) => q.dueAt).filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime())[0] ?? null } : undefined };
  });
  const hot = Object.fromEntries(signals(facts, todayMsk()).map((s) => [s.item.id, { kinds: s.kinds, reasons: s.reasons }]));
  const openReq = new Set(requests.map((q) => q.itemId));
  return { mode: "sent", rows: rows.map((r) => ({ ...r, openRequest: openReq.has(r.id) })) as unknown as TableRow[], statuses, events: sent.events, hot, since: sent.since, directorates: directorates.map((d) => ({ id: d.id, name: d.shortName || d.name })), people: people.map((p) => ({ id: p.id, name: p.name, directorateId: p.directorateId!, role: p.role })) };
}

/** Факты для ИИ ЗГД: позиции из последних справок с движением по трекеру и журнал — разница между справками. */
export async function loadSentFacts(): Promise<{ items: FactItem[]; events: FactEvent[]; dict: { owners: string[]; segments: string[]; tracks: string[]; statuses: string[] } } | null> {
  const [built, statuses] = await Promise.all([loadZgdSources().then((x) => buildZgdTracker(x.versions, x.publications)), prisma.status.findMany({ select: { name: true, trackerColumn: true } })]);
  // ровно то, что видно в трекере ЗГД: удалённые дирекцией — нет; «на контроле» и «поручение» — живые отметки ЗГД
  const live = built.rows.length ? await prisma.operationalItem.findMany({ where: { id: { in: built.rows.map((r) => r.id) }, archivedAt: null }, select: { id: true, zgdControl: true, origin: true } }) : [];
  const liveById = new Map(live.map((l) => [l.id, l]));
  const sent = { ...built, rows: built.rows.filter((r) => liveById.has(r.id)).map((r) => ({ ...r, zgdControl: liveById.get(r.id)!.zgdControl, origin: liveById.get(r.id)!.origin })), events: built.events.filter((e) => liveById.has(e.itemId)) };
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
