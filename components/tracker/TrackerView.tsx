"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, Flame, KanbanSquare, List, Search, Timer } from "lucide-react";
import { ItemPanel, type ItemRow, type Refs } from "@/components/ItemPanel";
import { FilterChip } from "@/components/FilterChips";
import { StatusPill } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { PersonAvatar } from "@/components/ui/Person";
import { segmentColors } from "@/components/SegmentList";
import { loadBootstrap, type Bootstrap } from "@/lib/client-bootstrap";
import { isDirectorial } from "@/lib/permissions";
import { matchesTokens, normalizeText, tokenize } from "@/lib/search";
import { usePreviewAs } from "@/lib/preview-as";
import { useIsMobile } from "@/lib/use-mobile";
import { BOARD_COLUMNS, columnOf, ruDay, statusForColumn, summarize, type TaskSummary, type TrackerColumnKey, type TrackerEvent } from "@/lib/tracker";
import { TrackerTimeline } from "@/components/tracker/TrackerTimeline";
import { AiChat, TRACKER_QUICK } from "@/components/AiChat";

/** Строка трекера = строка общей таблицы (как её отдаёт /api/tracker). */
export type TRow = ItemRow & {
  segmentName: string | null;
  trackName: string | null;
  ownerName: string | null;
  statusName: string | null;
  statusColor: string | null;
  updatedAt: string;
  /** Только у ЗГД (трекер по отправленным справкам): дирекция и дата справки, на которую показано состояние. */
  directorateName?: string;
  asOf?: string;
  inMemo?: boolean;
};
type Status = { id: string; name: string; color: string | null; trackerColumn: TrackerColumnKey | null };
type Data = { rows: TRow[]; statuses: Status[]; events: TrackerEvent[]; hot: Record<string, string[]>; since: string | null; mode?: "sent" };
type View = "list" | "board" | "timeline";

const VIEWS: Array<{ key: View; label: string; icon: typeof List }> = [
  { key: "list", label: "Список", icon: List },
  { key: "board", label: "Доска", icon: KanbanSquare },
  { key: "timeline", label: "Таймлайн", icon: CalendarClock },
];
const VIEW_KEY = "operativka.tracker.view";

/** Просрочено: срок прошёл, а задача не «Выполнено»/«Не показывать». */
export function overdue(r: TRow, col: TrackerColumnKey): boolean {
  return !!r.deadline && col !== "DONE" && col !== "HIDDEN" && new Date(r.deadline).getTime() < Date.now() - 24 * 3600 * 1000;
}

export function TrackerView() {
  const router = useRouter();
  const params = useSearchParams();
  const isMobile = useIsMobile();
  const preview = usePreviewAs();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<View>("list");
  const [mine, setMine] = useState(false);
  const [hotOnly, setHotOnly] = useState(false);
  const [slipOnly, setSlipOnly] = useState(false);
  const [segmentIds, setSegmentIds] = useState<string[]>([]);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [editor, setEditor] = useState<TRow | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    loadBootstrap().then(setBoot);
  }, []);
  useEffect(() => {
    const fromUrl = params.get("view") as View | null;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(VIEW_KEY);
    } catch {}
    const v = fromUrl ?? (saved as View | null) ?? (isMobile ? "list" : "board");
    if (VIEWS.some((x) => x.key === v)) setView(v);
  }, [params, isMobile]);
  useEffect(() => {
    let alive = true;
    fetch("/api/tracker")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Data) => alive && (setData(d), setError(null)))
      .catch((s) => alive && setError(s === 403 ? "Трекер доступен тем, кто работает с таблицей позиций." : "Не удалось загрузить трекер. Обновите страницу."));
    return () => {
      alive = false;
    };
  }, [tick]);
  // ссылка «на трекере» из таблицы: ?item=<id> — сразу открыть карточку
  useEffect(() => {
    const id = params.get("item");
    if (id && data) setEditor(data.rows.find((r) => r.id === id) ?? null);
  }, [params, data]);

  function pickView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }

  const me = boot?.user ?? null;
  const directorial = !!me && isDirectorial(me.role);
  // ИИ-помощник — у тех же, что на «Оперативке»: ЗГД, админ, директор
  const aiUser = me?.role === "EXECUTIVE" || me?.role === "ADMIN" || me?.role === "DIRECTOR";
  const canEditRow = useCallback((r: TRow) => directorial || (me?.role === "HEAD" && r.ownerId === me.id), [directorial, me]);

  const colOf = useMemo(() => new Map((data?.statuses ?? []).map((s) => [s.id, s.trackerColumn])), [data]);
  const byItem = useMemo(() => {
    const m = new Map<string, TrackerEvent[]>();
    for (const e of data?.events ?? []) m.set(e.itemId, [...(m.get(e.itemId) ?? []), e]);
    return m;
  }, [data]);
  const summaries = useMemo(() => new Map([...byItem].map(([id, ev]) => [id, summarize(ev)])), [byItem]);
  // ЗГД: только чтение, данные — снимки отправленных справок (несколько дирекций — дирекция в названии группы)
  const sent = data?.mode === "sent";
  const manyDirs = sent && new Set(data?.rows.map((r) => r.directorateName)).size > 1;
  const segRefs = useMemo(() => {
    if (!sent) return (boot?.segments ?? []).map((s) => ({ id: s.id, name: s.name, color: s.color ?? null }));
    const m = new Map<string, string>();
    for (const r of data?.rows ?? []) if (r.segmentId) m.set(r.segmentId, manyDirs ? `${r.directorateName} · ${r.segmentName ?? "Без сегмента"}` : r.segmentName ?? "Без сегмента");
    return [...m].map(([id, name]) => ({ id, name, color: null }));
  }, [sent, manyDirs, boot, data]);
  const ownerOptions = useMemo(
    () => (sent ? [...new Set((data?.rows ?? []).map((r) => r.ownerName).filter((x): x is string => !!x))].sort().map((n) => ({ id: n, name: n })) : (boot?.users ?? []).map((u) => ({ id: u.id, name: u.name }))),
    [sent, data, boot],
  );
  const colors = useMemo(() => segmentColors(segRefs), [segRefs]);
  const asOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of data?.rows ?? []) if (r.directorateName && r.asOf) m.set(r.directorateName, r.asOf);
    return [...m];
  }, [data]);

  const rows = useMemo(() => {
    const tokens = tokenize(q);
    return (data?.rows ?? [])
      .map((r) => (manyDirs ? { ...r, segmentName: `${r.directorateName} · ${r.segmentName ?? "Без сегмента"}` } : r))
      .filter((r) => {
      if (columnOf(r.statusId, colOf) === "HIDDEN") return false;
      if (mine && r.ownerId !== me?.id && !(directorial && !r.ownerId && r.createdById === me?.id)) return false;
      if (hotOnly && !data?.hot[r.id]) return false;
      if (slipOnly && !(summaries.get(r.id)?.slips ?? 0)) return false;
      if (segmentIds.length && !segmentIds.includes(r.segmentId ?? "none")) return false;
      if (ownerIds.length && !ownerIds.includes(r.ownerId ?? "none")) return false;
      if (tokens.length && !matchesTokens(normalizeText([r.name, r.comment, r.segmentName, r.trackName, r.ownerName, r.statusName].filter(Boolean).join(" ")), tokens)) return false;
      return true;
    });
  }, [data, colOf, mine, hotOnly, slipOnly, summaries, segmentIds, ownerIds, q, me, manyDirs, directorial]);

  const refs: Refs = useMemo(
    () => ({
      segments: boot?.segments ?? [],
      tracks: (boot?.tracks ?? []).map((t) => ({ id: t.id, name: t.name, segmentId: t.segmentId })),
      statuses: boot?.statuses ?? [],
      attractiveness: boot?.attractiveness ?? [],
      users: (boot?.users ?? []).map((u) => ({ id: u.id, name: u.name })),
    }),
    [boot],
  );

  // перенос карточки на доске = смена статуса через обычное сохранение позиции (журнал, справка, права — как в таблице)
  async function move(row: TRow, col: TrackerColumnKey) {
    if (!data || columnOf(row.statusId, colOf) === col) return;
    if (preview) return setError("В режиме просмотра менять задачи нельзя.");
    const statusId = statusForColumn(col, data.statuses);
    if (!statusId) return setError("Для этой колонки не назначен ни один статус (Настройки → Статусы).");
    const prev = data;
    setData({ ...data, rows: data.rows.map((r) => (r.id === row.id ? { ...r, statusId, statusName: data.statuses.find((s) => s.id === statusId)?.name ?? null, statusColor: data.statuses.find((s) => s.id === statusId)?.color ?? null } : r)) });
    const res = await fetch(`/api/items/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: row.version, statusId }) });
    if (res.ok) {
      setError(null);
      setTick((t) => t + 1);
      return;
    }
    setData(prev);
    const body = await res.json().catch(() => null);
    setError(body?.message ?? (body?.error === "CONFLICT" ? "Задачу только что изменил кто-то другой — трекер обновлён." : "Не удалось перенести задачу."));
    if (body?.error === "CONFLICT") setTick((t) => t + 1);
  }

  const counts = useMemo(() => Object.fromEntries(BOARD_COLUMNS.map((c) => [c.key, rows.filter((r) => columnOf(r.statusId, colOf) === c.key).length])), [rows, colOf]);
  const hotCount = rows.filter((r) => data?.hot[r.id]).length;
  const slipped = rows.filter((r) => (summaries.get(r.id)?.slips ?? 0) > 0).length;

  return (
    <div className={`min-h-0 flex-1 overflow-auto p-6 max-md:p-3 ${aiUser ? "pb-28" : ""}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-on-surface">Трекер</h1>
          <p className="mt-0.5 max-w-2xl text-[13px] text-on-surface-variant">
            {sent ? (
              <>
                По отправленным справкам: состояние — на дату последней справки{asOf.length ? ` (${asOf.map(([d, at]) => (manyDirs ? `${d} — ${ruDay(at)}` : ruDay(at))).join(", ")})` : ""}, история — что менялось от справки к справке.
                {data?.since && <> Первая справка — {ruDay(data.since)}.</>}
              </>
            ) : (
              <>
                Те же позиции, что в общей таблице, — в виде доски и истории. Заполнять отдельно ничего не нужно.
                {data?.since && <> История ведётся с {ruDay(data.since)}.</>}
              </>
            )}
          </p>
        </div>
        <div className="flex rounded-md border border-outline-variant bg-surface p-0.5" role="tablist" aria-label="Вид трекера">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={view === v.key}
              onClick={() => pickView(v.key)}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] font-semibold ${view === v.key ? "bg-primary text-white" : "text-on-surface-variant hover:bg-surface-high"}`}
            >
              <v.icon size={15} /> {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* итоги для решения «в масштабе»: сколько где, что горит, где срок уже сдвигали */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        {BOARD_COLUMNS.map((c) => (
          <span key={c.key} className="rounded-full bg-surface-high px-2.5 py-1 font-semibold text-on-surface-variant">
            {c.label}: <span className="text-on-surface">{counts[c.key] ?? 0}</span>
          </span>
        ))}
        <button onClick={() => setHotOnly((v) => !v)} aria-pressed={hotOnly} className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${hotOnly ? "bg-status-red text-white" : "bg-status-red/10 text-status-red"}`} title="Правило: просрочено; срок ≤ 3 дн.; ждём чужого решения без срока; нет ни срока, ни статуса; не подана при сроке ≤ 7 дн.">
          <Flame size={13} /> Горит: {hotCount}
        </button>
        {(slipped > 0 || slipOnly) && (
          <button onClick={() => setSlipOnly((v) => !v)} aria-pressed={slipOnly} className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${slipOnly ? "bg-[#b45309] text-white" : "bg-status-amber/15 text-[#b45309]"}`} title="Задачи, у которых срок переносили позже — нажмите, чтобы показать только их">
            <Timer size={13} /> Срок сдвигали: {slipped}
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!sent && (
        <div className="flex rounded-md border border-outline-variant bg-surface p-0.5 text-[13px]">
          <button onClick={() => setMine(false)} className={`rounded px-3 py-1 font-semibold ${!mine ? "bg-primary-soft text-primary" : "text-on-surface-variant"}`}>Все задачи</button>
          <button onClick={() => setMine(true)} className={`rounded px-3 py-1 font-semibold ${mine ? "bg-primary-soft text-primary" : "text-on-surface-variant"}`}>Мои задачи</button>
        </div>
        )}
        <FilterChip label="Сегмент" value={segmentIds} options={[...segRefs.map((s) => ({ id: s.id, name: s.name })), { id: "none", name: "Без сегмента" }]} onChange={setSegmentIds} />
        <FilterChip label="Ответственный" value={ownerIds} options={[...ownerOptions, { id: "none", name: "Не назначен" }]} onChange={setOwnerIds} />
        <label className="relative ml-auto max-md:ml-0 max-md:w-full">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-outline" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по задачам" className="input w-64 pl-8 max-md:w-full" aria-label="Поиск по задачам" />
        </label>
      </div>

      {error && <div className="mb-3 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-[13px] text-status-red">{error}</div>}
      {!data && !error && <div className="skeleton h-64 w-full rounded-lg" />}
      {data && rows.length === 0 && <div className="surface px-4 py-10 text-center text-[13px] text-on-surface-variant">Задач по этим условиям нет.</div>}

      {data && rows.length > 0 && view === "list" && <TrackerList rows={rows} colOf={colOf} hot={data.hot} summaries={summaries} colors={colors} onOpen={setEditor} />}
      {data && rows.length > 0 && view === "board" && <TrackerBoard rows={rows} colOf={colOf} hot={data.hot} summaries={summaries} colors={colors} onOpen={setEditor} canMove={(r) => !sent && canEditRow(r) && !preview} canDone={directorial || sent} onMove={move} mainStatus={new Map(BOARD_COLUMNS.map((c) => [c.key, statusForColumn(c.key, data.statuses)]))} />}
      {data && rows.length > 0 && view === "timeline" && <TrackerTimeline rows={rows} colOf={colOf} hot={data.hot} events={byItem} colors={colors} onOpen={setEditor} />}

      {/* тот же чат, что на «Оперативке»: ЗГД, директор, админ; разговор продолжается при переходе */}
      {aiUser && <AiChat versionIds={[]} scopeLabel={sent ? "трекер и последние справки дирекций" : "трекер и таблица дирекции"} inherit quick={TRACKER_QUICK} forDirector={me?.role === "DIRECTOR"} />}
      {editor && sent && <SentPanel row={editor} events={byItem.get(editor.id) ?? []} hot={data?.hot[editor.id]} onClose={() => setEditor(null)} />}
      {editor && !sent && (
        <ItemPanel
          key={editor.id}
          row={editor}
          prefill={null}
          onRowUpdated={() => setTick((t) => t + 1)}
          refs={refs}
          defaultResponsibleId={me?.id ?? ""}
          lockResponsible={me?.role === "HEAD"}
          canEdit={canEditRow(editor)}
          canDelete={false}
          customColumns={boot?.columns ?? []}
          previewMode={!!preview}
          onClose={() => {
            setEditor(null);
            if (params.get("item")) router.replace("/tracker");
          }}
          onSaved={() => {
            setEditor(null);
            setTick((t) => t + 1);
            if (params.get("item")) router.replace("/tracker");
          }}
        />
      )}
    </div>
  );
}

type Common = { rows: TRow[]; colOf: Map<string, TrackerColumnKey | null>; hot: Record<string, string[]>; summaries: Map<string, TaskSummary>; colors: Map<string, string>; onOpen: (r: TRow) => void };

/** Сегмент → трек → задачи, в порядке появления. */
function groupRows(rows: TRow[]): Array<{ key: string; segmentId: string | null; segment: string; tracks: Array<{ track: string; rows: TRow[] }> }> {
  const segs = new Map<string, { key: string; segmentId: string | null; segment: string; tracks: Map<string, TRow[]> }>();
  for (const r of rows) {
    const k = r.segmentId ?? "none";
    const s = segs.get(k) ?? { key: k, segmentId: r.segmentId, segment: r.segmentName ?? "Без сегмента", tracks: new Map() };
    const t = r.trackName ?? "Без трека";
    s.tracks.set(t, [...(s.tracks.get(t) ?? []), r]);
    segs.set(k, s);
  }
  return [...segs.values()].map((s) => ({ ...s, tracks: [...s.tracks].map(([track, rows]) => ({ track, rows })) }));
}

/** Метки задачи: горит, срок сдвигали, давно без движения. */
function Marks({ row, hot, summary, done }: { row: TRow; hot?: string[]; summary?: TaskSummary; done?: boolean }) {
  return (
    <>
      {hot && (
        <span className="inline-flex items-center gap-1 rounded-sm bg-status-red/10 px-1.5 py-px text-[11px] font-semibold text-status-red" title={hot.join("; ")}>
          <Flame size={11} /> горит
        </span>
      )}
      {summary && summary.slips > 0 && (
        <span className="rounded-sm bg-status-amber/15 px-1.5 py-px text-[11px] font-semibold text-[#b45309]" title="Срок переносили позже">
          срок сдвигали {summary.slips}× (+{summary.slipDays} дн.)
        </span>
      )}
      {!done && summary?.idleDays !== null && summary && summary.idleDays >= 14 && (
        <span className="rounded-sm bg-surface-high px-1.5 py-px text-[11px] font-semibold text-on-surface-variant" title="Последнее изменение задачи">
          без движения {summary.idleDays} дн.
        </span>
      )}
      {row.inMemo !== undefined
        ? row.inMemo && <span className="rounded-sm bg-primary-soft px-1.5 py-px text-[11px] font-semibold text-primary" title="Вошла в последнюю отправленную справку">в справке</span>
        : row.operFlag && <span className="rounded-sm bg-primary-soft px-1.5 py-px text-[11px] font-semibold text-primary">подана в справку</span>}
    </>
  );
}

function Deadline({ row, col }: { row: TRow; col: TrackerColumnKey }) {
  if (!row.deadline) return <span className="text-outline">срока нет</span>;
  return <span className={overdue(row, col) ? "font-semibold text-status-red" : "text-on-surface-variant"}>до {ruDay(row.deadline)}</span>;
}

function TrackerList({ rows, colOf, hot, summaries, colors, onOpen }: Common) {
  return (
    <div className="space-y-4">
      {groupRows(rows).map((g) => (
        <section key={g.key} className="surface overflow-hidden">
          <h2 className="border-b border-l-4 border-outline-variant bg-surface-low px-4 py-2 text-[13px] font-bold text-on-surface" style={{ borderLeftColor: colors.get(g.segmentId ?? "none") ?? "#94a3b8" }}>
            {g.segment}
          </h2>
          {g.tracks.map((t) => (
            <div key={t.track}>
              <div className="label-caps px-4 pb-1 pt-3">{t.track}</div>
              <ul>
                {t.rows.map((r) => {
                  const col = columnOf(r.statusId, colOf);
                  return (
                    <li key={r.id}>
                      <button onClick={() => onOpen(r)} className="row-hover flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-t border-outline-variant/50 px-4 py-2.5 text-left">
                        <span className="min-w-0 flex-1 basis-72 text-[13px] text-on-surface [overflow-wrap:anywhere]">{r.name}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Marks row={r} hot={hot[r.id]} summary={summaries.get(r.id)} done={col === "DONE"} />
                        </span>
                        <span className="w-32 shrink-0"><StatusPill name={r.statusName ?? "Без статуса"} color={r.statusColor} /></span>
                        <span className="flex w-40 shrink-0 items-center gap-1.5 truncate text-[12px] text-on-surface-variant">
                          {r.ownerName && <PersonAvatar name={r.ownerName} size={20} />} {r.ownerName ?? "не назначен"}
                        </span>
                        <span className="w-24 shrink-0 text-[12px]"><Deadline row={r} col={col} /></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function TrackerBoard({ rows, colOf, hot, summaries, colors, onOpen, canMove, canDone, onMove, mainStatus }: Common & { canMove: (r: TRow) => boolean; canDone: boolean; onMove: (r: TRow, col: TrackerColumnKey) => void; mainStatus: Map<TrackerColumnKey, string | null> }) {
  const [drag, setDrag] = useState<TRow | null>(null);
  const [over, setOver] = useState<TrackerColumnKey | null>(null);
  const allowed = (r: TRow, col: TrackerColumnKey) => canDone || (col !== "DONE" && columnOf(r.statusId, colOf) !== "DONE");
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {BOARD_COLUMNS.map((c) => {
        const items = rows.filter((r) => columnOf(r.statusId, colOf) === c.key);
        const droppable = !!drag && allowed(drag, c.key);
        return (
          <section
            key={c.key}
            aria-label={c.label}
            onDragOver={(e: DragEvent) => {
              if (!droppable) return;
              e.preventDefault();
              setOver(c.key);
            }}
            onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              setOver(null);
              if (drag && droppable) onMove(drag, c.key);
              setDrag(null);
            }}
            className={`flex min-w-64 flex-1 basis-0 flex-col rounded-lg border bg-surface-low p-2 transition-colors ${over === c.key ? "border-primary bg-primary-soft" : "border-outline-variant"} ${drag && !droppable ? "opacity-60" : ""}`}
          >
            <header className="mb-2 flex items-center justify-between px-1">
              <span className="text-[13px] font-bold text-on-surface">{c.label}</span>
              <span className="rounded-full bg-surface-high px-2 text-[11px] font-semibold text-on-surface-variant">{items.length}</span>
            </header>
            {c.key === "DONE" && !canDone && <p className="mb-2 px-1 text-[11px] text-outline">Сюда задачу переносит директор — переведите её в «На проверке».</p>}
            <div className="flex min-h-24 flex-col gap-2">
              {items.map((r) => (
                <article
                  key={r.id}
                  draggable={canMove(r) && allowed(r, "REVIEW")}
                  onDragStart={() => setDrag(r)}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  onClick={() => onOpen(r)}
                  onKeyDown={(e) => e.key === "Enter" && onOpen(r)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Задача: ${r.name}`}
                  className="surface cursor-pointer border-l-4 p-3 outline-none hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary"
                  style={{ borderLeftColor: colors.get(r.segmentId ?? "none") ?? "#94a3b8" }}
                >
                  <div className="truncate text-[11px] text-outline">{[r.segmentName, r.trackName].filter(Boolean).join(" · ") || "Без сегмента"}</div>
                  <div className="mt-0.5 line-clamp-3 text-[13px] font-medium text-on-surface [overflow-wrap:anywhere]">{r.name}</div>
                  {r.statusName && r.statusId !== mainStatus.get(c.key) && (
                    <div className="mt-1.5">
                      <StatusPill name={r.statusName} color={r.statusColor} />
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Marks row={r} hot={hot[r.id]} summary={summaries.get(r.id)} done={c.key === "DONE"} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-on-surface-variant">
                      {r.ownerName && <PersonAvatar name={r.ownerName} size={20} />} <span className="truncate">{r.ownerName ?? "не назначен"}</span>
                    </span>
                    <Deadline row={r} col={c.key} />
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Карточка задачи у ЗГД: только чтение — поля из последней справки и история от справки к справке. */
function SentPanel({ row, events, hot, onClose }: { row: TRow; events: TrackerEvent[]; hot?: string[]; onClose: () => void }) {
  const fields: Array<[string, string]> = [
    ["Дирекция", row.directorateName ?? "—"],
    ["Сегмент · трек", [row.segmentName, row.trackName].filter(Boolean).join(" · ") || "—"],
    ["Ответственный", row.ownerName ?? "не назначен"],
    ["Статус", row.statusName ?? "без статуса"],
    ["Срок", row.deadline ? ruDay(row.deadline) : "срока нет"],
    ["Состояние на", row.asOf ? `справку от ${ruDay(row.asOf)}` : "—"],
  ];
  return (
    <Panel title={row.name} subtitle="Только просмотр: данные из отправленных справок" onClose={onClose}>
      <div className="space-y-4 px-5 py-4 text-[13px]">
        {hot && <p className="rounded-md bg-status-red/10 px-3 py-2 text-status-red">Горит: {hot.join("; ")}</p>}
        <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5">
          {fields.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-on-surface-variant">{k}</dt>
              <dd className="text-on-surface">{v}</dd>
            </Fragment>
          ))}
        </dl>
        {row.comment && <p className="whitespace-pre-wrap text-on-surface [overflow-wrap:anywhere]">{row.comment}</p>}
        <div>
          <div className="label-caps mb-1">История по справкам</div>
          <ul className="space-y-1.5">
            {events.map((e, i) => ({ e, i })).sort((a, b) => b.e.at.localeCompare(a.e.at) || a.i - b.i).map(({ e }, k) => (
              <li key={k} className="flex gap-2">
                <span className="w-16 shrink-0 text-outline">{ruDay(e.at)}</span>
                <span className={e.slip ? "font-semibold text-status-red" : "text-on-surface"}>{e.text}</span>
              </li>
            ))}
            {!events.length && <li className="text-outline">Событий нет.</li>}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
