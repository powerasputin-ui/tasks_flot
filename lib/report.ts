import type { TableRow } from "@/lib/table-view";
import { ATTRACTIVENESS_LABEL } from "@/lib/attractiveness";
import { COLUMN_LABEL, GROUP_LABEL, resolveConfig, type GroupKey, type ReportConfig, type StdColumn } from "@/lib/report-config";

/**
 * Движок отчёта: из списка позиций и конфигурации строит единую модель (сводка + дерево групп).
 * Экран «Оперативка» и выгрузки Excel/PDF/PowerPoint только рисуют эту модель — поэтому совпадают.
 * Чистая логика без базы: работает и на живых данных, и на финальном снимке цикла.
 */
export type CustomColumnInfo = { id: string; name: string; type: string };

export type ReportContext = {
  directorate: string;
  generatedAt: Date;
  customColumns: CustomColumnInfo[];
  /** «Сейчас» для расчёта просрочки (в тестах фиксируется). */
  now?: Date;
};

export type StatusCount = { name: string; color: string | null; count: number };

export type ReportSummary = {
  total: number;
  byStatus: StatusCount[];
  byAttractiveness: Array<{ name: string; label: string | null; count: number }>;
  overdue: number;
  sent: number;
};

export type ReportRow = {
  id: string;
  /** Значения выбранных колонок (только видимых: без тех, что уже стали группами). */
  cells: Record<string, string>;
  /** Комментарий для режима «строкой под задачей». */
  comment: string | null;
  overdue: boolean;
  archived: boolean;
  /** Цвет статуса — чтобы экран мог нарисовать плашку. */
  statusColor: string | null;
};

export type ReportGroup = {
  key: string;
  level: GroupKey;
  label: string;
  count: number;
  byStatus: StatusCount[];
  groups?: ReportGroup[];
  rows?: ReportRow[];
};

export type ReportModel = {
  title: string;
  directorate: string;
  generatedAt: string;
  columns: Array<{ key: string; label: string }>;
  groupBy: GroupKey[];
  showSummary: boolean;
  commentsMode: "column" | "underTask" | "hide";
  summary: ReportSummary;
  /** Есть группировка — дерево групп; иначе плоский список rows. */
  groups: ReportGroup[] | null;
  rows: ReportRow[] | null;
};

const NO_VALUE: Record<GroupKey, string> = { segment: "Без сегмента", track: "Без трека", owner: "Без ответственного", status: "Без статуса" };
const DONE_STATUSES = ["Завершено", "Не актуально"];

const ruDate = (d: Date) => d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

export function isOverdue(r: Pick<TableRow, "deadline" | "statusName" | "archived">, now: Date): boolean {
  if (!r.deadline || r.archived) return false;
  if (r.statusName && DONE_STATUSES.includes(r.statusName)) return false;
  return new Date(r.deadline) < now;
}

function groupValue(r: TableRow, key: GroupKey): { id: string; label: string } {
  switch (key) {
    case "segment":
      return { id: r.segmentId ?? "none", label: r.segmentName ?? NO_VALUE.segment };
    case "track":
      return { id: r.trackId ?? "none", label: r.trackName ?? NO_VALUE.track };
    case "owner":
      return { id: r.ownerId ?? "none", label: r.ownerName ?? NO_VALUE.owner };
    case "status":
      return { id: r.statusId ?? "none", label: r.statusName ?? NO_VALUE.status };
  }
}

function statusCounts(rows: TableRow[]): StatusCount[] {
  const map = new Map<string, StatusCount>();
  for (const r of rows) {
    const name = r.statusName ?? "Без статуса";
    const cur = map.get(name);
    if (cur) cur.count++;
    else map.set(name, { name, color: r.statusColor, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"));
}

function summarize(rows: TableRow[], now: Date): ReportSummary {
  const attr = new Map<string, number>();
  for (const r of rows) {
    const n = r.attractivenessName ?? "P0";
    attr.set(n, (attr.get(n) ?? 0) + 1);
  }
  return {
    total: rows.length,
    byStatus: statusCounts(rows),
    byAttractiveness: [...attr.entries()]
      .map(([name, count]) => ({ name, label: ATTRACTIVENESS_LABEL[name] ?? null, count }))
      .sort((a, b) => (parseInt(b.name.slice(1), 10) || 0) - (parseInt(a.name.slice(1), 10) || 0)),
    overdue: rows.filter((r) => isOverdue(r, now)).length,
    sent: rows.filter((r) => r.operFlag).length,
  };
}

function applyFilters(rows: TableRow[], f: NonNullable<ReportConfig["filters"]>, now: Date): TableRow[] {
  return rows.filter((r) => {
    if (f.segmentIds?.length && !f.segmentIds.includes(r.segmentId ?? "none")) return false;
    if (f.trackIds?.length && !f.trackIds.includes(r.trackId ?? "none")) return false;
    if (f.statusIds?.length && !f.statusIds.includes(r.statusId ?? "none")) return false;
    if (f.ownerIds?.length && !f.ownerIds.includes(r.ownerId ?? "none")) return false;
    if (f.attractivenessIds?.length && !f.attractivenessIds.includes(r.attractivenessId ?? "none")) return false;
    if (f.sentOnly && !r.operFlag) return false;
    if (f.overdueOnly && !isOverdue(r, now)) return false;
    return true;
  });
}

function sortRows(rows: TableRow[], sort: { by: string; dir: "asc" | "desc" }): TableRow[] {
  const dir = sort.dir === "desc" ? -1 : 1;
  const key = (r: TableRow): string | number | null => {
    switch (sort.by) {
      case "deadline":
        return r.deadline ? new Date(r.deadline).getTime() : null;
      case "name":
        return r.name.toLowerCase();
      case "status":
        return r.statusName ?? "";
      case "owner":
        return r.ownerName ?? "";
      case "updatedAt":
        return new Date(r.updatedAt).getTime();
      default:
        return null;
    }
  };
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1; // пустые всегда внизу
    if (ka < kb) return -1 * dir;
    if (ka > kb) return 1 * dir;
    return 0;
  });
}

function cellValue(r: TableRow, key: string, custom: Map<string, CustomColumnInfo>): string {
  switch (key as StdColumn) {
    case "segment":
      return r.segmentName ?? NO_VALUE.segment;
    case "track":
      return r.trackName ?? "—";
    case "name":
      return r.name;
    case "cost":
      return r.cost ?? "—";
    case "attractiveness":
      return r.attractivenessName ?? "P0";
    case "owner":
      return r.ownerName ?? "—";
    case "deadline":
      return r.deadline ? ruDate(new Date(r.deadline)) : "—";
    case "status":
      return r.statusName ?? "—";
    case "operFlag":
      return r.operFlag ? "да" : "нет";
    case "comment":
      return r.comment ?? "—";
  }
  if (key.startsWith("custom:")) {
    const v = r.customValues?.[key.slice("custom:".length)];
    if (!v) return "—";
    return custom.get(key.slice("custom:".length))?.type === "DATE" ? ruDate(new Date(v)) : v;
  }
  return "—";
}

export function buildReport(allRows: TableRow[], config: ReportConfig, ctx: ReportContext): ReportModel {
  const cfg = resolveConfig(config);
  const now = ctx.now ?? new Date();
  const custom = new Map(ctx.customColumns.map((c) => [c.id, c]));

  const rows = sortRows(applyFilters(allRows, cfg.filters, now), cfg.sort);

  // Комментарии показываются, только если «Комментарий» выбран в списке колонок и режим не «Не показывать».
  // Режим решает как: отдельной колонкой (на своём месте в списке) или строкой под задачей.
  const commentsMode = cfg.options.comments;
  const commentOn = cfg.columns.includes("comment") && commentsMode !== "hide";
  const keys = cfg.columns.filter((k) => k !== "comment");
  if (commentOn && commentsMode === "column") keys.splice(cfg.columns.slice(0, cfg.columns.indexOf("comment")).filter((k) => k !== "comment").length, 0, "comment");
  const columns = keys
    .filter((k) => !(cfg.groupBy as string[]).includes(k))
    .filter((k) => (k.startsWith("custom:") ? custom.has(k.slice("custom:".length)) : k in COLUMN_LABEL))
    .map((k) => ({ key: k, label: k.startsWith("custom:") ? custom.get(k.slice("custom:".length))!.name : COLUMN_LABEL[k as StdColumn] }));

  const toReportRow = (r: TableRow): ReportRow => ({
    id: r.id,
    cells: Object.fromEntries(columns.map((c) => [c.key, cellValue(r, c.key, custom)])),
    comment: commentOn && commentsMode === "underTask" ? r.comment : null,
    overdue: isOverdue(r, now),
    archived: r.archived,
    statusColor: r.statusColor,
  });

  const build = (list: TableRow[], levels: GroupKey[]): ReportGroup[] => {
    const [level, ...rest] = levels;
    const buckets = new Map<string, { label: string; rows: TableRow[] }>();
    for (const r of list) {
      const g = groupValue(r, level);
      const b = buckets.get(g.id) ?? { label: g.label, rows: [] };
      b.rows.push(r);
      buckets.set(g.id, b);
    }
    return [...buckets.entries()]
      .sort(([ia, a], [ib, b]) => (ia === "none" ? 1 : 0) - (ib === "none" ? 1 : 0) || a.label.localeCompare(b.label, "ru"))
      .map(([id, b]) => ({
        key: `${level}:${id}`,
        level,
        label: b.label,
        count: b.rows.length,
        byStatus: statusCounts(b.rows),
        ...(rest.length ? { groups: build(b.rows, rest) } : { rows: b.rows.map(toReportRow) }),
      }));
  };

  const fallbackTitle = cfg.groupBy.length ? "Оперативка" : "Список позиций";
  return {
    title: cfg.title?.trim() || fallbackTitle,
    directorate: ctx.directorate,
    generatedAt: ctx.generatedAt.toISOString(),
    columns,
    groupBy: cfg.groupBy,
    showSummary: cfg.options.summary,
    commentsMode,
    summary: summarize(rows, now),
    groups: cfg.groupBy.length ? build(rows, cfg.groupBy) : null,
    rows: cfg.groupBy.length ? null : rows.map(toReportRow),
  };
}

/** Подпись уровня группировки для заголовков («Сегмент: …»). */
export const groupLevelLabel = (level: GroupKey): string => GROUP_LABEL[level];

type SnapshotRow = Record<string, unknown> & { customFields?: Array<{ name: string; type: string; value: string | null }> };

/**
 * Финальный снимок цикла → строки для движка отчёта. Свои колонки в снимке сохранены под названиями (на момент фиксации),
 * поэтому им выдаются временные id f0, f1… — так отчёт по финалу не зависит от того, что потом переименовали или удалили.
 */
export function snapshotToRows(snapshot: unknown): { rows: TableRow[]; customColumns: CustomColumnInfo[] } {
  const list = (Array.isArray(snapshot) ? snapshot : []) as SnapshotRow[];
  const customColumns = (list[0]?.customFields ?? []).map((f, i) => ({ id: `f${i}`, name: f.name, type: f.type }));
  const rows = list.map((r) => ({
    ...(r as unknown as TableRow),
    customValues: Object.fromEntries((r.customFields ?? []).flatMap((f, i) => (f.value ? [[`f${i}`, f.value]] : []))),
  }));
  return { rows, customColumns };
}

/** Модель отчёта по финалу. Если в настройках есть «свои» колонки, они заменяются колонками из снимка. */
export function buildFinalModel(cycle: { snapshot: unknown; finalizedAt: Date | null; number: number }, config: ReportConfig, directorate: string): ReportModel {
  const { rows, customColumns } = snapshotToRows(cycle.snapshot);
  const hasCustom = config.columns.some((c) => c.startsWith("custom:"));
  const columns = hasCustom ? [...config.columns.filter((c) => !c.startsWith("custom:")), ...customColumns.map((c) => `custom:${c.id}`)] : config.columns;
  return buildReport(rows, { ...config, columns, title: config.title || `Оперативка №${cycle.number}` }, { directorate, generatedAt: cycle.finalizedAt ?? new Date(), customColumns });
}
