"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Check, X } from "lucide-react";
import { columnOf, phasesOf, ruDay, timelineRange, type HotInfo, type TrackerColumnKey, type TrackerEvent, type TrackerEventKind } from "@/lib/tracker";
import { overdue, type TRow } from "@/components/tracker/TrackerView";
import { AnchoredCard } from "@/components/ui/Tooltip";
import { useIsMobile } from "@/lib/use-mobile";

const DAY = 24 * 3600 * 1000;
/** Сроки и «сегодня» — по Москве: ось считается в московском времени (сдвиг +3 ч от UTC). */
const MSK = 3 * 3600 * 1000;
const shift = (d: string | number | Date) => new Date(d).getTime() + MSK;
const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;
/** Срок хранится датой (полночь UTC) — это и есть его день. */
const dateDay = (d: string | Date) => dayStart(new Date(d).getTime());

type Zoom = "fit" | "day" | "week" | "month";
const ZOOMS: Array<[Zoom, string]> = [["fit", "Вписать"], ["day", "Дни"], ["week", "Недели"], ["month", "Месяцы"]];
const ZOOM_PX: Record<Exclude<Zoom, "fit">, number> = { day: 48, week: 16, month: 5 };
const ZOOM_KEY = "tracker.timeline.zoom";
const H_MONTH = 22;
const H_WEEK = 22;
const H_DAY = 20;
const CLUSTER_PX = 14;

/** Цвет точки по виду события; сдвиг срока позже — красный. */
const KIND_COLOR: Record<TrackerEventKind, string> = {
  created: "#64748b",
  status: "#2563eb",
  deadline: "#d97706",
  text: "#94a3b8",
  files: "#94a3b8",
  edit: "#94a3b8",
  owner: "#7c3aed",
  submitted: "#0891b2",
  unsubmitted: "#94a3b8",
  memo: "#16a34a",
  archived: "#dc2626",
  restored: "#16a34a",
  workflow: "#7c3aed",
};
/** Фаза задачи (в каком статусе была) — цвет полосы. */
const PHASE_COLOR: Record<TrackerColumnKey, string> = { TODO: "#cbd5e1", DOING: "#60a5fa", REVIEW: "#f59e0b", DONE: "#22c55e", HIDDEN: "#e2e8f0" };
const STOP_BG = "repeating-linear-gradient(135deg, #dc2626 0 3px, #fecaca 3px 6px)";
const PHASE_LABEL: Record<TrackerColumnKey, string> = { TODO: "Сделать", DOING: "В работе", REVIEW: "На проверке", DONE: "Выполнено", HIDDEN: "Не показывать" };
const RANK: TrackerEventKind[] = ["workflow", "status", "deadline", "memo", "owner", "submitted", "created"];

const ru = (ms: number, o: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString("ru-RU", { ...o, timeZone: "UTC" });
const dm = (ms: number) => ru(ms, { day: "2-digit", month: "2-digit" });
const timeMsk = (d: string) => new Date(d).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
const daysWord = (n: number) => `${n} дн.`;

/** ISO-неделя дня (день — полночь «московского» времени в UTC-представлении). */
function isoWeek(ms: number): number {
  const d = dayStart(ms);
  const dow = (new Date(d).getUTCDay() + 6) % 7;
  const thursday = d + (3 - dow) * DAY;
  const y = new Date(thursday).getUTCFullYear();
  return Math.floor((thursday - Date.UTC(y, 0, 1)) / (7 * DAY)) + 1;
}

type Cluster = { x: number; groups: Array<[number, TrackerEvent[]]>; color: string; count: number };
type CardState = { row: TRow; groups: Array<[number, TrackerEvent[]]>; rect: DOMRect; pinned: boolean };

/**
 * Таймлайн: строка = задача (сегмент → трек). Ось по Москве: месяцы, недели (номер и даты), дни (при крупном масштабе).
 * Полоса — в каком статусе задача была (Сделать / В работе / На проверке / На стопе), у закрытой обрывается в день
 * закрытия; ромб — текущий срок, полый — исходный; после «сегодня» до срока — пунктир (план), просрочка — красным.
 * Точка — события дня (близкие дни склеиваются, число — сколько событий); подсказка — что, когда (время) и кто.
 */
export function TrackerTimeline({ rows, colOf, statusColumns, hot, events, colors, onOpen, onMenu }: { rows: TRow[]; colOf: Map<string, TrackerColumnKey | null>; statusColumns: Map<string, TrackerColumnKey | null>; hot: Record<string, HotInfo>; events: Map<string, TrackerEvent[]>; colors: Map<string, string>; onOpen: (r: TRow, tab?: "details" | "history") => void; onMenu?: (r: TRow, e: { clientX: number; clientY: number; preventDefault: () => void }) => void }) {
  const mobile = useIsMobile();
  const nameW = mobile ? 150 : 300;
  const [now] = useState(() => Date.now()); // «сегодня» — на момент открытия страницы
  const nowS = now + MSK;
  const range = useMemo(
    () => timelineRange([...rows.flatMap((r) => (events.get(r.id) ?? []).map((e) => new Date(shift(e.at)))), ...rows.flatMap((r) => [r.deadline, r.originalDeadline])], new Date(nowS)),
    [rows, events, nowS],
  );
  const [zoom, setZoomState] = useState<Zoom>(() => {
    try {
      const z = typeof window !== "undefined" ? window.localStorage.getItem(ZOOM_KEY) : null;
      return ZOOMS.some(([k]) => k === z) ? (z as Zoom) : "fit";
    } catch {
      return "fit";
    }
  });
  const setZoom = (z: Zoom) => {
    setZoomState(z);
    try {
      window.localStorage.setItem(ZOOM_KEY, z);
    } catch {
      /* без сохранения — не страшно */
    }
  };

  // ширина блока: «Вписать» — шкала на всё место справа от названий; остальные масштабы — фиксированные, с прокруткой
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
  const dataDays = Math.max(1, Math.round((range.to - range.from) / DAY));
  const pxDay = zoom === "fit" ? Math.max(4, (boxW - nameW) / dataDays) : ZOOM_PX[zoom];
  // шкала всегда на всю ширину: при крупном масштабе и коротком периоде она продлевается вправо до края экрана
  const days = zoom === "fit" ? dataDays : Math.max(dataDays, Math.ceil(Math.max(0, boxW - nameW) / pxDay));
  const rangeTo = range.from + days * DAY;
  const width = Math.ceil(days * pxDay);
  // за пределы шкалы (дата-выброс) метка не уезжает: упирается в край
  const xs = (ms: number) => Math.max(-20, Math.min(width + 20, ((ms - range.from) / DAY) * pxDay)); // ms — московское время
  const xEv = (d: string | number | Date) => xs(shift(d));
  const xDay = (d: string | Date) => xs(dateDay(d) + DAY / 2);
  const today = xs(nowS);
  const showDays = pxDay >= 16;
  const headerH = H_MONTH + H_WEEK + (showDays ? H_DAY : 0);

  const scrollToToday = () => {
    const el = box.current;
    if (el) el.scrollLeft = Math.max(0, today - (el.clientWidth - nameW) / 2);
  };
  useEffect(() => {
    if (zoom !== "fit") scrollToToday();
    // прокрутка к «сегодня» — при смене масштаба и когда стало известно, телефон ли это (меняется ширина названий)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, mobile]);
  const [legend, setLegend] = useState(false);

  const months = useMemo(() => {
    const out: Array<{ from: number; to: number; label: string }> = [];
    const f = new Date(range.from);
    let m = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1);
    while (m < rangeTo) {
      const d = new Date(m);
      const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      out.push({ from: Math.max(m, range.from), to: Math.min(next, rangeTo), label: `${ru(m, { month: "long" })} ${d.getUTCFullYear()}` });
      m = next;
    }
    return out;
  }, [range, rangeTo]);
  const weeks = useMemo(() => {
    const out: number[] = [];
    for (let t = range.from; t < rangeTo; t += 7 * DAY) out.push(t);
    return out;
  }, [range, rangeTo]);
  const dayList = useMemo(() => {
    const out: number[] = [];
    for (let t = range.from; t < rangeTo; t += DAY) out.push(t);
    return out;
  }, [range, rangeTo]);

  // курсор над шкалой: вертикаль и дата под ним
  const [hover, setHover] = useState<number | null>(null);
  // подпись месяца держится у левого края, пока его дни видны (иначе при прокрутке ярус месяцев пустеет)
  const [scrollX, setScrollX] = useState(0);
  const onMove = (e: ReactMouseEvent) => {
    const el = box.current;
    if (!el || mobile) return;
    const cx = e.clientX - el.getBoundingClientRect().left + el.scrollLeft - nameW;
    setHover(cx >= 0 && cx <= width ? cx : null);
  };
  const hoverMs = hover !== null ? range.from + (hover / pxDay) * DAY : null;

  // карточка события: по наведению на ПК, по тапу (закреплённая) на телефоне
  const [card, setCard] = useState<CardState | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepCard = () => hideTimer.current && clearTimeout(hideTimer.current);
  const dropCard = () => {
    keepCard();
    hideTimer.current = setTimeout(() => setCard((c) => (c?.pinned ? c : null)), 150);
  };

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
    // overflow-clip, а не hidden: hidden сделал бы блок контейнером прокрутки и шапка шкалы перестала бы прилипать
    <div className="surface overflow-clip">
      <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant px-3 py-2">
        <div className="flex rounded-md border border-outline-variant bg-surface p-0.5 text-[12px]" aria-label="Масштаб">
          {ZOOMS.map(([k, label]) => (
            <button key={k} onClick={() => setZoom(k)} aria-pressed={zoom === k} className={`rounded px-2.5 py-1 font-semibold ${zoom === k ? "bg-primary-soft text-primary" : "text-on-surface-variant"}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={scrollToToday} className="btn-ghost h-8 text-[12px]">
          Сегодня
        </button>
        {/* на телефоне обозначения по кнопке — иначе они занимают полэкрана */}
        {mobile && (
          <button onClick={() => setLegend((v) => !v)} aria-expanded={legend} className="btn-ghost h-8 text-[12px]">
            Обозначения
          </button>
        )}
        {(!mobile || legend) && <Legend />}
      </div>
      {/* шкала: месяцы → недели → дни. Вне прокручиваемой области (прилипает к верху страницы, вертикальная прокрутка
          одна — у страницы), по горизонтали сдвигается вместе со строками */}
      <div className="sticky top-0 z-20 flex border-b border-outline-variant bg-surface-low">
        <div className="z-30 flex shrink-0 items-end border-r border-outline-variant bg-surface-low px-4 pb-1.5 label-caps" style={{ width: nameW, height: headerH }}>
          Задача
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden" style={{ height: headerH }}>
            <div className="absolute inset-y-0 left-0" style={{ width, transform: `translateX(${-scrollX}px)` }}>
              {months.map((m) => (
                <span key={m.from} className="absolute top-0 overflow-hidden whitespace-nowrap border-l border-outline-variant px-1.5 text-[11px] font-semibold leading-[22px] text-on-surface" style={{ left: xs(m.from), width: xs(m.to) - xs(m.from), height: H_MONTH }}>
                  <span style={{ marginLeft: Math.max(0, Math.min(scrollX - xs(m.from), xs(m.to) - xs(m.from) - 120)) }}>{xs(m.to) - xs(m.from) > 70 ? m.label : ru(m.from, { month: "short" })}</span>
                </span>
              ))}
              {weeks.map((w) => {
                const wpx = 7 * pxDay;
                const label = wpx >= 110 ? `нед. ${isoWeek(w)} · ${dm(w)}–${dm(w + 6 * DAY)}` : wpx >= 56 ? `нед. ${isoWeek(w)}` : wpx >= 24 ? String(isoWeek(w)) : "";
                return (
                  <span key={w} className="absolute overflow-hidden whitespace-nowrap border-l border-t border-outline-variant/70 px-1 text-[11px] leading-[22px] text-on-surface-variant" style={{ top: H_MONTH, left: xs(w), width: wpx, height: H_WEEK }} title={`Неделя ${isoWeek(w)}: ${ru(w, { day: "2-digit", month: "2-digit", year: "numeric" })} – ${ru(w + 6 * DAY, { day: "2-digit", month: "2-digit", year: "numeric" })}`}>
                    {label}
                  </span>
                );
              })}
              {showDays &&
                dayList.map((d) => {
                  const wd = new Date(d).getUTCDay();
                  return (
                    <span key={d} className={`absolute border-l border-t border-outline-variant/40 text-center text-[10px] leading-[20px] ${wd === 0 || wd === 6 ? "bg-surface-high/70 text-outline" : "text-on-surface-variant"}`} style={{ top: H_MONTH + H_WEEK, left: xs(d), width: pxDay, height: H_DAY }}>
                      {pxDay >= 40 ? `${ru(d, { weekday: "short" })} ${new Date(d).getUTCDate()}` : new Date(d).getUTCDate()}
                    </span>
                  );
                })}
              <span className="absolute bottom-0.5 z-[1] -translate-x-1/2 whitespace-nowrap rounded-sm bg-primary px-1.5 text-[10px] font-semibold leading-4 text-white" style={{ left: today }}>
                сегодня {dm(nowS)}
              </span>
              {hoverMs !== null && (
                <span className="pointer-events-none absolute top-0.5 z-[2] -translate-x-1/2 whitespace-nowrap rounded-sm border border-outline-variant bg-surface px-1.5 text-[10px] font-semibold leading-4 text-on-surface shadow-sm" style={{ left: hover! }}>
                  {ru(hoverMs, { weekday: "short", day: "2-digit", month: "2-digit" })}
                  {pxDay >= 40 ? ` ${new Date(hoverMs).toISOString().slice(11, 16)}` : ""}
                </span>
              )}
            </div>
        </div>
      </div>
      <div ref={box} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)} className="overflow-x-auto">
        <div className="relative" style={{ width: nameW + width }}>
          {/* сетка поверх строк: выходные, недели, сегодня, курсор */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-[1]" style={{ left: nameW, width }}>
            {pxDay >= 8 &&
              dayList
                .filter((d) => [0, 6].includes(new Date(d).getUTCDay()))
                .map((d) => <span key={d} className="absolute inset-y-0 bg-surface-high/40" style={{ left: xs(d), width: pxDay }} />)}
            {weeks.map((w) => (
              <span key={w} className="absolute inset-y-0 border-l border-outline-variant/50" style={{ left: xs(w) }} />
            ))}
            <span className="absolute inset-y-0 w-0.5 bg-primary/60" style={{ left: today }} />
            {hover !== null && <span className="absolute inset-y-0 border-l border-dashed border-on-surface-variant/50" style={{ left: hover }} />}
          </div>

          {groups.map((g) => (
            <div key={g.head}>
              <div className="relative z-[2] border-b border-l-4 border-outline-variant bg-surface-low" style={{ borderLeftColor: g.color, width: nameW + width }}>
                <span className="sticky left-0 inline-block px-4 py-1.5 text-[12px] font-bold text-on-surface">{g.head}</span>
              </div>
              {g.rows.map((r) => (
                <TimelineRow
                  key={r.id}
                  row={r}
                  col={columnOf(r.statusId, colOf)}
                  statusColumns={statusColumns}
                  hot={hot[r.id]}
                  events={events.get(r.id) ?? []}
                  xs={xs}
                  xEv={xEv}
                  xDay={xDay}
                  pxDay={pxDay}
                  width={width}
                  today={today}
                  now={now}
                  nameW={nameW}
                  onOpen={onOpen}
                  onMenu={onMenu}
                  onPoint={(groups, rect, pinned) => {
                    keepCard();
                    setCard({ row: r, groups, rect, pinned });
                  }}
                  onPointLeave={dropCard}
                  mobile={mobile}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {card && (
        <AnchoredCard rect={card.rect} pinned={card.pinned} onEnter={keepCard} onLeave={card.pinned ? undefined : dropCard} onClose={() => setCard(null)}>
          <EventCard state={card} onOpen={() => { const r = card.row; setCard(null); onOpen(r, "history"); }} />
        </AnchoredCard>
      )}
    </div>
  );
}

function Legend() {
  const dot = (c: string) => <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c }} />;
  const bar = (bg: string) => <span className="h-1.5 w-5 shrink-0 rounded-sm" style={{ background: bg }} />;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-on-surface-variant">
      <span className="flex items-center gap-1.5">{bar(PHASE_COLOR.TODO)} сделать</span>
      <span className="flex items-center gap-1.5">{bar(PHASE_COLOR.DOING)} в работе</span>
      <span className="flex items-center gap-1.5">{bar(PHASE_COLOR.REVIEW)} на проверке</span>
      <span className="flex items-center gap-1.5">{bar(STOP_BG)} на стопе</span>
      <span className="flex items-center gap-1.5">
        <span className="h-0 w-5 border-t-2 border-dashed border-outline" /> план до срока
      </span>
      <span className="flex items-center gap-1.5">{bar("#dc2626")} просрочка</span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rotate-45 border-2 border-on-surface bg-surface" /> срок
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rotate-45 border-2 border-dashed border-outline bg-surface" /> исходный срок
      </span>
      <span className="flex items-center gap-1.5">{dot(KIND_COLOR.workflow)} сдача / приёмка / стоп</span>
      <span className="flex items-center gap-1.5">{dot(KIND_COLOR.status)} статус</span>
      <span className="flex items-center gap-1.5">{dot(KIND_COLOR.deadline)} срок</span>
      <span className="flex items-center gap-1.5">{dot("#dc2626")} срок позже</span>
      <span className="flex items-center gap-1.5">{dot(KIND_COLOR.memo)} справка</span>
    </div>
  );
}

/** Подсказка точки: по дням — время, что произошло, кто. */
function EventCard({ state, onOpen }: { state: CardState; onOpen: () => void }) {
  const who = (e: TrackerEvent) => (e.who && !(e.who.startsWith("справка от") && /справк/.test(e.text)) ? e.who : null);
  return (
    <div>
      <p className="line-clamp-2 font-semibold text-on-surface">{state.row.name}</p>
      {state.groups.map(([day, evs]) => (
        <div key={day} className="mt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">{ru(day, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}</p>
          <ul className="mt-1 space-y-1">
            {evs.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: e.slip ? "#dc2626" : KIND_COLOR[e.kind] }} />
                <span className="shrink-0 tabular-nums text-outline">{timeMsk(e.at)}</span>
                <span className="min-w-0 flex-1 text-on-surface [overflow-wrap:anywhere]">
                  {e.text}
                  {who(e) && <span className="text-on-surface-variant"> — {who(e)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {state.pinned ? (
        <button onClick={onOpen} className="btn-primary mt-3 h-8 w-full justify-center text-[12px]">
          Открыть историю задачи
        </button>
      ) : (
        <p className="mt-2 text-[11px] text-outline">Нажмите на точку — откроется история задачи</p>
      )}
    </div>
  );
}

function TimelineRow({
  row, col, statusColumns, hot, events, xs, xEv, xDay, pxDay, width, today, now, nameW, onOpen, onMenu, onPoint, onPointLeave, mobile,
}: {
  row: TRow;
  col: TrackerColumnKey;
  statusColumns: Map<string, TrackerColumnKey | null>;
  hot?: HotInfo;
  events: TrackerEvent[];
  xs: (ms: number) => number;
  xEv: (d: string | number | Date) => number;
  xDay: (d: string | Date) => number;
  pxDay: number;
  width: number;
  today: number;
  now: number;
  nameW: number;
  onOpen: (r: TRow, tab?: "details" | "history") => void;
  onMenu?: (r: TRow, e: { clientX: number; clientY: number; preventDefault: () => void }) => void;
  onPoint: (groups: Array<[number, TrackerEvent[]]>, rect: DOMRect, pinned: boolean) => void;
  onPointLeave: () => void;
  mobile: boolean;
}) {
  // граница известной истории (справка «с неё известна история» / журнал начался позже задачи) — не точка «создана»
  const first = events[0];
  const historyMark = first && (first.kind !== "created" || /известна история/.test(first.text)) ? first : null;
  const pointEvents = historyMark?.kind === "created" ? events.slice(1) : events;
  const { phases, closedAt } = phasesOf(events, { status: row.statusName, column: col }, (name) => (name ? statusColumns.get(name) : null) ?? "TODO", now);
  const open = col !== "DONE" && col !== "HIDDEN";
  const dl = row.deadline ? xDay(row.deadline) : null;
  const late = overdue(row, col);
  const orig = row.originalDeadline && row.deadline && dateDay(row.originalDeadline) !== dateDay(row.deadline) ? xDay(row.originalDeadline) : null;
  const slips = events.filter((e) => e.slip);

  // точки: события одного дня — одна точка; соседние ближе CLUSTER_PX — одна точка с числом
  const clusters = (() => {
    const byDay = new Map<number, TrackerEvent[]>();
    for (const e of pointEvents) {
      const k = dayStart(shift(e.at));
      byDay.set(k, [...(byDay.get(k) ?? []), e]);
    }
    const out: Cluster[] = [];
    for (const [day, evs] of [...byDay].sort((a, b) => a[0] - b[0])) {
      const x = pxDay >= 30 ? xEv(evs[0].at) : xs(day + DAY / 2);
      const last = out[out.length - 1];
      if (last && x - last.x < CLUSTER_PX) {
        last.groups.push([day, evs]);
        last.x = (last.x * (last.groups.length - 1) + x) / last.groups.length;
      } else out.push({ x, groups: [[day, evs]], color: "", count: 0 });
    }
    for (const c of out) {
      const all = c.groups.flatMap(([, e]) => e);
      const main = RANK.map((k) => all.find((e) => e.kind === k)).find(Boolean) ?? all[0];
      // приёмка — зелёным (задача закрыта), отмена — серым; сдвиг срока позже — красным
      c.color = all.some((e) => e.slip) ? "#dc2626" : main.kind === "workflow" && /^принят/.test(main.text) ? "#16a34a" : main.kind === "workflow" && /^отмен/.test(main.text) ? "#94a3b8" : KIND_COLOR[main.kind];
      c.count = all.length;
    }
    return out;
  })();

  const dlTip = row.deadline
    ? `Срок ${ruDay(row.deadline)}${late ? " — просрочено" : ""}${orig !== null ? `\nИсходный срок ${ruDay(row.originalDeadline!)}` : ""}${slips.length ? `\nСрок переносили позже ${slips.length}× (+${slips.reduce((s, e) => s + (e.slip ?? 0), 0)} дн.)` : ""}`
    : "";

  return (
    <div className="flex border-b border-outline-variant/50 hover:bg-surface-low">
      <button onClick={() => onOpen(row)} onContextMenu={(e) => onMenu?.(row, e)} className="sticky left-0 z-[5] shrink-0 border-r border-outline-variant bg-surface px-3 py-2 text-left hover:bg-surface-low md:px-4" style={{ width: nameW }} title={row.name}>
        <span className="line-clamp-2 text-[12px] leading-4 text-on-surface">
          {hot && <span className="mr-1 font-bold text-status-red" title={hot.reasons.join("\n")}>●</span>}
          {row.name}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-outline">
          {row.ownerName ?? "не назначен"} · {row.statusName ?? "без статуса"}
        </span>
      </button>
      <div className="relative" style={{ width, minHeight: mobile ? 56 : 52 }} onContextMenu={(e) => onMenu?.(row, e)}>
        {historyMark && (
          <span className="absolute inset-y-1 z-[2] border-l-2 border-dashed border-outline" style={{ left: xEv(historyMark.at) }} title={`История известна с ${ruDay(historyMark.at)}${historyMark.kind === "created" ? " (первая справка с задачей)" : ""}`} />
        )}
        {/* фазы: в каком статусе задача была */}
        {phases.map((p, i) => {
          const left = xEv(p.from);
          return (
            <span
              key={i}
              className="absolute top-1/2 z-[2] h-1.5 -translate-y-1/2 rounded-sm"
              style={{ left, width: Math.max(2, xEv(p.to) - left), background: p.stop ? STOP_BG : PHASE_COLOR[p.column] }}
              title={`${p.stop ? "На стопе" : p.status ?? PHASE_LABEL[p.column]}: ${ruDay(new Date(p.from))} – ${ruDay(new Date(p.to))} (${daysWord(Math.max(0, Math.round((p.to - p.from) / DAY)))})`}
            />
          );
        })}
        {/* план до срока и просрочка */}
        {open && dl !== null && dl > today && <span className="absolute top-1/2 z-[2] h-0 -translate-y-1/2 border-t-2 border-dashed border-outline/70" style={{ left: today, width: dl - today }} title={`До срока ${daysWord(Math.round((dl - today) / pxDay))}`} />}
        {late && dl !== null && dl < today && <span className="absolute top-1/2 z-[2] h-1.5 -translate-y-1/2 rounded-sm bg-status-red" style={{ left: dl, width: today - dl }} title={`Просрочено на ${daysWord(Math.max(1, Math.round((today - dl) / pxDay)))}`} />}
        {closedAt !== null && !clusters.some((c) => Math.abs(c.x - xEv(closedAt)) < 10) && (
          <span className={`absolute top-1/2 z-[3] flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-white ring-2 ring-surface ${col === "DONE" ? "bg-status-emerald" : "bg-outline"}`} style={{ left: xEv(closedAt) }} title={`${col === "DONE" ? "Выполнено" : "Отменена"} ${ruDay(new Date(closedAt))}`}>
            {col === "DONE" ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
          </span>
        )}
        {/* исходный срок → текущий */}
        {orig !== null && dl !== null && (
          <>
            <span className="absolute z-[2] h-0 border-t border-dashed border-outline" style={{ top: "calc(50% - 10px)", left: Math.min(orig, dl), width: Math.abs(dl - orig) }} />
            <span className="absolute top-1/2 z-[3] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-dashed border-outline bg-surface" style={{ left: orig }} title={`Исходный срок ${ruDay(row.originalDeadline!)}`} />
          </>
        )}
        {dl !== null && (
          <span className={`absolute top-1/2 z-[3] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 ${late ? "border-status-red bg-status-red/20" : "border-on-surface bg-surface"}`} style={{ left: dl }} title={dlTip} />
        )}
        {clusters.map((c) => (
          <button
            key={c.groups[0][0]}
            data-no-tip
            onMouseEnter={(e) => !mobile && onPoint(c.groups, e.currentTarget.getBoundingClientRect(), false)}
            onMouseLeave={() => !mobile && onPointLeave()}
            onClick={(e) => (mobile ? onPoint(c.groups, e.currentTarget.getBoundingClientRect(), true) : onOpen(row, "history"))}
            className="absolute top-1/2 z-[4] flex h-4 min-w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white ring-2 ring-surface"
            style={{ left: c.x, background: c.color }}
            aria-label={c.groups.map(([d, evs]) => `${ru(d, { day: "2-digit", month: "2-digit" })}: ${evs.map((e) => e.text).join("; ")}`).join(". ")}
          >
            {c.count > 1 ? c.count : ""}
          </button>
        ))}
      </div>
    </div>
  );
}
