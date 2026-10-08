"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import { NO_SEGMENT, type SegmentCount, type TrackCount } from "@/lib/segment-counts";

/** Какие сегменты раскрыты в сайдбаре — помним в этом браузере. */
const OPEN_KEY = "operativka.segmentsOpen.v1";
function useOpenSegments(): [Set<string>, (id: string) => void] {
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw) setOpen(new Set(JSON.parse(raw) as string[]));
    } catch {
      // приватный режим — всё свёрнуто
    }
  }, []);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {
        // не сохранилось — не страшно
      }
      return next;
    });
  return [open, toggle];
}

export type SegmentRef = { id: string; name: string; color?: string | null };

const PALETTE = ["#0059a5", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ef4444", "#64748b"];

/** Цвет сегмента: свой из справочника или по кругу из палитры (общий для списка и групп в таблице). */
export function segmentColors(segments: SegmentRef[]): Map<string, string> {
  const map = new Map(segments.map((s, i) => [s.id, s.color || PALETTE[i % PALETTE.length]]));
  map.set(NO_SEGMENT, "#94a3b8");
  return map;
}

/**
 * Левая колонка master-detail: можно отметить несколько сегментов сразу — таблица
 * покажет их вместе, сгруппировав по сегментам, чтобы сравнивать наглядно.
 * Ничего не отмечено = все сегменты.
 */
export function SegmentList({
  segments,
  counts,
  selected,
  onToggle,
  onClear,
  tracks,
  trackPicks,
  onToggleTrack,
}: {
  segments: SegmentRef[];
  counts: Map<string, SegmentCount>;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  /** Треки внутри каждого сегмента (раскрывающийся список под карточкой). */
  tracks: Map<string, TrackCount[]>;
  /** Отмеченные треки: ключи trackPickKey(сегмент, трек). */
  trackPicks: string[];
  onToggleTrack: (key: string) => void;
}) {
  const colors = segmentColors(segments);
  const [open, toggleOpen] = useOpenSegments();
  const total = [...counts.values()].reduce((s, c) => s + c.total, 0);
  const totalOper = [...counts.values()].reduce((s, c) => s + c.oper, 0);
  const noSegment = counts.get(NO_SEGMENT);

  const items: Array<{ id: string; name: string; count: SegmentCount }> = [
    ...segments.map((s) => ({ id: s.id, name: s.name, count: counts.get(s.id) ?? { total: 0, oper: 0 } })),
    ...(noSegment ? [{ id: NO_SEGMENT, name: "Без сегмента", count: noSegment }] : []),
  ];
  const allActive = selected.length === 0 && trackPicks.length === 0;

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-outline-variant bg-surface-low lg:flex xl:w-80">
      <div className="flex items-center justify-between gap-2 border-b border-outline-variant bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers size={15} className="text-outline" />
          <span className="label-caps">Сегменты</span>
        </div>
        {selected.length + trackPicks.length > 0 && (
          <button onClick={onClear} className="text-[12px] font-semibold text-primary hover:underline">
            Сбросить ({selected.length + trackPicks.length})
          </button>
        )}
      </div>
      <p className="border-b border-outline-variant/60 px-4 py-2 text-[11px] text-on-surface-variant">Выберите несколько сегментов, чтобы сравнить их в одной таблице. Стрелка справа на карточке (или двойной клик) — треки сегмента.</p>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        <button
          onClick={onClear}
          className={`w-full rounded-md border border-l-4 p-3 text-left transition-all ${
            allActive ? "border-transparent" : "border-outline-variant/60 bg-surface hover:bg-surface-high"
          }`}
          style={{
            borderLeftColor: "#64748b",
            ...(allActive ? { background: "#64748b10", boxShadow: "0 0 0 2px #64748bb8" } : {}),
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[13px] font-bold text-on-surface">Все сегменты</h3>
            <CountBadge color="#64748b" value={total} />
          </div>
          <p className="mt-1 text-[11px] text-on-surface-variant">{totalOper > 0 ? `${totalOper} отправлено директору` : "нет отправленных"}</p>
        </button>

        {items.map((it) => {
          const active = selected.includes(it.id);
          const color = colors.get(it.id) ?? "#94a3b8";
          const list = tracks.get(it.id) ?? [];
          const isOpen = open.has(it.id) && list.length > 0;
          const picked = list.filter((t) => trackPicks.includes(t.key)).length;
          return (
            <div key={it.id}>
              <div className="relative">
                <button
                  onClick={() => onToggle(it.id)}
                  onDoubleClick={() => list.length > 0 && toggleOpen(it.id)}
                  aria-pressed={active}
                  className={`w-full rounded-md border border-l-4 p-3 pr-9 text-left transition-all ${
                    active ? "border-transparent" : "border-outline-variant/60 bg-surface hover:bg-surface-high"
                  }`}
                  // Выбранный сегмент — цветной контур и заливка в цвет сегмента (без галочек).
                  style={{
                    borderLeftColor: color,
                    ...(active ? { background: `${color}10`, boxShadow: `0 0 0 2px ${color}b8` } : {}),
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate text-[13px] font-bold text-on-surface">{it.name}</h3>
                    <CountBadge color={color} value={it.count.total} />
                  </div>
                  <p className="mt-1 text-[11px] text-on-surface-variant">
                    {it.count.oper > 0 ? `${it.count.oper} отправлено директору` : "нет отправленных"}
                    {picked > 0 && !isOpen && <span className="font-semibold" style={{ color }}> · выбрано треков: {picked}</span>}
                  </p>
                </button>
                {list.length > 0 && (
                  <button
                    onClick={() => toggleOpen(it.id)}
                    className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-highest hover:text-on-surface"
                    title={isOpen ? "Свернуть треки" : `Показать треки сегмента (${list.length})`}
                    aria-label={isOpen ? "Свернуть треки" : "Показать треки"}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                )}
              </div>
              {isOpen && (
                <ul className="animate-fade-in ml-3 mt-1 space-y-0.5 border-l-2 pl-2" style={{ borderLeftColor: `${color}66` }}>
                  {list.map((t) => {
                    const on = trackPicks.includes(t.key);
                    return (
                      <li key={t.key}>
                        <button
                          onClick={() => onToggleTrack(t.key)}
                          aria-pressed={on}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors ${on ? "font-semibold" : "text-on-surface hover:bg-surface-high"}`}
                          style={on ? { background: `${color}1a`, color, boxShadow: `inset 0 0 0 1px ${color}80` } : undefined}
                          title={on ? "Снять выбор трека" : "Показать в таблице только этот трек"}
                        >
                          <span className={`min-w-0 flex-1 truncate ${t.trackId === "none" ? "italic text-on-surface-variant" : ""}`}>{t.name}</span>
                          <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ color: on ? color : undefined }}>{t.total}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function CountBadge({ color, value }: { color: string; value: number }) {
  return (
    <span className="shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-bold" style={{ background: `${color}1f`, color, borderColor: `${color}4d` }}>
      {value}
    </span>
  );
}

/** На узких экранах список превращается в выпадающий выбор с галочками над таблицей. */
export function SegmentSelect({
  segments,
  counts,
  selected,
  onToggle,
  onClear,
  tracks,
  trackPicks,
  onToggleTrack,
}: {
  segments: SegmentRef[];
  counts: Map<string, SegmentCount>;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  tracks: Map<string, TrackCount[]>;
  trackPicks: string[];
  onToggleTrack: (key: string) => void;
}) {
  const options = [...segments.map((s) => ({ id: s.id, name: s.name })), ...(counts.get(NO_SEGMENT) ? [{ id: NO_SEGMENT, name: "Без сегмента" }] : [])];
  const label =
    selected.length === 0 && trackPicks.length === 0
      ? "Все сегменты"
      : [selected.length ? `Сегментов: ${selected.length}` : null, trackPicks.length ? `треков: ${trackPicks.length}` : null].filter(Boolean).join(", ");

  return (
    <div className="lg:hidden">
      <Popover
        width="100%"
        className="w-full"
        trigger={({ toggle }) => (
          <button onClick={toggle} className="select flex w-full items-center justify-between">
            <span className="truncate">{label}</span>
            <ChevronDown size={14} className="text-outline" />
          </button>
        )}
      >
        {() => (
          <div>
            <button onClick={onClear} className={`flex w-full items-center justify-between px-3.5 py-2 text-left text-[13px] hover:bg-primary-soft ${selected.length === 0 && trackPicks.length === 0 ? "bg-primary-soft font-semibold text-primary" : ""}`}>
              Все сегменты
            </button>
            {options.map((o) => {
              const active = selected.includes(o.id);
              return (
                <div key={o.id}>
                  <button onClick={() => onToggle(o.id)} className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-[13px] hover:bg-primary-soft ${active ? "bg-primary-soft font-semibold text-primary" : ""}`}>
                    <span className="truncate">{o.name} ({counts.get(o.id)?.total ?? 0})</span>
                  </button>
                  {(tracks.get(o.id) ?? []).map((t) => {
                    const on = trackPicks.includes(t.key);
                    return (
                      <button key={t.key} onClick={() => onToggleTrack(t.key)} className={`flex w-full items-center justify-between gap-2 py-1.5 pl-8 pr-3.5 text-left text-[12px] hover:bg-primary-soft ${on ? "bg-primary-soft font-semibold text-primary" : "text-on-surface-variant"}`}>
                        <span className="truncate">{t.name}</span>
                        <span className="shrink-0 tabular-nums">{t.total}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </Popover>
    </div>
  );
}
