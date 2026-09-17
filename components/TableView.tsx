"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Ref = { id: string; name: string };

type TableRow = {
  id: string;
  type: "TRACK" | "TASK" | "VESSEL_OPTION";
  segmentName: string | null;
  trackId: string;
  trackName: string;
  name: string;
  cost: string | null;
  attractivenessName: string | null;
  ownerName: string | null;
  deadline: string | null;
  deadlineWeek: number | null;
  updatedAt: string;
  staleWeeks: number;
  statusName: string | null;
  statusColor: string | null;
  operFlag: boolean;
  comment: string | null;
};

/** Детерминированный цвет по строке (для Ответственного, у которого нет своего поля color в БД). */
function stringToColor(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = input.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

const TYPE_LABEL: Record<TableRow["type"], string> = {
  TRACK: "Трек",
  TASK: "Задача",
  VESSEL_OPTION: "Судно",
};

/**
 * Реестр всех возможных колонок таблицы. По запросу заказчика колонки должны
 * быть настраиваемые: показать/скрыть, переименовать, изменить порядок и ширину.
 * Набор и порядок по умолчанию — как назвал заказчик (близко к исходному Excel),
 * "Тип"/"Неделя"/"Опер" оставлены доступными, но скрыты по умолчанию.
 */
type ColumnKey =
  | "segment"
  | "track"
  | "type"
  | "cost"
  | "attractiveness"
  | "updatedAt"
  | "name"
  | "deadline"
  | "deadlineWeek"
  | "owner"
  | "status"
  | "operFlag"
  | "comment";

type ColumnConfig = { key: ColumnKey; label: string; visible: boolean; width: number };

const DEFAULT_LABEL: Record<ColumnKey, string> = {
  segment: "Сегмент",
  track: "Трек",
  type: "Тип",
  cost: "Оценка $",
  attractiveness: "Потребность",
  updatedAt: "Дата",
  name: "Задача",
  deadline: "Срок",
  deadlineWeek: "Неделя",
  owner: "Ответственный",
  status: "Статус",
  operFlag: "Опер",
  comment: "Комментарии",
};

const ALL_KEYS: ColumnKey[] = [
  "segment",
  "track",
  "cost",
  "attractiveness",
  "updatedAt",
  "name",
  "deadline",
  "owner",
  "status",
  "comment",
  "type",
  "deadlineWeek",
  "operFlag",
];

const WIDTH: Record<ColumnKey, number> = {
  segment: 140,
  track: 200,
  type: 90,
  cost: 110,
  attractiveness: 130,
  updatedAt: 110,
  name: 260,
  deadline: 110,
  deadlineWeek: 80,
  owner: 150,
  status: 130,
  operFlag: 70,
  comment: 260,
};

function buildColumns(visibleKeys: ColumnKey[]): ColumnConfig[] {
  const ordered = [...visibleKeys, ...ALL_KEYS.filter((k) => !visibleKeys.includes(k))];
  return ordered.map((key) => ({ key, label: DEFAULT_LABEL[key], visible: visibleKeys.includes(key), width: WIDTH[key] }));
}

/**
 * Единый экран (Треки/Задачи/Варианты судов больше не отдельные страницы —
 * фильтруются через "Тип" в одной таблице, раздел 107-108: одна модель данных).
 */
const DEFAULT_COLUMNS: ColumnConfig[] = buildColumns([
  "segment",
  "track",
  "type",
  "name",
  "cost",
  "attractiveness",
  "owner",
  "deadline",
  "status",
  "updatedAt",
  "comment",
]);

const STORAGE_KEY = "tasksflot.tableColumns.v3";

function loadColumns(): ColumnConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const parsed = JSON.parse(raw) as ColumnConfig[];
    const known = new Set(parsed.map((c) => c.key));
    return [...parsed, ...DEFAULT_COLUMNS.filter((c) => !known.has(c.key))];
  } catch {
    return DEFAULT_COLUMNS;
  }
}

const SORT_OPTIONS = [
  { value: "", label: "Без сортировки" },
  { value: "deadline", label: "Срок" },
  { value: "deadlineWeek", label: "Неделя" },
  { value: "updatedAt", label: "Дата" },
  { value: "status", label: "Статус" },
  { value: "attractiveness", label: "Потребность" },
  { value: "owner", label: "Ответственный" },
  { value: "segment", label: "Сегмент" },
];

export function TableView() {
  const [rows, setRows] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [segments, setSegments] = useState<Ref[]>([]);
  const [statuses, setStatuses] = useState<Ref[]>([]);
  const [attractiveness, setAttractiveness] = useState<Ref[]>([]);
  const [users, setUsers] = useState<Ref[]>([]);
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [configOpen, setConfigOpen] = useState(false);

  const [segmentId, setSegmentId] = useState("");
  const [type, setType] = useState<"" | TableRow["type"]>("");
  const [statusId, setStatusId] = useState("");
  const [attractivenessId, setAttractivenessId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [operFlag, setOperFlag] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    setColumns(loadColumns());
  }, []);

  function saveColumns(next: ColumnConfig[]) {
    setColumns(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // per-viewer удобство, не критично если недоступно (приватный режим и т.п.)
    }
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/segments").then((r) => r.json()),
      fetch("/api/statuses").then((r) => r.json()),
      fetch("/api/attractiveness").then((r) => r.json()),
      fetch("/api/users").then((r) => r.json()),
    ]).then(([s, st, a, u]) => {
      setSegments(s.segments);
      setStatuses(st.statuses);
      setAttractiveness(a.attractiveness);
      setUsers(u.users);
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (segmentId) params.set("segmentId", segmentId);
    if (statusId) params.set("statusId", statusId);
    if (attractivenessId) params.set("attractivenessId", attractivenessId);
    if (ownerId) params.set("ownerId", ownerId);
    if (operFlag) params.set("operFlag", operFlag);
    if (sortBy) {
      params.set("sortBy", sortBy);
      params.set("sortDir", sortDir);
    }
    setLoading(true);
    fetch(`/api/table?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []))
      .finally(() => setLoading(false));
  }, [type, segmentId, statusId, attractivenessId, ownerId, operFlag, sortBy, sortDir]);

  const isOverdue = useMemo(
    () => (row: TableRow) => {
      if (row.type !== "TASK" || !row.deadline) return false;
      if (row.statusName === "Завершено" || row.statusName === "Не актуально") return false;
      return new Date(row.deadline) < new Date();
    },
    []
  );

  const visibleColumns = columns.filter((c) => c.visible);

  function renderCell(row: TableRow, col: ColumnConfig) {
    switch (col.key) {
      case "segment":
        return row.segmentName ?? "—";
      case "track":
        return (
          <Link href={`/tracks/${row.trackId}`} className="link-subtle">
            {row.trackName}
          </Link>
        );
      case "type":
        return (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
            {TYPE_LABEL[row.type]}
          </span>
        );
      case "cost":
        return row.cost ?? "—";
      case "attractiveness":
        return row.attractivenessName ?? "—";
      case "updatedAt":
        return (
          <span className="inline-flex items-center gap-1.5">
            {row.staleWeeks >= 1 && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-amber-400"
                title={`Не обновлялось ${row.staleWeeks} нед.`}
              />
            )}
            {new Date(row.updatedAt).toLocaleDateString("ru-RU")}
          </span>
        );
      case "name":
        return row.name;
      case "deadline":
        return row.deadline ? new Date(row.deadline).toLocaleDateString("ru-RU") : "—";
      case "deadlineWeek":
        return row.deadlineWeek ?? "—";
      case "owner":
        return row.ownerName ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
              style={{ background: stringToColor(row.ownerName) }}
            >
              {row.ownerName.charAt(0).toUpperCase()}
            </span>
            {row.ownerName}
          </span>
        ) : (
          "—"
        );
      case "status":
        return row.statusName ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              background: `${row.statusColor ?? "#9CA3AF"}1a`,
              color: row.statusColor ?? "#6B7280",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: row.statusColor ?? "#9CA3AF" }} />
            {row.statusName}
          </span>
        ) : (
          "—"
        );
      case "operFlag":
        return row.operFlag ? "да" : "—";
      case "comment":
        return row.comment ?? "—";
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="surface mb-4 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-neutral-500">Тип</label>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="select">
            <option value="">Все</option>
            <option value="TRACK">Трек</option>
            <option value="TASK">Задача</option>
            <option value="VESSEL_OPTION">Судно</option>
          </select>
        </div>
        <Select label="Сегмент" value={segmentId} onChange={setSegmentId} options={segments} />
        <Select label="Статус" value={statusId} onChange={setStatusId} options={statuses} />
        <Select label="Потребность" value={attractivenessId} onChange={setAttractivenessId} options={attractiveness} />
        <Select label="Ответственный" value={ownerId} onChange={setOwnerId} options={users} />
        <div>
          <label className="mb-1 block text-[11px] font-medium text-neutral-500">Опер-флаг</label>
          <select value={operFlag} onChange={(e) => setOperFlag(e.target.value)} className="select">
            <option value="">Все</option>
            <option value="true">Да</option>
            <option value="false">Нет</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-neutral-500">Сортировка</label>
          <div className="flex gap-1">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="select">
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
              className="select w-9 transition-transform duration-150 active:scale-90"
              title="Направление сортировки"
            >
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </div>
        </div>
        <div className="ml-auto">
          <button onClick={() => setConfigOpen((v) => !v)} className="btn-ghost">
            ⚙ Колонки
          </button>
        </div>
      </div>

      {configOpen && <ColumnConfigPanel columns={columns} onChange={saveColumns} onReset={() => saveColumns(DEFAULT_COLUMNS)} />}

      <div className="surface overflow-x-auto">
        <table className="text-[13px]" style={{ width: visibleColumns.reduce((s, c) => s + c.width, 0), tableLayout: "fixed" }}>
          <colgroup>
            {visibleColumns.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              {visibleColumns.map((col) => (
                <ResizableTh key={col.key} column={col} onResize={(w) => saveColumns(columns.map((c) => (c.key === col.key ? { ...c, width: w } : c)))} />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-[var(--border)]">
                  {visibleColumns.map((c) => (
                    <td key={c.key} className="px-4 py-3">
                      <div className="skeleton h-3.5 w-full rounded" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows.map((row, i) => (
                <tr
                  key={`${row.type}-${row.id}`}
                  className="row-hover animate-fade-in border-b border-[var(--border)] last:border-0"
                  style={{ animationDelay: `${Math.min(i, 20) * 12}ms` }}
                >
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      className={`truncate px-4 py-2.5 text-neutral-700 ${
                        col.key === "deadline" && isOverdue(row) ? "font-medium text-[var(--danger)]" : ""
                      }`}
                      title={
                        (col.key === "comment" && row.comment) || (col.key === "name" && row.name) || undefined
                      }
                    >
                      {renderCell(row, col)}
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-4 py-14 text-center text-[13px] text-neutral-400">
                  Нет записей по выбранным фильтрам.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColumnConfigPanel({
  columns,
  onChange,
  onReset,
}: {
  columns: ColumnConfig[];
  onChange: (cols: ColumnConfig[]) => void;
  onReset: () => void;
}) {
  function update(key: ColumnKey, patch: Partial<ColumnConfig>) {
    onChange(columns.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function move(key: ColumnKey, dir: -1 | 1) {
    const idx = columns.findIndex((c) => c.key === key);
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= columns.length) return;
    const next = [...columns];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    onChange(next);
  }

  return (
    <div className="surface animate-fade-in mb-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12px] font-medium text-neutral-600">
          Настройте видимость, порядок, название и ширину колонок — сохраняется в этом браузере.
        </p>
        <button onClick={onReset} className="btn-ghost">
          Сбросить
        </button>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {columns.map((col, i) => (
          <li key={col.key} className="flex items-center gap-3 py-2">
            <input
              type="checkbox"
              checked={col.visible}
              onChange={(e) => update(col.key, { visible: e.target.checked })}
              className="h-4 w-4 accent-neutral-900"
            />
            <input
              value={col.label}
              onChange={(e) => update(col.key, { label: e.target.value })}
              className="input w-40 py-1"
            />
            <span className="text-[11px] text-neutral-400">{col.width}px</span>
            <div className="ml-auto flex gap-1">
              <button onClick={() => move(col.key, -1)} disabled={i === 0} className="btn-ghost px-2 py-1 disabled:opacity-30">
                ↑
              </button>
              <button
                onClick={() => move(col.key, 1)}
                disabled={i === columns.length - 1}
                className="btn-ghost px-2 py-1 disabled:opacity-30"
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResizableTh({ column, onResize }: { column: ColumnConfig; onResize: (width: number) => void }) {
  const startX = useRef(0);
  const startWidth = useRef(column.width);

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    startX.current = e.clientX;
    startWidth.current = column.width;

    function onMove(ev: MouseEvent) {
      const next = Math.max(60, startWidth.current + (ev.clientX - startX.current));
      onResize(next);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <th className="relative px-4 py-2.5">
      {column.label}
      <span
        onMouseDown={onMouseDown}
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none hover:bg-neutral-200"
      />
    </th>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Ref[];
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-neutral-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="select">
        <option value="">Все</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
