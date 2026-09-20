"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowDown, ArrowUp, ArrowDownWideNarrow, BarChart3, ClipboardList, Pencil, Plus, RotateCcw, Settings, Trash2, Undo2 } from "lucide-react";
import { AnalyticsPanel } from "@/components/AnalyticsPanel";
import { ExportMenu } from "@/components/ExportMenu";
import { FilterChip, FilterField, MoreFilters } from "@/components/FilterChips";
import type { UserRole } from "@prisma/client";
import { canCreateItem, canDeleteItem } from "@/lib/permissions";
import { ItemPanel, type ItemRow, type Ref, type Refs, type TrackRef } from "@/components/ItemPanel";
import { SegmentList, SegmentSelect, segmentColors, type SegmentRef } from "@/components/SegmentList";
import { Avatar } from "@/components/ui/Avatar";
import { ATTRACTIVENESS_LABEL, AttractivenessBadge, StatusPill } from "@/components/ui/Badge";
import { RecentChanges } from "@/components/RecentChanges";
import { Popover } from "@/components/ui/Popover";
import { countBySegment, filterBySegments, groupBySegment, NO_SEGMENT, toggleSegment } from "@/lib/segment-counts";

type Row = ItemRow & {
  createdById: string;
  changedAfterSubmission: boolean;
  customValues: Record<string, string>;
  segmentName: string | null;
  trackName: string | null;
  attractivenessName: string | null;
  attractivenessColor: string | null;
  ownerName: string | null;
  ownerRole: string | null;
  deadlineWeek: number | null;
  statusName: string | null;
  statusColor: string | null;
  updatedAt: string;
  staleWeeks: number;
};

type Me = { id: string; role: string } | null;

/** По запросу заказчика данные в этих колонках центрируются. */
const CENTERED_COLUMNS: ColumnKey[] = ["cost", "attractiveness", "status", "deadline", "operFlag"];

type StdKey = "track" | "cost" | "attractiveness" | "name" | "deadline" | "deadlineWeek" | "owner" | "status" | "operFlag" | "comment";
/** Свои колонки куратора имеют ключ custom:<id колонки>. */
type ColumnKey = StdKey | `custom:${string}`;

/** width — не пиксели, а относительный вес: колонки растягиваются на 100% пропорционально. */
type ColumnConfig = { key: ColumnKey; label: string; visible: boolean; width: number };

const DEFAULT_LABEL: Record<StdKey, string> = {
  track: "Трек",
  cost: "Оценка $",
  attractiveness: "Привлекательность",
  name: "Задача",
  deadline: "Дедлайн",
  deadlineWeek: "Неделя",
  owner: "Ответственный",
  status: "Статус",
  operFlag: "Опер",
  comment: "Комментарии",
};

const ALL_KEYS: StdKey[] = ["track", "name", "cost", "attractiveness", "owner", "deadline", "status", "operFlag", "comment", "deadlineWeek"];

const WIDTH: Record<StdKey, number> = {
  track: 170,
  cost: 110,
  attractiveness: 130,
  name: 280,
  deadline: 110,
  deadlineWeek: 80,
  owner: 160,
  status: 130,
  operFlag: 70,
  comment: 240,
};

const DEFAULT_VISIBLE: StdKey[] = ["track", "name", "cost", "attractiveness", "owner", "deadline", "status", "operFlag", "comment"];

function buildColumns(visibleKeys: StdKey[]): ColumnConfig[] {
  const ordered = [...visibleKeys, ...ALL_KEYS.filter((k) => !visibleKeys.includes(k))];
  return ordered.map((key) => ({ key, label: DEFAULT_LABEL[key], visible: visibleKeys.includes(key), width: WIDTH[key] }));
}

const DEFAULT_COLUMNS = buildColumns(DEFAULT_VISIBLE);
// v2: сброшен набор колонок первой версии.
const STORAGE_KEY = "operativka.tableColumns.v2";

/** Приводит сохранённые настройки к актуальному набору колонок (переименования, новые колонки). */
function normalizeColumns(saved: ColumnConfig[]): ColumnConfig[] {
  const parsed = saved.filter((c) => ALL_KEYS.includes(c.key as StdKey) || c.key.startsWith("custom:"));
  // Старые стандартные подписи (до переименования) заменяем новыми; свои названия не трогаем.
  const RENAMED: Record<string, string> = { "Название": "Задача", "Срок": "Дедлайн" };
  for (const c of parsed) if (RENAMED[c.label]) c.label = RENAMED[c.label];
  const known = new Set<string>(parsed.map((c) => c.key));
  return [...parsed, ...DEFAULT_COLUMNS.filter((c) => !known.has(c.key))];
}

/** Настройки, оставшиеся в этом браузере от прежней версии (переносятся в учётную запись один раз). */
function loadLocalColumns(): ColumnConfig[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ColumnConfig[]) : null;
  } catch {
    return null;
  }
}

type CustomCol = { id: string; name: string; type: "TEXT" | "NUMBER" | "DATE" | "SELECT"; options: string[] };

/** Добавляет свои колонки к настройкам таблицы и убирает удалённые; подписи берутся из справочника. */
function withCustomColumns(cols: ColumnConfig[], custom: CustomCol[]): ColumnConfig[] {
  const byKey = new Map(custom.map((c) => [`custom:${c.id}`, c]));
  const kept = cols
    .filter((c) => !c.key.startsWith("custom:") || byKey.has(c.key))
    .map((c) => (byKey.has(c.key) ? { ...c, label: byKey.get(c.key)!.name } : c));
  const known = new Set<string>(kept.map((c) => c.key));
  const added = custom
    .filter((c) => !known.has(`custom:${c.id}`))
    .map((c): ColumnConfig => ({ key: `custom:${c.id}`, label: c.name, visible: true, width: 140 }));
  return [...kept, ...added];
}

const ARCHIVE_LABEL = { active: "Активные", archived: "Архив", all: "Все" } as const;

export function TableView({ defaultArchive = "active" }: { defaultArchive?: "active" | "archived" }) {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refs, setRefs] = useState<Refs>({ segments: [], tracks: [], statuses: [], attractiveness: [], users: [] });
  const [segmentRefs, setSegmentRefs] = useState<SegmentRef[]>([]);
  const [me, setMe] = useState<Me>(null);
  const [savedColumns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [customCols, setCustomCols] = useState<CustomCol[]>([]);
  const columns = useMemo(() => withCustomColumns(savedColumns, customCols), [savedColumns, customCols]);
  const [editor, setEditorState] = useState<{ row: Row | null } | null>(null);
  const [analytics, setAnalytics] = useState(false);
  // Экспорт живёт в шапке рядом с колокольчиком: рендерим его туда через портал.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [settingsSlot, setSettingsSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHeaderSlot(document.getElementById("header-actions"));
    setSettingsSlot(document.getElementById("header-settings"));
  }, []);
  // Выбранные сегменты (можно несколько); пусто = все.
  const [segments, setSegments] = useState<string[]>([]);

  // Справа открыта одна панель за раз: карточка позиции или аналитика.
  const setEditor = (v: { row: Row | null } | null) => {
    setEditorState(v);
    if (v) setAnalytics(false);
  };
  const toggleAnalytics = () => {
    setAnalytics((a) => !a);
    setEditorState(null);
  };

  // Каждый фильтр — список выбранных значений (можно несколько, чтобы сравнивать).
  const [trackIds, setTrackIds] = useState<string[]>([]);
  const [statusIds, setStatusIds] = useState<string[]>([]);
  const [attractivenessIds, setAttractivenessIds] = useState<string[]>([]);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [operFlags, setOperFlags] = useState<string[]>([]);
  const [archive, setArchive] = useState<"active" | "archived" | "all">(defaultArchive);
  const [sortBy, setSortBy] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [deadlineFrom, setDeadlineFrom] = useState("");
  const [deadlineTo, setDeadlineTo] = useState("");
  const [refetchTick, setRefetchTick] = useState(0);

  // Руководитель видит все позиции, правит только те, где он «Ответственный»; куратор правит всё.
  const isHead = me?.role === "HEAD";
  const canEditRow = useCallback(
    (r: Row) => me?.role === "CURATOR" || (me?.role === "HEAD" && r.ownerId === me.id),
    [me]
  );

  // Контекстное меню строки (правая кнопка мыши).
  const [ctx, setCtx] = useState<{ x: number; y: number; row: Row; confirm: boolean } | null>(null);
  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctx]);

  async function ctxAction(row: Row, action: "delete" | "restore") {
    setCtx(null);
    const res = await fetch(action === "restore" ? `/api/items/${row.id}/restore` : `/api/items/${row.id}`, {
      method: action === "restore" ? "POST" : "DELETE",
    });
    if (res.ok) setRefetchTick((t) => t + 1);
    else setError(action === "restore" ? "Не удалось вернуть позицию." : "Не удалось удалить позицию: удалять может только тот, кто её заполняет.");
  }

  async function returnRow(row: Row) {
    setCtx(null);
    const comment = window.prompt(`Что нужно исправить в «${row.name}»? Комментарий увидит ответственный.`);
    if (!comment?.trim()) return;
    const res = await fetch(`/api/items/${row.id}/return`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    if (res.ok) setRefetchTick((t) => t + 1);
    else setError("Не удалось вернуть позицию.");
  }

  const canDeleteRow = useCallback(
    (r: Row) => !!me && canDeleteItem({ id: me.id, role: me.role as UserRole }, { responsibleId: r.ownerId, createdById: r.createdById }),
    [me]
  );

  // Настройки колонок хранятся в базе, у каждого пользователя свои: одинаково на любом устройстве.
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistColumns = useCallback((next: ColumnConfig[]) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    // перетаскивание границы шлёт много изменений подряд — сохраняем один раз, когда закончили
    persistTimer.current = setTimeout(() => {
      fetch("/api/me/table-columns", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ columns: next }) }).catch(() => {});
    }, 600);
  }, []);

  useEffect(() => {
    fetch("/api/me/table-columns")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.columns) return setColumns(normalizeColumns(d.columns));
        // в базе пока пусто: переносим то, что было настроено в этом браузере
        const local = loadLocalColumns();
        if (local) {
          const normalized = normalizeColumns(local);
          setColumns(normalized);
          persistColumns(normalized);
        }
      })
      .catch(() => {});
  }, [persistColumns]);

  function saveColumns(next: ColumnConfig[]) {
    setColumns(next);
    persistColumns(next);
  }

  useEffect(() => {
    const get = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));
    get("/api/columns").then((d) => setCustomCols(d?.columns ?? []));
    Promise.all([
      get("/api/auth/me"),
      get("/api/segments"),
      get("/api/tracks"),
      get("/api/statuses"),
      get("/api/attractiveness"),
      get("/api/users"),
    ]).then(([m, s, t, st, a, u]) => {
      setMe(m?.user ?? null);
      setSegmentRefs((s?.segments ?? []).map((x: SegmentRef) => ({ id: x.id, name: x.name, color: x.color ?? null })));
      setRefs({
        segments: s?.segments ?? [],
        tracks: (t?.tracks ?? []).map((x: TrackRef) => ({ id: x.id, name: x.name, segmentId: x.segmentId })),
        statuses: st?.statuses ?? [],
        attractiveness: a?.attractiveness ?? [],
        users: (u?.users ?? []).map((x: Ref) => ({ id: x.id, name: x.name })),
      });
    });
  }, []);

  // Параметры без сегмента: сегмент фильтруется на клиенте, чтобы счётчики слева были полными.
  const baseParams = useMemo(() => {
    const p = new URLSearchParams();
    const add = (k: string, v: string) => v && p.set(k, v);
    add("trackIds", trackIds.join(","));
    add("statusIds", statusIds.join(","));
    add("attractivenessIds", attractivenessIds.join(","));
    add("ownerIds", ownerIds.join(","));
    // «Отправлено» и «Не отправлено» вместе = без ограничения
    if (operFlags.length === 1) add("operFlag", operFlags[0]);
    add("q", q);
    add("deadlineFrom", deadlineFrom);
    add("deadlineTo", deadlineTo);
    p.set("archive", archive);
    if (sortBy) {
      p.set("sortBy", sortBy);
      p.set("sortDir", sortDir);
    }
    return p;
  }, [trackIds, statusIds, attractivenessIds, ownerIds, operFlags, q, deadlineFrom, deadlineTo, archive, sortBy, sortDir]);

  const exportParams = useMemo(() => {
    const p = new URLSearchParams(baseParams);
    if (segments.length > 0) p.set("segmentIds", segments.join(","));
    return p;
  }, [baseParams, segments]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/items?${baseParams.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRows(d.rows ?? []))
      .catch(() => setError("Не удалось загрузить данные. Проверьте соединение и повторите."))
      .finally(() => setLoading(false));
  }, [baseParams, refetchTick]);

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

  async function openById(id: string) {
    const known = rows.find((r) => r.id === id);
    if (known) return setEditor({ row: known });
    const res = await fetch(`/api/items/${id}`);
    if (res.ok) setEditor({ row: (await res.json()).row as Row });
  }

  const counts = useMemo(() => countBySegment(rows), [rows]);
  const visibleRows = useMemo(() => filterBySegments(rows, segments), [rows, segments]);
  const colors = useMemo(() => segmentColors(segmentRefs), [segmentRefs]);
  const segmentName = (id: string) => (id === NO_SEGMENT ? "Без сегмента" : segmentRefs.find((s) => s.id === id)?.name ?? "Сегмент");
  const selectedName = segments.length === 0 ? "Все сегменты" : segments.length <= 2 ? segments.map(segmentName).join(" · ") : `Сегментов выбрано: ${segments.length}`;
  // При нескольких сегментах (или «все») строки группируются по сегментам — так их удобно сравнивать.
  const groups = useMemo(
    () => (segments.length === 1 ? null : groupBySegment(visibleRows, segmentRefs.map((s) => s.id))),
    [visibleRows, segments, segmentRefs]
  );
  const operCount = visibleRows.filter((r) => r.operFlag).length;
  const lastUpdated = visibleRows.reduce<string | null>((m, r) => (!m || r.updatedAt > m ? r.updatedAt : m), null);

  const moreActive = [deadlineFrom || deadlineTo, archive !== defaultArchive].filter(Boolean).length;
  const anyFilter = !!(trackIds.length || statusIds.length || attractivenessIds.length || ownerIds.length || operFlags.length || q || moreActive);
  function resetFilters() {
    setTrackIds([]); setStatusIds([]); setAttractivenessIds([]); setOwnerIds([]); setOperFlags([]);
    setDeadlineFrom(""); setDeadlineTo(""); setArchive(defaultArchive);
  }

  const visibleColumns = columns.filter((c) => c.visible);
  const totalWeight = visibleColumns.reduce((s, c) => s + c.width, 0) || 1;

  function renderCell(row: Row, col: ColumnConfig) {
    switch (col.key) {
      case "track":
        return row.trackName ?? "—";
      case "cost":
        return row.cost ?? "—";
      case "attractiveness":
        return <AttractivenessBadge name={row.attractivenessName} color={row.attractivenessColor} />;
      case "name":
        return <span className={`text-[13px] font-semibold [overflow-wrap:anywhere] ${row.archived ? "text-outline" : "text-on-surface"}`}>{row.name}</span>;
      case "deadline":
        return row.deadline ? (
          <span className={`inline-flex items-center gap-1 ${isOverdue(row) ? "font-semibold text-status-red" : ""}`}>
            {isOverdue(row) && <AlertCircle size={13} />}
            {new Date(row.deadline).toLocaleDateString("ru-RU")}
          </span>
        ) : (
          "—"
        );
      case "deadlineWeek":
        return row.deadlineWeek ?? "—";
      case "owner":
        return row.ownerName ? (
          <span className="inline-flex items-center gap-2">
            <Avatar name={row.ownerName} size={20} />
            <span className="truncate">{row.ownerName}</span>
            {row.ownerRole === "CURATOR" && <CuratorMark />}
          </span>
        ) : (
          "—"
        );
      case "status":
        return <StatusPill name={row.statusName} color={row.statusColor} />;
      case "operFlag": {
        const mark = row.operFlag && row.changedAfterSubmission && (
          <span title="Изменено после отправки куратору — откройте историю позиции" className="ml-1.5 inline-flex h-4 items-center rounded-sm bg-status-amber/15 px-1 text-[10px] font-bold text-status-amber">
            изм.
          </span>
        );
        return canEditRow(row) && !row.archived ? (
          <span className="inline-flex items-center">
          <input
            type="checkbox"
            checked={row.operFlag}
            onChange={(e) => toggleOper(row, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 cursor-pointer accent-primary"
            title="Отправить куратору"
          />
          {mark}
          </span>
        ) : row.operFlag ? (
          <span className="inline-flex items-center">да{mark}</span>
        ) : (
          "—"
        );
      }
      case "comment":
        return <span className="line-clamp-3 whitespace-pre-line text-[12px] leading-tight text-on-surface-variant [overflow-wrap:anywhere]">{row.comment ?? "—"}</span>;
      default: {
        // своя колонка куратора
        const id = col.key.slice("custom:".length);
        const v = row.customValues?.[id];
        if (!v) return "—";
        return customCols.find((c) => c.id === id)?.type === "DATE" ? new Date(v).toLocaleDateString("ru-RU") : v;
      }
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {settingsSlot &&
        createPortal(
          <Popover
            align="right"
            width={440}
            trigger={({ toggle }) => (
              <button onClick={toggle} className="btn-icon" title="Настройки таблицы" aria-label="Настройки таблицы">
                <Settings size={18} />
              </button>
            )}
          >
            {() => (
              <div>
                <ColumnConfigPanel columns={columns} onChange={saveColumns} onReset={() => saveColumns(DEFAULT_COLUMNS)} />
                {(me?.role === "SYSTEM_ADMIN" || me?.role === "CURATOR") && (
                  <a href="/settings#columns" className="block border-t border-outline-variant px-3.5 py-2.5 text-[13px] font-semibold text-primary hover:bg-primary-soft">
                    + Создать или удалить свою колонку →
                  </a>
                )}
                {(me?.role === "SYSTEM_ADMIN" || me?.role === "CURATOR") && (
                  <a href="/settings" className="block border-t border-outline-variant px-3.5 py-2.5 text-[13px] font-semibold text-primary hover:bg-primary-soft">
                    {me?.role === "CURATOR" ? "Ответственные и колонки таблицы →" : "Настройки системы (пользователи, справочники) →"}
                  </a>
                )}
              </div>
            )}
          </Popover>,
          settingsSlot
        )}
      {headerSlot && me && me.role !== "SYSTEM_ADMIN" && createPortal(<ExportMenu endpoint="/api/export/table" params={exportParams} iconOnly />, headerSlot)}
      <SegmentList segments={segmentRefs} counts={counts} selected={segments} onToggle={(id) => setSegments((s) => toggleSegment(s, id))} onClear={() => setSegments([])} />

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-outline-variant bg-surface px-6 py-4">
          <div className="mb-3">
            <SegmentSelect segments={segmentRefs} counts={counts} selected={segments} onToggle={(id) => setSegments((s) => toggleSegment(s, id))} onClear={() => setSegments([])} />
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="label-caps">{defaultArchive === "archived" ? "Архив позиций" : "Рабочая таблица"}</p>
              <h2 className="truncate text-2xl font-semibold leading-8 text-on-surface">{selectedName}</h2>
              <p className="mt-0.5 text-[12px] text-on-surface-variant">
                {loading ? "Загрузка…" : `${visibleRows.length} позиций · ${operCount} отправлено куратору`}
                {lastUpdated && !loading && ` · обновлено ${new Date(lastUpdated).toLocaleDateString("ru-RU")}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={toggleAnalytics} className={`btn-ghost ${analytics ? "border-primary bg-primary-soft text-primary" : ""}`} title="Аналитика выборки">
                <BarChart3 size={15} />
                Аналитика
              </button>
              {me && canCreateItem(me.role as UserRole) && defaultArchive !== "archived" && (
                <button onClick={() => setEditor({ row: null })} className="btn-primary">
                  <Plus size={16} />
                  Добавить
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SortMenu sortBy={sortBy} sortDir={sortDir} onChange={(f, d) => { setSortBy(f); setSortDir(d); }} />
            <FilterChip label="Трек" value={trackIds} options={refs.tracks} onChange={setTrackIds} />
            <FilterChip label="Статус" value={statusIds} options={refs.statuses} onChange={setStatusIds} />
            <FilterChip label="Привлекательность" value={attractivenessIds} options={refs.attractiveness.map((a) => ({ ...a, hint: ATTRACTIVENESS_LABEL[a.name] }))} onChange={setAttractivenessIds} />
            <FilterChip label="Ответственный" value={ownerIds} options={refs.users} onChange={setOwnerIds} />
            <FilterChip
              label="Опер"
              value={operFlags}
              options={[{ id: "true", name: "Отправлено" }, { id: "false", name: "Не отправлено" }]}
              onChange={setOperFlags}
            />
            <MoreFilters activeCount={moreActive}>
              <FilterField label="Дедлайн">
                <div className="flex items-center gap-1.5">
                  <input type="date" value={deadlineFrom} onChange={(e) => setDeadlineFrom(e.target.value)} className="input w-full" />
                  <span className="text-outline">—</span>
                  <input type="date" value={deadlineTo} onChange={(e) => setDeadlineTo(e.target.value)} className="input w-full" />
                </div>
              </FilterField>
              <FilterField label="Показывать">
                <select value={archive} onChange={(e) => setArchive(e.target.value as typeof archive)} className="select w-full">
                  {(Object.keys(ARCHIVE_LABEL) as Array<keyof typeof ARCHIVE_LABEL>).map((k) => (
                    <option key={k} value={k}>{ARCHIVE_LABEL[k]}</option>
                  ))}
                </select>
              </FilterField>
            </MoreFilters>
            {anyFilter && (
              <button onClick={resetFilters} className="flex h-9 items-center gap-1.5 px-2 text-[12px] font-semibold text-primary hover:underline">
                <RotateCcw size={13} />
                Сбросить
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-6">
          {error && (
            <div className="mb-3 flex items-center gap-3 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-[13px] text-status-red">
              <AlertCircle size={15} />
              <span className="flex-1">{error}</span>
              <button onClick={() => setRefetchTick((t) => t + 1)} className="btn-ghost h-8">Повторить</button>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-sm">
            <table className="w-full table-fixed border-collapse text-[13px]">
              <colgroup>
                {visibleColumns.map((c) => (
                  <col key={c.key} style={{ width: `${(c.width / totalWeight) * 100}%` }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-surface-high">
                <tr>
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
                    <tr key={i} className="border-t border-outline-variant/50">
                      {visibleColumns.map((c) => (
                        <td key={c.key} className="px-4 py-4"><div className="skeleton h-3.5 w-full rounded" /></td>
                      ))}
                    </tr>
                  ))}
                {!loading &&
                  (groups ?? [{ id: "", rows: visibleRows }]).map((group) => (
                    <Fragment key={group.id || "flat"}>
                      {groups && (
                        <tr className="bg-surface-low">
                          <td colSpan={visibleColumns.length} className="border-y border-outline-variant border-l-4 px-4 py-2" style={{ borderLeftColor: colors.get(group.id) ?? "#94a3b8" }}>
                            <span className="text-[12px] font-bold text-on-surface">{segmentName(group.id)}</span>
                            <span className="ml-2 text-[11px] text-on-surface-variant">{group.rows.length} поз.</span>
                          </td>
                        </tr>
                      )}
                      {group.rows.map((row) => (
                        <tr
                          key={row.id}
                          onClick={() => setEditor({ row })}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setCtx({ x: e.clientX, y: e.clientY, row, confirm: false });
                          }}
                          className={`row-hover cursor-pointer border-t border-outline-variant/50 ${editor?.row?.id === row.id ? "bg-primary-soft" : ""}`}
                        >
                          {visibleColumns.map((col) => (
                            <td
                              key={col.key}
                              className={`px-4 py-3.5 align-middle text-on-surface ${CENTERED_COLUMNS.includes(col.key) ? "text-center" : ""} ${
                                col.key === "name" || col.key === "comment" ? "" : "truncate"
                              }`}
                              title={col.key === "name" ? row.name : col.key === "comment" ? row.comment ?? undefined : undefined}
                            >
                              {renderCell(row, col)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
              </tbody>
            </table>

            {!loading && !error && visibleRows.length === 0 && (
              <EmptyState filtered={anyFilter || segments.length > 0} onReset={() => { resetFilters(); setSegments([]); }} archive={defaultArchive === "archived"} canCreate={!!me && canCreateItem(me.role as UserRole)} onCreate={() => setEditor({ row: null })} />
            )}
          </div>

          <RecentChanges segments={segments} refreshKey={refetchTick} onOpen={openById} />
        </div>
      </section>

      {ctx && (
        <div
          className="fixed z-50 w-60 overflow-hidden rounded-md border border-outline-variant bg-surface py-1 shadow-lg"
          style={{ left: Math.min(ctx.x, window.innerWidth - 250), top: Math.min(ctx.y, window.innerHeight - 140) }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {ctx.confirm ? (
            <div className="px-3.5 py-2">
              <p className="mb-2 text-[12px] text-on-surface-variant">Удалить позицию «{ctx.row.name.length > 40 ? `${ctx.row.name.slice(0, 40)}…` : ctx.row.name}»?</p>
              <div className="flex gap-2">
                <button onClick={() => ctxAction(ctx.row, "delete")} className="btn-primary h-8 flex-1 bg-status-red hover:bg-status-red">Удалить</button>
                <button onClick={() => setCtx(null)} className="btn-ghost h-8">Нет</button>
              </div>
            </div>
          ) : (
            <>
              <button onClick={() => { setEditor({ row: ctx.row }); setCtx(null); }} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-on-surface hover:bg-primary-soft">
                <Pencil size={14} className="text-outline" /> Открыть
              </button>
              {me?.role === "CURATOR" && ctx.row.operFlag && !ctx.row.archived && (
                <button onClick={() => returnRow(ctx.row)} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-on-surface hover:bg-primary-soft">
                  <Undo2 size={14} className="text-outline" /> Вернуть на доработку
                </button>
              )}
              {ctx.row.archived && canEditRow(ctx.row) && (
                <button onClick={() => ctxAction(ctx.row, "restore")} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-on-surface hover:bg-primary-soft">
                  <RotateCcw size={14} className="text-outline" /> Вернуть в работу
                </button>
              )}
              {!ctx.row.archived && canDeleteRow(ctx.row) && (
                <button onClick={() => setCtx({ ...ctx, confirm: true })} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-status-red hover:bg-status-red/10">
                  <Trash2 size={14} /> Удалить
                </button>
              )}
              {!ctx.row.archived && !canDeleteRow(ctx.row) && (
                <p className="px-3.5 py-2 text-[11px] text-outline">Удалять может только тот, кто заполняет позицию.</p>
              )}
            </>
          )}
        </div>
      )}

      {analytics && <AnalyticsPanel rows={visibleRows} title={selectedName} onClose={() => setAnalytics(false)} />}

      {editor && (
        <ItemPanel
          key={editor.row?.id ?? "new"}
          row={editor.row}
          refs={refs}
          defaultResponsibleId={me?.id ?? ""}
          lockResponsible={isHead}
          canEdit={editor.row ? canEditRow(editor.row) : true}
          canDelete={editor.row ? canDeleteRow(editor.row) : false}
          customColumns={customCols}
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

/** Метка «К» рядом с куратором (капитанская нашивка). */
function CuratorMark() {
  return (
    <span title="Куратор" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-primary text-[10px] font-bold leading-none text-white">
      К
    </span>
  );
}

function EmptyState({ filtered, onReset, archive, canCreate, onCreate }: { filtered: boolean; onReset: () => void; archive: boolean; canCreate: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-high text-outline">
        <ClipboardList size={22} />
      </span>
      <p className="text-[14px] font-semibold text-on-surface">{filtered ? "Ничего не найдено" : archive ? "В архиве пока пусто" : "Пока нет позиций"}</p>
      <p className="mt-1 max-w-sm text-[13px] text-on-surface-variant">
        {filtered ? "Измените условия поиска или сбросьте фильтры." : archive ? "Сюда попадают закрытые и старые позиции." : "Позиции появятся здесь, когда будут добавлены."}
      </p>
      <div className="mt-4 flex gap-2">
        {filtered && <button onClick={onReset} className="btn-ghost">Сбросить фильтры</button>}
        {!filtered && !archive && canCreate && (
          <button onClick={onCreate} className="btn-primary">
            <Plus size={16} />
            Добавить позицию
          </button>
        )}
      </div>
    </div>
  );
}

type SortChoice = { label: string; field: string; dir: "asc" | "desc" };
const SORT_GROUPS: Array<{ title: string; choices: SortChoice[] }> = [
  { title: "Задача", choices: [{ label: "От А до Я", field: "title", dir: "asc" }, { label: "От Я до А", field: "title", dir: "desc" }] },
  { title: "Дедлайн", choices: [{ label: "Сначала ближайшие", field: "deadline", dir: "asc" }, { label: "Сначала дальние", field: "deadline", dir: "desc" }] },
  { title: "Привлекательность", choices: [{ label: "От высокой к низкой", field: "attractiveness", dir: "desc" }, { label: "От низкой к высокой", field: "attractiveness", dir: "asc" }] },
  { title: "Ответственный", choices: [{ label: "От А до Я", field: "owner", dir: "asc" }, { label: "От Я до А", field: "owner", dir: "desc" }] },
  { title: "Трек", choices: [{ label: "От А до Я", field: "track", dir: "asc" }, { label: "От Я до А", field: "track", dir: "desc" }] },
  { title: "Статус", choices: [{ label: "От А до Я", field: "status", dir: "asc" }, { label: "От Я до А", field: "status", dir: "desc" }] },
  { title: "Дата обновления", choices: [{ label: "Сначала новые", field: "updatedAt", dir: "desc" }, { label: "Сначала старые", field: "updatedAt", dir: "asc" }] },
];

/** Кнопка-иконка сортировки: варианты появляются при наведении (как в образце). */
function SortMenu({ sortBy, sortDir, onChange }: { sortBy: string; sortDir: "asc" | "desc"; onChange: (field: string, dir: "asc" | "desc") => void }) {
  const active = SORT_GROUPS.flatMap((g) => g.choices.map((c) => ({ ...c, group: g.title }))).find((c) => c.field === sortBy && c.dir === sortDir);
  return (
    <Popover
      hover
      align="right"
      width={250}
      trigger={({ toggle }) => (
        <button
          onClick={toggle}
          className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-primary-soft hover:text-primary ${sortBy ? "text-primary" : "text-on-surface-variant"}`}
          title={active ? `Сортировка: ${active.group} — ${active.label.toLowerCase()}` : "Сортировка"}
          aria-label="Сортировка"
        >
          <ArrowDownWideNarrow size={20} strokeWidth={2} />
        </button>
      )}
    >
      {(close) => (
        <div className="max-h-[70vh] overflow-y-auto">
          {SORT_GROUPS.map((g) => (
            <div key={g.title} className="py-1">
              <p className="label-caps px-3.5 pb-0.5 pt-1.5">{g.title}</p>
              {g.choices.map((c) => {
                const on = c.field === sortBy && c.dir === sortDir;
                return (
                  <button
                    key={c.label}
                    onClick={() => {
                      onChange(c.field, c.dir);
                      close();
                    }}
                    className={`flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-[13px] transition-colors hover:bg-primary-soft ${on ? "bg-primary-soft font-semibold text-primary" : "text-on-surface"}`}
                  >
                    {c.dir === "asc" ? <ArrowUp size={14} className="shrink-0 text-outline" /> : <ArrowDown size={14} className="shrink-0 text-outline" />}
                    {c.label}
                  </button>
                );
              })}
            </div>
          ))}
          {sortBy && (
            <button
              onClick={() => {
                onChange("", "asc");
                close();
              }}
              className="flex w-full items-center gap-2.5 border-t border-outline-variant px-3.5 py-2.5 text-left text-[13px] font-semibold text-primary hover:bg-primary-soft"
            >
              <RotateCcw size={14} />
              Сбросить сортировку
            </button>
          )}
        </div>
      )}
    </Popover>
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
    <div className="p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="label-caps">Колонки таблицы</p>
        <button onClick={onReset} className="text-[12px] font-semibold text-primary hover:underline">Сбросить</button>
      </div>
      <ul className="max-h-80 divide-y divide-outline-variant/60 overflow-y-auto">
        {columns.map((col, i) => (
          <li key={col.key} className="flex items-center gap-2 py-1.5">
            <input type="checkbox" checked={col.visible} onChange={(e) => update(col.key, { visible: e.target.checked })} className="h-4 w-4 accent-primary" />
            <input value={col.label} onChange={(e) => update(col.key, { label: e.target.value })} readOnly={col.key.startsWith("custom:")} title={col.key.startsWith("custom:") ? "Название своей колонки меняется в настройках" : undefined} className="input h-8 w-36" />
            <span className="w-9 text-right text-[11px] text-outline">{col.visible ? Math.round((col.width / visibleTotal) * 100) : 0}%</span>
            <div className="ml-auto flex">
              <button onClick={() => move(col.key, -1)} disabled={i === 0} className="btn-icon h-8 w-8 disabled:opacity-30" title="Выше"><ArrowUp size={14} /></button>
              <button onClick={() => move(col.key, 1)} disabled={i === columns.length - 1} className="btn-icon h-8 w-8 disabled:opacity-30" title="Ниже"><ArrowDown size={14} /></button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-outline">Настройки колонок сохраняются в вашей учётной записи и одинаковы на любом устройстве. Ширину можно менять перетаскиванием границы в шапке.</p>
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
    <th
      ref={thRef}
      className={`label-caps relative border-b border-outline-variant px-4 py-3 ${CENTERED_COLUMNS.includes(column.key) ? "text-center" : "text-left"}`}
      style={{ width: `${(column.width / totalWeight) * 100}%`, color: "var(--on-surface-variant)" }}
    >
      <span className="block truncate">{column.label}</span>
      <span onMouseDown={onMouseDown} className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize select-none transition-colors hover:bg-sky" />
    </th>
  );
}
