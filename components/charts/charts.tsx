"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * Небольшие SVG-графики без библиотек (CSP сайта и вес страницы): мини-график, полосы, линии, сегментная полоса.
 * У каждого графика — текстовая подпись (aria-label) и подсказки по точкам (<title>), числа всегда можно посмотреть таблицей рядом.
 */

/** Цвета линий по дирекциям: различимы между собой и на белом фоне. */
export const SERIES_COLORS = ["#2563eb", "#d97706", "#059669", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#475569", "#b45309"];

/** Мини-график: линия с разрывами на пропусках (null), последняя точка выделена. */
export function Sparkline({ values, width = 120, height = 32, color = "#64748b", label }: { values: Array<number | null>; width?: number; height?: number; color?: string; label: string }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return <span className="text-[11px] text-outline">нет данных за 12 недель</span>;
  const max = Math.max(1, ...known);
  const step = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
  const pt = (v: number, i: number) => [2 + i * step, height - 3 - (v / max) * (height - 6)] as const;
  const segments: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segments.push(cur.join(" "));
      cur = [];
    } else cur.push(pt(v, i).join(","));
  });
  if (cur.length) segments.push(cur.join(" "));
  const lastIdx = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).at(-1)!;
  const [lx, ly] = pt(values[lastIdx]!, lastIdx);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="overflow-visible">
      {segments.map((s, i) => (s.includes(" ") ? <polyline key={i} points={s} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" /> : <circle key={i} cx={s.split(",")[0]} cy={s.split(",")[1]} r={1.5} fill={color} />))}
      <circle cx={lx} cy={ly} r={2.75} fill={color} />
    </svg>
  );
}

/** Горизонтальные полосы: подпись, полоса доли и текст справа («2 из 10 · 20%»). */
export function BarList({ items }: { items: Array<{ id: string; label: string; share: number; text: string; color: string; href?: string }> }) {
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i.id} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-[12px] max-md:grid-cols-[minmax(0,6.5rem)_1fr_auto]">
          {i.href ? (
            <Link href={i.href} className="truncate font-semibold text-on-surface hover:underline">
              {i.label}
            </Link>
          ) : (
            <span className="truncate font-semibold text-on-surface">{i.label}</span>
          )}
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-high" role="img" aria-label={`${i.label}: ${i.text}`}>
            <span className="block h-full rounded-full" style={{ width: `${Math.max(i.share > 0 ? 2 : 0, Math.min(100, i.share * 100))}%`, background: i.color }} />
          </span>
          <span className="whitespace-nowrap tabular-nums text-on-surface-variant">{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Сегментная полоса (части целого) с числами в подсказках. */
export function StackBar({ parts, label }: { parts: Array<{ key: string; value: number; color: string; name: string }>; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <span className="text-[11px] text-outline">нет</span>;
  return (
    <span className="flex h-3 w-full overflow-hidden rounded-full bg-surface-high" role="img" aria-label={`${label}: ${parts.filter((p) => p.value).map((p) => `${p.name} ${p.value}`).join(", ")}`}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span key={p.key} title={`${p.name}: ${p.value}`} className="h-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
    </span>
  );
}

export type LineSeries = { id: string; name: string; color: string; values: Array<number | null>; notes?: Array<string | null> };

/**
 * Линейный график по неделям: разрывы на пропусках (недели без справки), отмеченные точки (исправленные справки) — с обводкой,
 * легенда — щелчок скрывает/показывает линию, подсказка по точке — неделя, дирекция, значение, пометка.
 */
export function LineChart({ weeks, series, valueName }: { weeks: string[]; series: LineSeries[]; valueName: string }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const shown = series.filter((s) => !hidden.includes(s.id));
  const W = 640;
  const H = 240;
  const pad = { l: 34, r: 12, t: 12, b: 28 };
  const all = shown.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.max(1, ...all);
  const nice = max <= 5 ? 5 : max <= 10 ? 10 : Math.ceil(max / 5) * 5;
  const x = (i: number) => pad.l + (weeks.length > 1 ? (i * (W - pad.l - pad.r)) / (weeks.length - 1) : 0);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const ticks = [0, nice / 2, nice].map((t) => Math.round(t));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${valueName} по неделям`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-outline-variant" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-current text-outline" fontSize={11}>
              {t}
            </text>
          </g>
        ))}
        {weeks.map((w, i) =>
          i % 2 === weeks.length % 2 ? null : (
            <text key={w} x={x(i)} y={H - 8} textAnchor="middle" className="fill-current text-outline" fontSize={11}>
              {w}
            </text>
          ),
        )}
        {shown.map((s) => {
          const segs: Array<Array<[number, number]>> = [];
          let cur: Array<[number, number]> = [];
          s.values.forEach((v, i) => {
            if (v === null) {
              if (cur.length) segs.push(cur);
              cur = [];
            } else cur.push([x(i), y(v)]);
          });
          if (cur.length) segs.push(cur);
          return (
            <g key={s.id}>
              {segs.map((seg, i) => (seg.length > 1 ? <polyline key={i} points={seg.map((p) => p.join(",")).join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null))}
              {s.values.map((v, i) =>
                v === null ? null : (
                  <circle key={i} cx={x(i)} cy={y(v)} r={s.notes?.[i] ? 4.5 : 3} fill={s.notes?.[i] ? "white" : s.color} stroke={s.color} strokeWidth={s.notes?.[i] ? 2 : 0}>
                    <title>{`${s.name}, неделя с ${weeks[i]}: ${valueName.toLowerCase()} — ${v}${s.notes?.[i] ? `\n${s.notes[i]}` : ""}`}</title>
                  </circle>
                ),
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {series.map((s) => {
          const off = hidden.includes(s.id);
          return (
            <button key={s.id} onClick={() => setHidden((h) => (off ? h.filter((x) => x !== s.id) : [...h, s.id]))} aria-pressed={!off} className={`flex items-center gap-1.5 text-[12px] ${off ? "text-outline line-through" : "text-on-surface"}`} title={off ? "Показать линию" : "Скрыть линию"}>
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: off ? "transparent" : s.color, border: `2px solid ${s.color}` }} />
              {s.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
