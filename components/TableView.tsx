"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExportMenu } from "@/components/ExportMenu";
import { ItemForm, type ItemRow, type Ref, type Refs, type TrackRef } from "@/components/ItemForm";

type Row = ItemRow & {
  departmentName: string;
  segmentName: string | null;
  trackName: string | null;
  attractivenessName: string | null;
  attractivenessColor: string | null;
  ownerName: string | null;
  deadlineWeek: number | null;
  statusName: string | null;
  statusColor: string | null;
  updatedAt: string;
  staleWeeks: number;
};

type Me = { id: string; role: string; departmentId: string | null } | null;

const ATTRACTIVENESS_LABEL: Record<string, string> = {
  P100: "Высокая",
  P70: "Выше среднего",
  P50: "Средняя",
  P10: "Низкая",
  P0: "Отсутствует",
};

/** По запросу заказчика данные в этих колонках центрируются. */
const CENTERED_COLUMNS: ColumnKey[] = ["cost", "attractiveness", "status", "deadline", "operFlag"];

function stringToColor(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = input.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}

type ColumnKey =
  | "department"
  | "segment"
  | "track"
  | "cost"
  | "attractiveness"
  | "name"
  | "deadline"
  | "deadlineWeek"
  | "owner"
  | "status"
  | "operFlag"
  | "comment";

/** width — не пиксели, а относительный вес: колонки растягиваются на 100% пропорционально. */
type ColumnConfig = { key: ColumnKey; label: string; visible: boolean; width: number };

const DEFAULT_LABEL: Record<ColumnKey, string> = {
  department: "Подразделение",
  segment: "Сегмент",
  track: "Трек",
  cost: "Оценка $",
  attractiveness: "Привлекательность",
  name: "Название",
  deadline: "Срок",
  deadlineWeek: "Неделя",
  owner: "Ответственный",
  status: "Статус",
  operFlag: "Опер",
  comment: "Комментарии",
};

const ALL_KEYS: ColumnKey[] = [
  "department",
  "segment",
  "track",
  "name",
  "cost",
  "attractiveness",
  "owner",
  "deadline",
  "status",
  "operFlag",
  "comment",
  "deadlineWeek",
];

const WIDTH: Record<ColumnKey, number> = {
  department: 130,
  segment: 140,
  track: 180,
  cost: 110,
  attractiveness: 130,
  name: 260,
  deadline: 110,
  deadlineWeek: 80,
  owner: 150,
  status: 130,
  operFlag: 70,
  comment: 240,
};

const DEFAULT_VISIBLE: ColumnKey[] = ["department", "segment", "track", "name", "cost", "attractiveness", "owner", "deadline", "status", "operFlag", "comment"];

function buildColumns(visibleKeys: ColumnKey[]): ColumnConfig[] {
  const ordered = [...visibleKeys, ...ALL_KEYS.filter((k) => !visibleKeys.includes(k))];
  return ordered.map((key) => ({ key, label: DEFAULT_LABEL[key], visible: visibleKeys.includes(key), width: WIDTH[key] }));
}

const DEFAULT_COLUMNS = buildColumns(DEFAULT_VISIBLE);
const STORAGE_KEY = "operativka.tableColumns.v1";

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
  { value: "department", label: "Подразделение" },
  { value: "segment", label: "Сегмент" },
  { value: "track", label: "Трек" },
  { value: "title", label: "Название" },
  { value: "attractiveness", label: "Привлекательность" },
  { value: "owner", label: "Ответственный" },
  { value: "status", label: "Статус" },
  { value: "deadline", label: "Срок" },
  { value: "updatedAt", label: "Дата обновления" },
];

export function TableView({ defaultArchive = "active" }: { defaultArchive?: "active" | "archived" }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refs, setRefs] = useState<Refs>({ departments: [], segments: [], tracks: [], statuses: [], attractiveness: [], users: [] });
  const [me, setMe] = useState<Me>(null);
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [configOpen, setConfigOpen] = useState(false);
  const [editor, setEditor] = useState<{ row: Row | null } | null>(null);

  const [departmentId, setDepartmentId] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [trackId, setTrackId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [attractivenessId, setAttractivenessId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [operFlag, setOperFlag] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [archive, setArchive] = useState<"active" | "archived" | "all">(defaultArchive);
  const [sortBy, setSortBy] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [deadlineFrom, setDeadlineFrom] = useState("");
  const [deadlineTo, setDeadlineTo] = useState("");
  const [refetchTick, setRefetchTick] = useState(0);

  const isHead = me?.role === "DEPARTMENT_HEAD";
  const canCreate = me?.role === "DEPARTMENT_HEAD" || me?.role === "CURATOR";
  const canEditRow = useCallback(
    (r: Row) => me?.role === "CURATOR" || (me?.role === "DEPARTMENT_HEAD" && !!me.departmentId && me.departmentId === r.departmentId),
    [me]
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setColumns(loadColumns());
  }, []);

  function saveColumns(next: ColumnConfig[]) {
    setColumns(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // per-viewer удобство, не критично
    }
  }

  useEffect(() => {
    const get = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));
    Promise.all([
      get("/api/auth/me"),
      get("/api/departments"),
      get("/api/segments"),
      get("/api/tracks"),
      get("/api/statuses"),
      get("/api/attractiveness"),
      get("/api/users"),
    ]).then(([m, d, s, t, st, a, u]) => {
      setMe(m?.user ?? null);
      setRefs({
        departments: d?.departments ?? [],
        segments: s?.segments ?? [],
        tracks: (t?.tracks ?? []).map((x: TrackRef) => ({ id: x.id, name: x.name, segmentId: x.segmentId })),
        statuses: st?.statuses ?? [],
        attractiveness: a?.attractiveness ?? [],
        users: (u?.users ?? []).map((x: Ref) => ({ id: x.id, name: x.name })),
      });
    });
  }, []);

  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    const add = (k: string, v: string) => v && p.set(k, v);
    add("departmentId", departmentId);
    add("segmentId", segmentId);
    add("trackId", trackId);
    add("statusId", statusId);
    add("attractivenessId", attractivenessId);
    add("ownerId", ownerId);
    add("operFlag", operFlag);
    add("q", debouncedQ);
    add("deadlineFrom", deadlineFrom);
    add("deadlineTo", deadlineTo);
    p.set("archive", archive);
    if (sortBy) {
      p.set("sortBy", sortBy);
      p.set("sortDir", sortDir);
    }
    return p;
  }, [departmentId, segmentId, trackId, statusId, attractivenessId, ownerId, operFlag, debouncedQ, deadlineFrom, deadlineTo, archive, sortBy, sortDir]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/items?${filterParams.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRows(d.rows ?? []))
      .catch(() => setError("Не удалось загрузить данные. Проверьте соединение и повторите."))
      .finally(() => setLoading(false));
  }, [filterParams, refetchTick]);

  async function toggleOper(row: Row, next: boolean) {
    const res = await fetch(`/api/items/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: row.version, operFlag: next }),
    });
    if (!res.ok) setError(res.status === 409 ? "Позиция была изменена другим пользователем — список обновлён." : "Не удалось изменить отметку «Опер».");
    setRefetchTick((t) => t + 1);
  }

  const isOverdue = useCallback((row: Row) => {
    if (!row.deadline || row.archived) return false;
    if (row.statusName === "Завершено" || row.statusName === "Не актуально") return false;
    return new Date(row.deadline) < new Date();
  }, []);

  const visibleColumns = columns.filter((c) => c.visible && !(c.key === "department" && isHead));
  const totalWeight = visibleColumns.reduce((s, c) => s + c.width, 0) || 1;

  function renderCell(row: Row, col: ColumnConfig) {
    switch (col.key) {
      case "department":
        return row.departmentName;
      case "segment":
        return row.segmentName ?? "—";
      case "track":
        return row.trackName ?? "—";
      case "cost":
        return row.cost ?? "—";
      case "attractiveness": {
        const code = row.attractivenessName ?? "P0";
        const color = row.attractivenessColor ?? "#9CA3AF";
        return (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ background: `${color}1a`, color }}
            title={ATTRACTIVENESS_LABEL[code] ?? code}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            {code}
          </span>
        );
      }
      case "name":
        return <span className={row.archived ? "text-neutral-400" : ""}>{row.name}</span>;
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
            style={{ background: `${row.statusColor ?? "#9CA3AF"}1a`, color: row.statusColor ?? "#6B7280" }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: row.statusColor ?? "#9CA3AF" }} />
            {row.statusName}
          </span>
        ) : (
          "—"
        );
      case "operFlag":
        return canEditRow(row) && !row.archived ? (
          <input
            type="checkbox"
            checked={row.operFlag}
            onChange={(e) => toggleOper(row, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 cursor-pointer accent-neutral-900"
            title="Отправить куратору"
          />
        ) : row.operFlag ? (
          "да"
        ) : (
          "—"
        );
      case "comment":
        return row.comment ?? "—";
    }
  }

  return (
    <div className="w-full px-6 py-6">
      <div className="surface mb-4 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-neutral-500">Поиск</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, комментарий…" className="input w-48" />
        </div>
        {!isHead && <Select label="Подразделение" value={departmentId} onChange={setDepartmentId} options={refs.departments} />}
        <Select label="Сегмент" value={segmentId} onChange={setSegmentId} options={refs.segments} />
        <Select label="Трек" value={trackId} onChange={setTrackId} options={refs.tracks} />
        <Select label="Статус" value={statusId} onChange={setStatusId} options={refs.statuses} />
        <Select label="Привлекательность" value={attractivenessId} onChange={setAttractivenessId} options={refs.attractiveness} />
        <Select label="Ответственный" value={ownerId} onChange={setOwnerId} options={refs.users} />
        <div>
          <label className="mb-1 block text-[11px] font-medium text-neutral-500">Опер</label>
          <select value={operFlag} onChange={(e) => setOperFlag(e.target.value)} className="select">
            <option value="">Все</option>
            <option value="true">Да</option>
            <option value="false">Нет</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-neutral-500">Показывать</label>
          <select value={archive} onChange={(e) => setArchive(e.target.value as typeof archive)} className="select">
            <option value="active">Активные</option>
            <option value="archived">Архив</option>
            <option value="all">Все</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-neutral-500">Срок: с</label>
          <div className="flex items-center gap-1">
            <input type="date" value={deadlineFrom} onChange={(e) => setDeadlineFrom(e.target.value)} className="input" />
            <span className="text-neutral-400">по</span>
            <input type="date" value={deadlineTo} onChange={(e) => setDeadlineTo(e.target.value)} className="input" />
            {(deadlineFrom || deadlineTo) && (
              <button onClick={() => { setDeadlineFrom(""); setDeadlineTo(""); }} className="btn-ghost px-2 py-1.5" title="Сбросить диапазон">✕</button>
            )}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-neutral-500">Сортировка</label>
          <div className="flex gap-1">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="select">
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")} className="select w-9 transition-transform duration-150 active:scale-90" title="Направление сортировки">
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </div>
        </div>
        <div className="ml-auto flex items-end gap-3">
          {me && me.role !== "SYSTEM_ADMIN" && <ExportMenu endpoint="/api/export/table" params={filterParams} />}
          <button onClick={() => setConfigOpen((v) => !v)} className="btn-ghost">⚙ Колонки</button>
          {canCreate && (
            <button onClick={() => setEditor({ row: null })} className="btn-primary">+ Новая позиция</button>
          )}
        </div>
      </div>

      {configOpen && <ColumnConfigPanel columns={columns} onChange={saveColumns} onReset={() => saveColumns(DEFAULT_COLUMNS)} />}

      {error && (
        <div className="mb-3 flex items-center gap-3 rounded-md bg-red-50 px-3 py-2 text-[13px] text-[var(--danger)]">
          {error}
          <button onClick={() => setRefetchTick((t) => t + 1)} className="btn-ghost">Повторить</button>
        </div>
      )}

      <div className="surface overflow-hidden">
        <table className="w-full text-[13px]" style={{ tableLayout: "fixed" }}>
          <colgroup>
            {visibleColumns.map((c) => (
              <col key={c.key} style={{ width: `${(c.width / totalWeight) * 100}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              {visibleColumns.map((col) => (
                <ResizableTh
                  key={col.key}
                  column={col}
                  totalWeight={totalWeight}
                  onResize={(w) => saveColumns(columns.map((c) => (c.key === col.key ? { ...c, width: w } : c)))}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-[var(--border)]">
                  {visibleColumns.map((c) => (
                    <td key={c.key} className="px-4 py-3"><div className="skeleton h-3.5 w-full rounded" /></td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows.map((row, i) => (
                <tr
                  key={row.id}
                  onClick={() => setEditor({ row })}
                  className="row-hover animate-fade-in cursor-pointer border-b border-[var(--border)] last:border-0"
                  style={{ animationDelay: `${Math.min(i, 20) * 12}ms` }}
                >
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      className={`truncate px-4 py-2.5 text-neutral-700 ${CENTERED_COLUMNS.includes(col.key) ? "text-center" : ""} ${
                        col.key === "deadline" && isOverdue(row) ? "font-medium text-[var(--danger)]" : ""
                      }`}
                      title={(col.key === "comment" && row.comment) || (col.key === "name" && row.name) || undefined}
                    >
                      {renderCell(row, col)}
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-4 py-14 text-center text-[13px] text-neutral-400">
                  Нет позиций по выбранным фильтрам.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!loading && rows.length > 0 && <p className="mt-2 text-[11px] text-neutral-400">Позиций: {rows.length}</p>}

      {editor && (
        <ItemForm
          row={editor.row}
          refs={refs}
          defaultDepartmentId={isHead ? me?.departmentId ?? "" : refs.departments[0]?.id ?? ""}
          lockDepartment={isHead}
          canEdit={editor.row ? canEditRow(editor.row) : canCreate}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setRefetchTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

function ColumnConfigPanel({ columns, onChange, onReset }: { columns: ColumnConfig[]; onChange: (cols: ColumnConfig[]) => void; onReset: () => void }) {
  const visibleTotal = columns.filter((c) => c.visible).reduce((s, c) => s + c.width, 0) || 1;

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
        <p className="text-[12px] font-medium text-neutral-600">Настройте видимость, порядок, название и ширину колонок — сохраняется в этом браузере.</p>
        <button onClick={onReset} className="btn-ghost">Сбросить</button>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {columns.map((col, i) => (
          <li key={col.key} className="flex items-center gap-3 py-2">
            <input type="checkbox" checked={col.visible} onChange={(e) => update(col.key, { visible: e.target.checked })} className="h-4 w-4 accent-neutral-900" />
            <input value={col.label} onChange={(e) => update(col.key, { label: e.target.value })} className="input w-40 py-1" />
            <span className="w-10 text-right text-[11px] text-neutral-400">{col.visible ? Math.round((col.width / visibleTotal) * 100) : 0}%</span>
            <div className="ml-auto flex gap-1">
              <button onClick={() => move(col.key, -1)} disabled={i === 0} className="btn-ghost px-2 py-1 disabled:opacity-30">↑</button>
              <button onClick={() => move(col.key, 1)} disabled={i === columns.length - 1} className="btn-ghost px-2 py-1 disabled:opacity-30">↓</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResizableTh({ column, totalWeight, onResize }: { column: ColumnConfig; totalWeight: number; onResize: (width: number) => void }) {
  const thRef = useRef<HTMLTableCellElement>(null);
  const startX = useRef(0);
  const startPixelWidth = useRef(0);
  const startWeight = useRef(column.width);

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    startPixelWidth.current = thRef.current?.getBoundingClientRect().width ?? 100;
    startWeight.current = column.width;

    function onMove(ev: MouseEvent) {
      const nextPixelWidth = Math.max(60, startPixelWidth.current + (ev.clientX - startX.current));
      onResize(Math.round(Math.max(20, startWeight.current * (nextPixelWidth / startPixelWidth.current))));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <th ref={thRef} className={`relative px-4 py-2.5 ${CENTERED_COLUMNS.includes(column.key) ? "text-center" : ""}`} style={{ width: `${(column.width / totalWeight) * 100}%` }}>
      {column.label}
      <span onMouseDown={onMouseDown} className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none hover:bg-neutral-200" />
    </th>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Ref[] }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-neutral-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="select">
        <option value="">Все</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}
