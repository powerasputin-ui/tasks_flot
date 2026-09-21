"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Highlight } from "@/components/ui/Highlight";
import { AlertCircle, ArrowDown, ArrowUp, ArrowDownWideNarrow, BarChart3, ClipboardList, History, Pencil, Plus, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { AnalyticsPanel } from "@/components/AnalyticsPanel";
import { TableExportMenu } from "@/components/TableExportMenu";
import { CycleStrip } from "@/components/CycleStrip";
import { FilterChip, FilterField, MoreFilters } from "@/components/FilterChips";
import type { UserRole } from "@prisma/client";
import { canCreateItem, canDeleteItem, isDirectorial } from "@/lib/permissions";
import { ItemPanel, type ItemRow, type Refs } from "@/components/ItemPanel";
import { SegmentList, SegmentSelect, segmentColors, type SegmentRef } from "@/components/SegmentList";
import { Avatar } from "@/components/ui/Avatar";
import { ATTRACTIVENESS_LABEL, AttractivenessBadge, StatusPill } from "@/components/ui/Badge";
import { RecentChanges } from "@/components/RecentChanges";
import { Panel } from "@/components/ui/Panel";
import { clearBootstrap, loadBootstrap } from "@/lib/client-bootstrap";
import { usePreviewAs } from "@/lib/preview-as";
import { HoverText } from "@/components/ui/HoverText";
import { Popover } from "@/components/ui/Popover";
import { DEFAULT_COLUMNS, loadLocalColumns, normalizeColumns, withCustomColumns, type ColumnConfig, type ColumnKey, type CustomCol } from "@/lib/table-columns";
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
/** Колонки с плашками, датой и галкой: при нехватке места обрезаются без «…» (многоточие рядом с плашкой выглядело как лишние точки). */
const CLIPPED_COLUMNS: ColumnKey[] = ["attractiveness", "status", "deadline", "deadlineWeek", "operFlag"];

const ARCHIVE_LABEL = { active: "Активные", archived: "Архив", all: "Все" } as const;

export function TableView({ defaultArchive = "active" }: { defaultArchive?: "active" | "archived" }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const q = searchParams.get("q") ?? "";

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refs, setRefs] = useState<Refs>({ segments: [], tracks: [], statuses: [], attractiveness: [], users: [] });
  const [segmentRefs, setSegmentRefs] = useState<SegmentRef[]>([]);
  const [realMe, setMe] = useState<Me>(null);
  // Режим «Посмотреть как»: сервер отдаёт данные и права выбранного человека (это и есть me), а запись отключена.
  const preview = usePreviewAs();
  const me = realMe;
  const previewBlock = () => setError("Режим просмотра: изменения отключены.");
  const [savedColumns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [customCols, setCustomCols] = useState<CustomCol[]>([]);
  const columns = useMemo(() => withCustomColumns(savedColumns, customCols), [savedColumns, customCols]);
  const [editor, setEditorState] = useState<{ row: Row | null } | null>(null);
  const [analytics, setAnalytics] = useState(false);
  const [history, setHistory] = useState(false);
  // Экспорт живёт в шапке рядом с колокольчиком: рендерим его туда через портал.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHeaderSlot(document.getElementById("header-actions"));
  }, []);
  // Выбранные сегменты (можно несколько); пусто = все.
  const [segments, setSegments] = useState<string[]>([]);

  // Справа открыта одна панель за раз: карточка позиции или аналитика.
  const setEditor = (v: { row: Row | null } | null) => {
    setEditorState(v);
    if (v) {
      setAnalytics(false);
      setHistory(false);
    }
  };
  const toggleAnalytics = () => {
    setAnalytics((a) => !a);
    setHistory(false);
    setEditorState(null);
  };
  const toggleHistory = () => {
    setHistory((h) => !h);
    setAnalytics(false);
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
  // лента изменений обновляется отдельно и в фоне: правка не должна ждать её перезагрузки
  const [feedTick, setFeedTick] = useState(0);

  // Руководитель видит все позиции, правит только те, где он «Ответственный»; куратор правит всё.
  const isHead = me?.role === "HEAD";
  const canEditRow = useCallback(
    (r: Row) => (me ? isDirectorial(me.role) : false) || (me?.role === "HEAD" && r.ownerId === me.id),
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
    if (preview) return previewBlock();
    const res = await fetch(action === "restore" ? `/api/items/${row.id}/restore` : `/api/items/${row.id}`, {
      method: action === "restore" ? "POST" : "DELETE",
    });
    if (res.ok) {
      const d = await res.json().catch(() => null);
      if (d?.row) applyRow(d.row);
      else setRefetchTick((t) => t + 1);
      setFeedTick((t) => t + 1);
    } else setError(action === "restore" ? "Не удалось вернуть позицию." : "Не удалось удалить позицию: удалять может только тот, кто её заполняет.");
  }

  async function returnRow(row: Row) {
    setCtx(null);
    if (preview) return previewBlock();
    const comment = window.prompt(`Что нужно исправить в «${row.name}»? Комментарий увидит ответственный.`);
    if (!comment?.trim()) return;
    const res = await fetch(`/api/items/${row.id}/return`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    if (res.ok) {
      const d = await res.json().catch(() => null);
      if (d?.row) applyRow(d.row);
      else setRefetchTick((t) => t + 1);
      setFeedTick((t) => t + 1);
    } else setError("Не удалось вернуть позицию.");
  }

  const canDeleteRow = useCallback(
    (r: Row) => !!me && canDeleteItem({ id: me.id, role: me.role as UserRole }, { responsibleId: r.ownerId, createdById: r.createdById }),
    [me]
  );

  // Вид колонок (порядок, подписи, показ, «удалённые») общий для всех и хранится в базе; меняет его куратор.
  // Остальные видят вид куратора; ширину колонок они могут подтянуть на время сессии.
  const myRole = me?.role;
  const canLayoutRef = useRef(false);
  useEffect(() => {
    canLayoutRef.current = (myRole ? isDirectorial(myRole) : false) || myRole === "SYSTEM_ADMIN";
  }, [myRole]);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistColumns = useCallback((next: ColumnConfig[]) => {
    if (!canLayoutRef.current) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    // перетаскивание границы шлёт много изменений подряд — сохраняем один раз, когда закончили
    persistTimer.current = setTimeout(() => {
      fetch("/api/table-columns", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ columns: next }) })
        .then(() => clearBootstrap())
        .catch(() => {});
    }, 600);
  }, []);

  // Один запрос при открытии: пользователь, справочники, свои колонки и общий вид таблицы (см. /api/bootstrap).
  useEffect(() => {
    loadBootstrap().then((b) => {
      if (!b) return;
      setMe(b.user);
      setCustomCols(b.columns ?? []);
      setSegmentRefs(b.segments.map((x) => ({ id: x.id, name: x.name, color: x.color ?? null })));
      setRefs({
        segments: b.segments,
        tracks: b.tracks.map((x) => ({ id: x.id, name: x.name, segmentId: x.segmentId })),
        statuses: b.statuses,
        attractiveness: b.attractiveness,
        users: b.users.map((x) => ({ id: x.id, name: x.name })),
      });
      if (b.tableColumns) setColumns(normalizeColumns(b.tableColumns as ColumnConfig[]));
      else {
        // общего вида ещё нет: до первого сохранения куратором берём то, что было настроено в этом браузере
        const local = loadLocalColumns();
        if (local) setColumns(normalizeColumns(local));
      }
    });
  }, []);

  function saveColumns(next: ColumnConfig[]) {
    setColumns(next);
    persistColumns(next);
  }

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

  /** Кладёт строку, вернувшуюся с сервера, в список сразу — без ожидания полной перезагрузки таблицы. */
  const applyRow = useCallback(
    (row: Row) => {
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.id === row.id);
        const visible = archive === "all" || (archive === "archived" ? row.archived : !row.archived);
        if (!visible) return idx >= 0 ? prev.filter((r) => r.id !== row.id) : prev;
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = row;
          return next;
        }
        return [row, ...prev];
      });
    },
    [archive]
  );

  const paramsRef = useRef(baseParams);
  useEffect(() => {
    paramsRef.current = baseParams;
  }, [baseParams]);
  /** Тихая сверка списка с сервером (без индикатора загрузки) — например, после конфликта версий. */
  const revalidate = useCallback(() => {
    fetch(`/api/items?${paramsRef.current.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.rows && setRows(d.rows))
      .catch(() => {});
  }, []);

  async function toggleOper(row: Row, next: boolean) {
    if (preview) return previewBlock();
    applyRow({ ...row, operFlag: next }); // галка меняется сразу, не дожидаясь сервера
    const res = await fetch(`/api/items/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: row.version, operFlag: next }),
    });
    if (res.ok) {
      const d = await res.json().catch(() => null);
      if (d?.row) applyRow(d.row);
      setFeedTick((t) => t + 1);
      return;
    }
    applyRow(row); // не вышло — возвращаем как было
    setError(res.status === 409 ? "Позиция была изменена другим пользователем — список обновлён." : "Не удалось изменить отметку «Опер».");
    if (res.status === 409) revalidate();
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
  /** Убирает поисковый запрос из адреса (строка поиска в шапке следит за адресом и очистится сама). */
  function clearQuery() {
    router.replace(pathname, { scroll: false });
  }

  function resetFilters() {
    clearQuery();
    setTrackIds([]); setStatusIds([]); setAttractivenessIds([]); setOwnerIds([]); setOperFlags([]);
    setDeadlineFrom(""); setDeadlineTo(""); setArchive(defaultArchive);
  }

  const visibleColumns = columns.filter((c) => c.visible && !c.removed);
  const totalWeight = visibleColumns.reduce((s, c) => s + c.width, 0) || 1;

  function renderCell(row: Row, col: ColumnConfig) {
    switch (col.key) {
      case "track":
        return row.trackName ? <Highlight text={row.trackName} query={q} /> : "—";
      case "cost":
        return row.cost ? <Highlight text={row.cost} query={q} /> : "—";
      case "attractiveness":
        return <AttractivenessBadge name={row.attractivenessName} color={row.attractivenessColor} />;
      case "name":
        return <HoverText text={row.name} lines={2} query={q} className={`text-[13px] leading-snug ${row.archived ? "text-outline" : "text-on-surface"}`} />;
      case "deadline":
        return row.deadline ? (
          <span className={`inline-flex items-center gap-1 ${isOverdue(row) ? "font-semibold text-status-red" : ""}`}>
            {isOverdue(row) && <AlertCircle size={13} />}
            {new Date(row.deadline).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })}
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
            <span className="truncate"><Highlight text={row.ownerName} query={q} /></span>
            {(row.ownerRole === "ADMIN" || row.ownerRole === "DIRECTOR") && <RoleMark role={row.ownerRole} />}
          </span>
        ) : (
          "—"
        );
      case "status":
        return <StatusPill name={row.statusName} color={row.statusColor} />;
      case "operFlag": {
        const mark = row.operFlag && row.changedAfterSubmission && (
          <span title="Изменено после отправки директору — откройте историю позиции" className="ml-1.5 inline-flex h-4 items-center rounded-sm bg-status-amber/15 px-1 text-[10px] font-bold text-status-amber">
            изм.
          </span>
        );
        return canEditRow(row) && !row.archived ? (
          <span className="inline-flex items-center">
          <input
            type="checkbox"
            checked={row.operFlag}
            disabled={!!preview}
            onChange={(e) => toggleOper(row, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 cursor-pointer accent-primary"
            title="Отправить директору"
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
        return row.comment ? <HoverText text={row.comment} lines={3} query={q} className={`text-[13px] leading-snug ${row.archived ? "text-outline" : "text-on-surface"}`} /> : "—";
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
      {headerSlot &&
        createPortal(
          <>
            <button onClick={toggleAnalytics} className={`btn-icon ${analytics ? "bg-primary-soft text-primary" : ""}`} title="Аналитика выборки" aria-label="Аналитика выборки">
              <BarChart3 size={18} />
            </button>
            {me && me.role !== "SYSTEM_ADMIN" && <TableExportMenu params={exportParams} reports={isDirectorial(me.role)} />}
          </>,
          headerSlot
        )}
      <SegmentList segments={segmentRefs} counts={counts} selected={segments} onToggle={(id) => setSegments((s) => toggleSegment(s, id))} onClear={() => setSegments([])} />

      <section className="flex min-w-0 flex-1 flex-col">
        {me?.role === "HEAD" && !preview && defaultArchive !== "archived" && <CycleStrip />}
        <div className="border-b border-outline-variant bg-surface px-6 py-4">
          <div className="mb-3">
            <SegmentSelect segments={segmentRefs} counts={counts} selected={segments} onToggle={(id) => setSegments((s) => toggleSegment(s, id))} onClear={() => setSegments([])} />
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="label-caps">{defaultArchive === "archived" ? "Архив позиций" : "Рабочая таблица"}</p>
              <h2 className="truncate text-2xl font-semibold leading-8 text-on-surface">{selectedName}</h2>
              <p className="mt-0.5 text-[12px] text-on-surface-variant">
                {loading ? "Загрузка…" : `${visibleRows.length} позиций · ${operCount} отправлено директору`}
                {lastUpdated && !loading && ` · обновлено ${new Date(lastUpdated).toLocaleDateString("ru-RU")}`}
              </p>
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
            {/* Правый край ряда: «+ Добавить» и иконка истории (без контура) на одной линии */}
            <div className="ml-auto flex items-center gap-2">
              {me && canCreateItem(me.role as UserRole) && defaultArchive !== "archived" && (
                <button onClick={() => setEditor({ row: null })} className="btn-primary">
                  <Plus size={16} />
                  Добавить
                </button>
              )}
              <button
                onClick={toggleHistory}
                className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-primary-soft hover:text-primary ${history ? "text-primary" : "text-on-surface-variant"}`}
                title="История изменений"
                aria-label="История изменений"
              >
                <History size={20} />
              </button>
            </div>
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
                              className={`${CLIPPED_COLUMNS.includes(col.key) ? "px-2" : "px-4"} py-3.5 align-middle text-on-surface ${CENTERED_COLUMNS.includes(col.key) ? "text-center" : ""} ${
                                col.key === "name" || col.key === "comment" ? "" : CLIPPED_COLUMNS.includes(col.key) ? "overflow-hidden text-clip" : "truncate"
                              }`}
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
              <EmptyState query={q} filtered={anyFilter || segments.length > 0} onReset={() => { resetFilters(); setSegments([]); }} archive={defaultArchive === "archived"} canCreate={!!me && canCreateItem(me.role as UserRole)} onCreate={() => setEditor({ row: null })} />
            )}
          </div>

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
              {me && isDirectorial(me.role) && ctx.row.operFlag && !ctx.row.archived && (
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

      {history && (
        <Panel title="История изменений" subtitle={segments.length === 0 ? "Все сегменты" : selectedName} width={480} onClose={() => setHistory(false)}>
          <RecentChanges segments={segments} refreshKey={feedTick + refetchTick} onOpen={openById} people={refs.users} customColumns={customCols} />
        </Panel>
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
          previewMode={!!preview}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            setEditor(null);
            if (saved) applyRow(saved as Row);
            else setRefetchTick((t) => t + 1);
            setFeedTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

/** Метка рядом с директором («Д») и админом («А») в списке ответственных. */
function RoleMark({ role }: { role: string }) {
  return (
    <span title={role === "DIRECTOR" ? "Директор" : "Админ"} className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-primary text-[10px] font-bold leading-none text-white">
      {role === "DIRECTOR" ? "Д" : "А"}
    </span>
  );
}

function EmptyState({ filtered, onReset, archive, canCreate, onCreate, query }: { filtered: boolean; onReset: () => void; archive: boolean; canCreate: boolean; onCreate: () => void; query: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-high text-outline">
        <ClipboardList size={22} />
      </span>
      <p className="text-[14px] font-semibold text-on-surface">{filtered ? (query.trim() ? `Ничего не найдено по запросу «${query.trim()}»` : "Ничего не найдено") : archive ? "В архиве пока пусто" : "Пока нет позиций"}</p>
      <p className="mt-1 max-w-sm text-[13px] text-on-surface-variant">
        {filtered ? "Проверьте написание, попробуйте меньше слов (ищутся все слова сразу) или сбросьте фильтры." : archive ? "Сюда попадают закрытые и старые позиции." : "Позиции появятся здесь, когда будут добавлены."}
      </p>
      <div className="mt-4 flex gap-2">
        {filtered && <button onClick={onReset} className="btn-ghost">Сбросить поиск и фильтры</button>}
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
