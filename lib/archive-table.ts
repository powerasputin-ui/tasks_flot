/**
 * Таблица оперативки на момент отправки справки ЗГД — неизменяемый снимок для архива.
 * Чистые функции: снимок собирается на сервере при отправке, фильтры и поиск работают и в интерфейсе.
 */
import { DEFAULT_LABEL, type ColumnConfig, type CustomCol, type StdKey } from "@/lib/table-columns";
import { matchesTokens, normalizeText, tokenize } from "@/lib/search";
import type { Cell, ExportSection } from "@/lib/export";

export type ArchiveColumn = { key: string; label: string; type?: CustomCol["type"] };
export type ArchiveSegment = { id: string; name: string; color: string | null };
/** Раскладка таблицы на момент отправки: какие столбцы и в каком порядке, как назывались, порядок сегментов. */
export type ArchiveLayout = { columns: ArchiveColumn[]; segments: ArchiveSegment[] };

export type ArchiveRow = {
  id: string;
  segmentId: string | null;
  segmentName: string | null;
  trackName: string | null;
  name: string;
  cost: string | null;
  attractivenessName: string | null;
  attractivenessColor: string | null;
  ownerName: string | null;
  ownerRole: string | null;
  deadline: string | null;
  deadlineWeek: number | null;
  statusName: string | null;
  statusColor: string | null;
  comment: string | null;
  customValues: Record<string, string>;
  /** Была отмечена «Оперативкой» — подана директору. */
  submitted: boolean;
  /** Вошла в отправленную справку (есть в видимом пункте). */
  inMemo: boolean;
};

/** "full" — снимок сохранён при отправке; "submitted" — старая справка, есть только поданные строки; "none" — таблица не сохранялась. */
export type ArchiveTableMode = "full" | "submitted" | "none";
export type ArchiveTable = ArchiveLayout & { mode: ArchiveTableMode; takenAt: string; rows: ArchiveRow[] };

/** Минимум полей строки таблицы, из которых собирается снимок (TableRow или строка старого Cycle.snapshot). */
type SourceRow = {
  id: string;
  segmentId: string | null;
  segmentName: string | null;
  trackName: string | null;
  name: string;
  cost: string | null;
  attractivenessName: string | null;
  attractivenessColor: string | null;
  ownerName: string | null;
  ownerRole: string | null;
  deadline: Date | string | null;
  deadlineWeek: number | null;
  statusName: string | null;
  statusColor: string | null;
  comment: string | null;
  operFlag: boolean;
  customValues?: Record<string, string> | null;
};

const HIDDEN_KEYS = new Set(["operFlag", "memo"]);
/** Столбцы старых снимков (до сохранения раскладки) — как таблица выглядела по умолчанию. */
const LEGACY_KEYS: StdKey[] = ["track", "name", "cost", "attractiveness", "owner", "deadline", "status", "comment"];

const iso = (d: Date | string | null) => (d == null ? null : typeof d === "string" ? d : d.toISOString());

function toArchiveRow(r: SourceRow, inMemo: Set<string>, submitted = r.operFlag, customValues = r.customValues ?? {}): ArchiveRow {
  return {
    id: r.id,
    segmentId: r.segmentId,
    segmentName: r.segmentName,
    trackName: r.trackName,
    name: r.name,
    cost: r.cost,
    attractivenessName: r.attractivenessName,
    attractivenessColor: r.attractivenessColor,
    ownerName: r.ownerName,
    ownerRole: r.ownerRole,
    deadline: iso(r.deadline),
    deadlineWeek: r.deadlineWeek,
    statusName: r.statusName,
    statusColor: r.statusColor,
    comment: r.comment,
    customValues,
    submitted,
    inMemo: inMemo.has(r.id),
  };
}

/** Строки — в порядке сегментов справочника, как в таблице; внутри сегмента порядок сохраняется. */
function sortBySegments<T extends { segmentId: string | null }>(rows: T[], segments: ArchiveSegment[]): T[] {
  const rank = new Map(segments.map((s, i) => [s.id, i]));
  const r = (x: T) => (x.segmentId ? rank.get(x.segmentId) ?? segments.length : segments.length + 1);
  return rows.map((x, i) => [x, i] as const).sort((a, b) => r(a[0]) - r(b[0]) || a[1] - b[1]).map(([x]) => x);
}

/** Раскладка столбцов для снимка: видимые столбцы таблицы дирекции, без «Оперативки» и «В справку» (их заменяют пометки). */
export function archiveLayout(columns: ColumnConfig[], custom: CustomCol[], segments: ArchiveSegment[]): ArchiveLayout {
  const types = new Map(custom.map((c) => [`custom:${c.id}`, c.type]));
  return {
    columns: columns
      .filter((c) => c.visible && !c.removed && !HIDDEN_KEYS.has(c.key))
      .map((c) => ({ key: c.key, label: c.label, ...(types.has(c.key) ? { type: types.get(c.key) } : {}) })),
    segments,
  };
}

/** Снимок всей таблицы на момент отправки. */
export function buildArchiveRows(rows: SourceRow[], inMemoIds: Iterable<string>, segments: ArchiveSegment[]): ArchiveRow[] {
  const inMemo = new Set(inMemoIds);
  return sortBySegments(rows, segments).map((r) => toArchiveRow(r, inMemo));
}

type LegacySnapRow = SourceRow & { customFields?: Array<{ name: string; type: string; value: string | null }> };

/** Старая справка: был сохранён только Cycle.snapshot — поданные строки, свои столбцы по названию. */
export function legacyArchiveTable(snapshot: unknown, inMemoIds: Iterable<string>, takenAt: string): ArchiveTable {
  const snap = (Array.isArray(snapshot) ? snapshot : []) as LegacySnapRow[];
  const inMemo = new Set(inMemoIds);
  const customDefs = snap[0]?.customFields ?? [];
  const segments: ArchiveSegment[] = [];
  for (const r of snap) if (r.segmentId && !segments.some((s) => s.id === r.segmentId)) segments.push({ id: r.segmentId, name: r.segmentName ?? "", color: null });
  segments.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return {
    mode: "submitted",
    takenAt,
    columns: [
      ...LEGACY_KEYS.map((k) => ({ key: k, label: DEFAULT_LABEL[k] })),
      ...customDefs.map((f, i) => ({ key: `custom:legacy${i}`, label: f.name, type: f.type as CustomCol["type"] })),
    ],
    segments,
    rows: sortBySegments(snap, segments).map((r) =>
      toArchiveRow(r, inMemo, true, Object.fromEntries((r.customFields ?? []).flatMap((f, i) => (f.value ? [[`legacy${i}`, f.value]] : []))))
    ),
  };
}

export type ArchiveView = "all" | "submitted" | "memo";
export type ArchiveFilter = { view: ArchiveView; q?: string; segmentId?: string | null };

const ruDate = (v: string) => new Date(v).toLocaleDateString("ru-RU");

export function archiveHaystack(r: ArchiveRow): string {
  return normalizeText(
    [r.name, r.comment, r.cost, r.trackName, r.segmentName, r.ownerName, r.statusName, r.attractivenessName, r.deadline ? `${ruDate(r.deadline)} ${r.deadline.slice(0, 10)}` : null, ...Object.values(r.customValues)]
      .filter(Boolean)
      .join(" ")
  );
}

export function filterArchiveRows(rows: ArchiveRow[], f: ArchiveFilter): ArchiveRow[] {
  const tokens = tokenize(f.q ?? "");
  return rows.filter((r) => {
    if (f.view === "submitted" && !r.submitted) return false;
    if (f.view === "memo" && !r.inMemo) return false;
    if (f.segmentId !== undefined && f.segmentId !== null && (r.segmentId ?? "none") !== f.segmentId) return false;
    if (tokens.length && !matchesTokens(archiveHaystack(r), tokens)) return false;
    return true;
  });
}

/** Значение ячейки текстом — для выгрузки (в интерфейсе ячейки рисуются отдельно). */
export function archiveCellText(r: ArchiveRow, c: ArchiveColumn): Cell {
  switch (c.key) {
    case "track":
      return r.trackName;
    case "name":
      return r.name;
    case "cost":
      return r.cost;
    case "attractiveness":
      return r.attractivenessName;
    case "owner":
      return r.ownerName;
    case "deadline":
      return r.deadline ? ruDate(r.deadline) : null;
    case "deadlineWeek":
      return r.deadlineWeek;
    case "status":
      return r.statusName;
    case "comment":
      return r.comment;
    default: {
      const v = c.key.startsWith("custom:") ? r.customValues[c.key.slice("custom:".length)] : undefined;
      if (!v) return null;
      return c.type === "DATE" ? ruDate(v) : v;
    }
  }
}

export function archiveTableSections(t: ArchiveLayout, rows: ArchiveRow[]): ExportSection[] {
  return [
    {
      title: "Таблица",
      headers: ["Сегмент", ...t.columns.map((c) => c.label), "Подано директору", "В справке"],
      rows: rows.map((r) => [r.segmentName ?? "Без сегмента", ...t.columns.map((c) => archiveCellText(r, c)), r.submitted ? "да" : "", r.inMemo ? "да" : ""]),
    },
  ];
}
