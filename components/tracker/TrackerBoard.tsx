"use client";

import { useState, type DragEvent } from "react";
import { ChevronsLeft, ChevronsRight, Paperclip, Plus } from "lucide-react";
import { StatusPill } from "@/components/ui/Badge";
import { PersonAvatar } from "@/components/ui/Person";
import { columnOf, dropBlockReason, dropTargets, type HotInfo, type TaskSummary, type TrackerColumnKey } from "@/lib/tracker";
import { Deadline, Marks, MenuButton, type TRow } from "@/components/tracker/TrackerView";

export type BoardColumn = { key: TrackerColumnKey; label: string };

type Props = {
  rows: TRow[];
  colOf: Map<string, TrackerColumnKey | null>;
  hot: Record<string, HotInfo>;
  summaries: Map<string, TaskSummary>;
  colors: Map<string, string>;
  onOpen: (r: TRow) => void;
  onMenu?: (r: TRow, e: { clientX: number; clientY: number; preventDefault: () => void }) => void;
  unconfirmed?: (r: TRow) => boolean;
  deletedInfo?: (r: TRow) => string | undefined;
  columns: BoardColumn[];
  canMove: (r: TRow) => boolean;
  director: boolean;
  onMove: (r: TRow, col: TrackerColumnKey) => void;
  mainStatus: Map<TrackerColumnKey, string | null>;
  /** Полночь UTC сегодняшнего дня по Москве — для чипа срока. */
  today: number;
  /** Дата приёмки выполненной задачи (из журнала). */
  doneAt: (r: TRow) => string;
  /** Быстрое создание в «Сделать»: вернуть текст ошибки или null; нет — кнопки «+ Задача» нет. */
  onQuickAdd?: (title: string) => Promise<string | null>;
};

// цвет верхней полосы колонки: смысл, а не украшение (серый — ещё не начато, синий — идёт, янтарный — ждёт решения, зелёный — готово)
const ACCENT: Record<TrackerColumnKey, string> = { TODO: "#94a3b8", DOING: "#2563eb", REVIEW: "#d97706", DONE: "#059669", HIDDEN: "#64748b" };
const EMPTY: Record<TrackerColumnKey, string> = {
  TODO: "Здесь появятся задачи, которые ещё не начаты",
  DOING: "Здесь задачи, которые сейчас делают",
  REVIEW: "Сданные на проверку ждут решения директора",
  DONE: "Принятые задачи (по умолчанию — за 14 дней)",
  HIDDEN: "Отменённые задачи («Не актуально»)",
};
const COLLAPSED_KEY = "operativka.tracker.board.collapsed";
const DENSE_KEY = "operativka.tracker.board.dense";

const read = (k: string): string | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* память браузера недоступна — настройка просто не запомнится */
  }
};

/** Доска: колонки со своей прокруткой и липкой шапкой, карточки «как в Jira». Допустимость переходов — lib/tracker.ts (dropTargets). */
export function TrackerBoard({ rows, colOf, hot, summaries, colors, onOpen, onMenu, columns, canMove, director, onMove, mainStatus, unconfirmed, deletedInfo, today, doneAt, onQuickAdd }: Props) {
  const [drag, setDrag] = useState<TRow | null>(null);
  const [over, setOver] = useState<TrackerColumnKey | null>(null);
  const [collapsed, setCollapsed] = useState<TrackerColumnKey[]>(() => {
    try {
      return (JSON.parse(read(COLLAPSED_KEY) ?? "[]") as TrackerColumnKey[]).filter((k) => typeof k === "string");
    } catch {
      return [];
    }
  });
  const [dense, setDense] = useState(() => read(DENSE_KEY) === "1");
  const toggleCollapsed = (k: TrackerColumnKey) =>
    setCollapsed((c) => {
      const next = c.includes(k) ? c.filter((x) => x !== k) : [...c, k];
      write(COLLAPSED_KEY, JSON.stringify(next));
      return next;
    });
  const from = drag ? columnOf(drag.statusId, colOf) : null;
  // куда можно перенести карточку — таблица переходов lib/tracker.ts (dropTargets); остальное объясняет dropBlockReason
  const targets = (r: TRow) => dropTargets(columnOf(r.statusId, colOf), director);

  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-1 text-[12px] text-on-surface-variant">
        <span>Карточки:</span>
        {[
          { v: false, label: "Обычные" },
          { v: true, label: "Компактные" },
        ].map((o) => (
          <button
            key={o.label}
            aria-pressed={dense === o.v}
            onClick={() => {
              setDense(o.v);
              write(DENSE_KEY, o.v ? "1" : "0");
            }}
            className={`rounded-full px-2.5 py-0.5 font-semibold ${dense === o.v ? "bg-primary-soft text-primary" : "hover:bg-surface-high"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="flex h-[max(28rem,calc(100dvh-17rem))] gap-3 overflow-x-auto pb-2 max-md:snap-x max-md:snap-mandatory">
        {columns.map((c) => {
          const items = rows.filter((r) => columnOf(r.statusId, colOf) === c.key);
          const droppable = !!drag && targets(drag).includes(c.key);
          const blocked = !!drag && !droppable && from !== c.key ? dropBlockReason(from!, c.key, director) : null;
          const isCollapsed = collapsed.includes(c.key);
          const accent = ACCENT[c.key];
          const dropProps = {
            onDragOver: (e: DragEvent) => {
              if (!droppable) return;
              e.preventDefault();
              setOver(c.key);
            },
            onDragLeave: () => setOver((o) => (o === c.key ? null : o)),
            onDrop: (e: DragEvent) => {
              e.preventDefault();
              setOver(null);
              if (drag && droppable) onMove(drag, c.key);
              setDrag(null);
            },
          };
          const frame = `rounded-lg border border-t-4 bg-surface-low transition-colors ${over === c.key ? "border-primary bg-primary-soft" : "border-outline-variant"} ${blocked ? "opacity-50" : ""}`;
          if (isCollapsed)
            return (
              <section key={c.key} aria-label={`${c.label} (свёрнуто)`} {...dropProps} className={`flex w-11 shrink-0 flex-col items-center gap-2 py-2 max-md:snap-start ${frame}`} style={{ borderTopColor: accent }}>
                <button onClick={() => toggleCollapsed(c.key)} aria-label={`Развернуть колонку «${c.label}»`} title="Развернуть колонку" className="flex h-7 w-7 items-center justify-center rounded-md text-outline hover:bg-surface-high hover:text-on-surface">
                  <ChevronsRight size={16} />
                </button>
                <span className="rounded-full bg-surface-high px-2 text-[11px] font-semibold text-on-surface-variant">{items.length}</span>
                <span className="text-[13px] font-bold text-on-surface [writing-mode:vertical-rl]">{c.label}</span>
              </section>
            );
          return (
            <section key={c.key} aria-label={c.label} {...dropProps} className={`flex min-h-0 min-w-64 flex-1 basis-0 flex-col p-2 max-md:w-[85%] max-md:flex-none max-md:snap-start ${frame}`} style={{ borderTopColor: accent }}>
              <header className="mb-2 flex items-center justify-between gap-2 px-1">
                <span className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-on-surface">{c.label}</span>
                  <span className="rounded-full bg-surface-high px-2 text-[11px] font-semibold text-on-surface-variant">{items.length}</span>
                </span>
                <button onClick={() => toggleCollapsed(c.key)} aria-label={`Свернуть колонку «${c.label}»`} title="Свернуть колонку" className="flex h-6 w-6 items-center justify-center rounded-md text-outline hover:bg-surface-high hover:text-on-surface max-md:hidden">
                  <ChevronsLeft size={14} />
                </button>
              </header>
              {blocked && <p className="mb-2 rounded-md border border-dashed border-outline px-2 py-1.5 text-center text-[11px] text-on-surface-variant">{blocked}</p>}
              {c.key === "DONE" && !director && !drag && <p className="mb-2 px-1 text-[11px] text-outline">Сюда задачу переносит директор — переведите её в «На проверке».</p>}
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
                {items.map((r) => (
                  <Card
                    key={r.id}
                    r={r}
                    col={c.key}
                    dense={dense}
                    ghost={drag?.id === r.id}
                    colors={colors}
                    hot={hot[r.id]}
                    summary={summaries.get(r.id)}
                    mainStatus={mainStatus}
                    unconfirmed={unconfirmed?.(r)}
                    deletedInfo={deletedInfo?.(r)}
                    today={today}
                    closedAt={c.key === "DONE" ? doneAt(r) : null}
                    draggable={canMove(r) && targets(r).length > 0}
                    onDragStart={() => setDrag(r)}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                    onOpen={onOpen}
                    onMenu={onMenu}
                  />
                ))}
                {droppable && <div className="rounded-md border-2 border-dashed px-3 py-4 text-center text-[12px] font-semibold" style={{ borderColor: accent, color: accent }}>Перенести сюда</div>}
                {items.length === 0 && !droppable && <p className="px-2 py-6 text-center text-[12px] text-outline">{EMPTY[c.key]}</p>}
              </div>
              {c.key === "TODO" && onQuickAdd && !drag && <QuickAdd onAdd={onQuickAdd} />}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** «+ Задача» внизу «Сделать»: одно название — Enter создаёт, Esc отменяет; остальное доводят в карточке. */
function QuickAdd({ onAdd }: { onAdd: (title: string) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    const err = await onAdd(t);
    setBusy(false);
    if (err) return setError(err);
    setTitle("");
  }
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="mt-2 flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-high">
        <Plus size={14} /> Задача
      </button>
    );
  return (
    <div className="mt-2 space-y-1">
      <textarea
        autoFocus
        rows={2}
        maxLength={300}
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape") {
            setOpen(false);
            setTitle("");
            setError(null);
          }
        }}
        placeholder="Что нужно сделать? Enter — создать, Esc — отмена"
        className="input w-full text-[13px]"
      />
      {error && <p className="text-[11px] text-status-red">{error}</p>}
    </div>
  );
}

function Card({ r, col, dense, ghost, colors, hot, summary, mainStatus, unconfirmed, deletedInfo, today, closedAt, draggable, onDragStart, onDragEnd, onOpen, onMenu }: {
  r: TRow;
  col: TrackerColumnKey;
  dense: boolean;
  ghost: boolean;
  colors: Map<string, string>;
  hot?: HotInfo;
  summary?: TaskSummary;
  mainStatus: Map<TrackerColumnKey, string | null>;
  unconfirmed?: boolean;
  deletedInfo?: string;
  today: number;
  closedAt: string | null;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: (r: TRow) => void;
  onMenu?: Props["onMenu"];
}) {
  const files = r.files?.length ?? 0;
  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(r)}
      onContextMenu={(e) => onMenu?.(r, e)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(r)}
      tabIndex={0}
      role="button"
      aria-label={`Задача: ${r.name}`}
      className={`surface group relative shrink-0 cursor-pointer border-l-4 outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary ${dense ? "px-3 py-2" : "p-3"} ${ghost ? "border-dashed opacity-40" : ""} ${deletedInfo || col === "HIDDEN" ? "opacity-75" : ""}`}
      style={{ borderLeftColor: colors.get(r.segmentId ?? "none") ?? "#94a3b8" }}
    >
      <MenuButton row={r} onMenu={onMenu} className="absolute right-1.5 top-1.5" />
      {!dense && <div className="truncate pr-7 text-[11px] text-outline">{[r.segmentName, r.trackName].filter(Boolean).join(" · ") || "Без сегмента"}</div>}
      <div className={`font-medium text-on-surface [overflow-wrap:anywhere] ${dense ? "line-clamp-2 pr-7 text-[13px]" : "mt-0.5 line-clamp-3 text-[13px]"}`}>{r.name}</div>
      {r.statusName && r.statusId !== mainStatus.get(col) && (
        <div className="mt-1.5">
          <StatusPill name={r.statusName} color={r.statusColor} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        <Marks row={r} hot={hot} summary={summary} done={col === "DONE"} cancelled={col === "HIDDEN"} unconfirmed={unconfirmed} deletedInfo={deletedInfo} max={dense ? 2 : 3} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
        <span className="flex min-w-0 items-center gap-2 text-outline">
          {files > 0 && !dense && (
            <span className="inline-flex items-center gap-0.5" title={`Файлов (ссылок): ${files}`}>
              <Paperclip size={12} /> {files}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5" title={r.ownerName ? `Ответственный: ${r.ownerName}` : "Ответственный не назначен"}>
            {r.ownerName ? <PersonAvatar name={r.ownerName} size={22} /> : <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border border-dashed border-outline text-[11px]">?</span>}
            {!dense && <span className="max-w-24 truncate text-on-surface-variant">{r.ownerName?.split(" ")[0] ?? "не назначен"}</span>}
          </span>
        </span>
        <Deadline row={r} col={col} today={today} closedAt={closedAt} chip />
      </div>
    </article>
  );
}
