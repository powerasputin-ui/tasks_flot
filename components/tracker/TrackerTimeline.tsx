"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { columnOf, ruDay, timelineRange, type TrackerColumnKey, type TrackerEvent, type TrackerEventKind } from "@/lib/tracker";
import { overdue, type TRow } from "@/components/tracker/TrackerView";

const DAY = 24 * 3600 * 1000;
const PX_DAY = 14; // минимальная ширина дня (неделя ≈ 100 px); на широком экране шкала растягивается на всю ширину
const NAME_W = 300;

/** Цвет точки по виду события; сдвиг срока позже — красный. */
const KIND_COLOR: Record<TrackerEventKind, string> = {
  created: "#64748b",
  status: "#2563eb",
  deadline: "#d97706",
  text: "#94a3b8",
  files: "#94a3b8",
  edit: "#94a3b8",
  owner: "#7c3aed",
  submitted: "#0059a5",
  unsubmitted: "#94a3b8",
  memo: "#16a34a",
  archived: "#dc2626",
  restored: "#16a34a",
};
const LEGEND: Array<[string, string]> = [
  ["создана", KIND_COLOR.created],
  ["статус", KIND_COLOR.status],
  ["срок", KIND_COLOR.deadline],
  ["срок сдвинули позже", "#dc2626"],
  ["подана в справку", KIND_COLOR.submitted],
  ["в отправленной справке", KIND_COLOR.memo],
  ["правка текста", KIND_COLOR.text],
];

/**
 * Таймлайн: строка = задача (сегмент → трек), ось — недели, линия «сегодня», ромб — текущий срок.
 * Точка — день, когда с задачей что-то произошло (несколько событий за день — одна точка с числом); подсказка — что и кто.
 */
export function TrackerTimeline({ rows, colOf, hot, events, colors, onOpen }: { rows: TRow[]; colOf: Map<string, TrackerColumnKey | null>; hot: Record<string, string[]>; events: Map<string, TrackerEvent[]>; colors: Map<string, string>; onOpen: (r: TRow) => void }) {
  const [now] = useState(() => Date.now()); // «сегодня» — на момент открытия страницы
  const range = useMemo(() => timelineRange([...rows.flatMap((r) => (events.get(r.id) ?? []).map((e) => e.at)), ...rows.map((r) => r.deadline)]), [rows, events]);
  // ширина блока: шкала занимает всё место справа от названий, но не уже PX_DAY на день (тогда — прокрутка)
  const box = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setBoxW(el.clientWidth);
    measure(); // сразу, не дожидаясь первой отрисовки
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const days = Math.round((range.to - range.from) / DAY);
  const pxDay = Math.max(PX_DAY, (boxW - NAME_W) / days);
  const width = Math.floor(days * pxDay);
  const x = (d: string | number | Date) => Math.round(((new Date(d).getTime() - range.from) / DAY) * pxDay);
  const weeks: number[] = [];
  for (let t = range.from; t < range.to; t += 7 * DAY) weeks.push(t);
  const today = x(now);

  // группы сегмент → трек (порядок как в списке)
  const groups = useMemo(() => {
    const out: Array<{ head: string; color: string; rows: TRow[] }> = [];
    for (const r of rows) {
      const head = [r.segmentName ?? "Без сегмента", r.trackName].filter(Boolean).join(" · ");
      const g = out.find((o) => o.head === head);
      if (g) g.rows.push(r);
      else out.push({ head, color: colors.get(r.segmentId ?? "none") ?? "#94a3b8", rows: [r] });
    }
    return out;
  }, [rows, colors]);

  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-outline-variant px-4 py-2 text-[11px] text-on-surface-variant">
        {LEGEND.map(([label, c]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} /> {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rotate-45 border-2 border-on-surface bg-surface" /> текущий срок
        </span>
      </div>
      <div ref={box} className="overflow-x-auto">
        <div className="relative" style={{ width: NAME_W + width }}>
          {/* шкала недель */}
          <div className="sticky top-0 z-10 flex border-b border-outline-variant bg-surface-low">
            <div className="sticky left-0 z-20 shrink-0 border-r border-outline-variant bg-surface-low px-4 py-2 label-caps" style={{ width: NAME_W }}>
              Задача
            </div>
            <div className="relative h-8" style={{ width }}>
              {weeks.map((w) => (
                <span key={w} className="absolute top-2 border-l border-outline-variant pl-1 text-[11px] text-outline" style={{ left: x(w) }}>
                  {new Date(w).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}
                </span>
              ))}
            </div>
          </div>
          {groups.map((g) => (
            <div key={g.head}>
              <div className="sticky left-0 border-b border-l-4 border-outline-variant bg-surface-low px-4 py-1.5 text-[12px] font-bold text-on-surface" style={{ borderLeftColor: g.color, width: NAME_W + width }}>
                {g.head}
              </div>
              {g.rows.map((r) => (
                <TimelineRow key={r.id} row={r} col={columnOf(r.statusId, colOf)} hot={hot[r.id]} events={events.get(r.id) ?? []} x={x} width={width} weeks={weeks} today={today} onOpen={onOpen} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimelineRow({ row, col, hot, events, x, width, weeks, today, onOpen }: { row: TRow; col: TrackerColumnKey; hot?: string[]; events: TrackerEvent[]; x: (d: string | number | Date) => number; width: number; weeks: number[]; today: number; onOpen: (r: TRow) => void }) {
  // события одного дня — одна точка
  const days = new Map<string, TrackerEvent[]>();
  for (const e of events) {
    const k = new Date(e.at).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
    days.set(k, [...(days.get(k) ?? []), e]);
  }
  const start = events.length ? x(events[0].at) : null;
  const dl = row.deadline ? x(row.deadline) : null;
  const end = Math.max(today, dl ?? 0);
  const late = overdue(row, col);
  return (
    <div className="flex border-b border-outline-variant/50 hover:bg-surface-low">
      <button onClick={() => onOpen(row)} className="sticky left-0 z-[5] shrink-0 border-r border-outline-variant bg-surface px-4 py-2 text-left hover:bg-surface-low" style={{ width: NAME_W }} title={row.name}>
        <span className="line-clamp-2 text-[12px] leading-4 text-on-surface">
          {hot && <span className="mr-1 font-bold text-status-red" title={hot.join("; ")}>●</span>}
          {row.name}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-outline">
          {row.ownerName ?? "не назначен"} · {row.statusName ?? "без статуса"}
        </span>
      </button>
      <div className="relative" style={{ width, minHeight: 48 }}>
        {weeks.map((w) => (
          <span key={w} className="absolute inset-y-0 border-l border-outline-variant/40" style={{ left: x(w) }} />
        ))}
        <span className="absolute inset-y-0 w-0.5 bg-primary/60" style={{ left: today }} title="Сегодня" />
        {start !== null && <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-highest" style={{ left: start, width: Math.max(4, end - start) }} />}
        {dl !== null && (
          <span
            className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 ${late ? "border-status-red bg-status-red/20" : "border-on-surface bg-surface"}`}
            style={{ left: dl }}
            title={`Срок ${ruDay(row.deadline!)}${late ? " — просрочено" : ""}`}
          />
        )}
        {[...days].map(([day, evs]) => {
          const slip = evs.some((e) => e.slip);
          const main = evs.find((e) => e.kind === "status") ?? evs.find((e) => e.kind === "deadline") ?? evs.find((e) => e.kind === "memo") ?? evs[0];
          const color = slip ? "#dc2626" : KIND_COLOR[main.kind];
          return (
            <button
              key={day}
              onClick={() => onOpen(row)}
              className="absolute top-1/2 flex h-4 min-w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white ring-2 ring-surface"
              style={{ left: x(evs[0].at), background: color }}
              title={`${day}\n${evs.map((e) => `• ${e.text}${e.who ? ` — ${e.who}` : ""}`).join("\n")}`}
              aria-label={`${day}: ${evs.map((e) => e.text).join("; ")}`}
            >
              {evs.length > 1 ? evs.length : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
