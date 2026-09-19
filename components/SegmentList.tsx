"use client";

import { Layers } from "lucide-react";
import { NO_SEGMENT, type SegmentCount } from "@/lib/segment-counts";

export type SegmentRef = { id: string; name: string; color?: string | null };

const PALETTE = ["#0059a5", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ef4444", "#64748b"];
const colorAt = (i: number, own?: string | null) => own || PALETTE[i % PALETTE.length];

/**
 * Левая колонка master-detail (как список проектов в образце): выбор сегмента
 * фильтрует таблицу справа. Карточка — название, число позиций и отправленных, цветная полоса слева.
 */
export function SegmentList({
  segments,
  counts,
  selected,
  onSelect,
}: {
  segments: SegmentRef[];
  counts: Map<string, SegmentCount>;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const total = [...counts.values()].reduce((s, c) => s + c.total, 0);
  const totalOper = [...counts.values()].reduce((s, c) => s + c.oper, 0);
  const noSegment = counts.get(NO_SEGMENT);

  const items: Array<{ id: string; name: string; color: string; count: SegmentCount }> = [
    { id: "all", name: "Все сегменты", color: "#64748b", count: { total, oper: totalOper } },
    ...segments.map((s, i) => ({ id: s.id, name: s.name, color: colorAt(i, s.color), count: counts.get(s.id) ?? { total: 0, oper: 0 } })),
    ...(noSegment ? [{ id: NO_SEGMENT, name: "Без сегмента", color: "#94a3b8", count: noSegment }] : []),
  ];

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-outline-variant bg-surface-low lg:flex xl:w-80">
      <div className="flex items-center gap-2 border-b border-outline-variant bg-surface px-4 py-3">
        <Layers size={15} className="text-outline" />
        <span className="label-caps">Сегменты</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {items.map((it) => {
          const active = it.id === selected;
          return (
            <button
              key={it.id}
              onClick={() => onSelect(it.id)}
              className={`group w-full rounded-md border border-l-4 p-3 text-left transition-colors ${
                active ? "border-outline-variant bg-primary-soft" : "border-outline-variant/60 bg-surface hover:bg-surface-high"
              }`}
              style={{ borderLeftColor: it.color }}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className={`truncate text-[13px] font-bold ${active ? "text-primary" : "text-on-surface"}`}>{it.name}</h3>
                <span
                  className="shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ background: `${it.color}1f`, color: it.color, borderColor: `${it.color}4d` }}
                >
                  {it.count.total}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-on-surface-variant">
                {it.count.oper > 0 ? `${it.count.oper} отправлено куратору` : "нет отправленных"}
              </p>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

/** На узких экранах список превращается в выпадающий выбор над таблицей. */
export function SegmentSelect({
  segments,
  counts,
  selected,
  onSelect,
}: {
  segments: SegmentRef[];
  counts: Map<string, SegmentCount>;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const total = [...counts.values()].reduce((s, c) => s + c.total, 0);
  return (
    <select value={selected} onChange={(e) => onSelect(e.target.value)} className="select w-full lg:hidden">
      <option value="all">Все сегменты ({total})</option>
      {segments.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} ({counts.get(s.id)?.total ?? 0})
        </option>
      ))}
      {counts.get(NO_SEGMENT) && <option value={NO_SEGMENT}>Без сегмента ({counts.get(NO_SEGMENT)!.total})</option>}
    </select>
  );
}
