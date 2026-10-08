"use client";

import { useMemo, useState } from "react";
import { attractivenessText } from "@/lib/attractiveness";
import { Panel } from "@/components/ui/Panel";

export type AnalyticsRow = {
  statusName: string | null;
  statusColor: string | null;
  attractivenessName: string | null;
  attractivenessColor: string | null;
  operFlag: boolean;
  ownerId: string | null;
  deadline: string | null;
  archived: boolean;
  trackId: string | null;
  trackName: string | null;
};

type Slice = { name: string; color: string; count: number };

function group(rows: AnalyticsRow[], name: (r: AnalyticsRow) => string, color: (r: AnalyticsRow) => string): Slice[] {
  const map = new Map<string, Slice>();
  for (const r of rows) {
    const n = name(r);
    const s = map.get(n) ?? { name: n, color: color(r), count: 0 };
    s.count++;
    map.set(n, s);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Аналитика: считается из строк, которые сейчас видны в таблице. */
export function AnalyticsPanel({ rows, title, onClose }: { rows: AnalyticsRow[]; title: string; onClose: () => void }) {
  const stats = useMemo(() => {
    const now = new Date();
    const active = rows.filter((r) => !r.archived);
    const overdue = active.filter(
      (r) => r.deadline && new Date(r.deadline) < now && r.statusName !== "Завершено" && r.statusName !== "Не актуально"
    ).length;
    return {
      total: rows.length,
      sent: rows.filter((r) => r.operFlag).length,
      overdue,
      noOwner: rows.filter((r) => !r.ownerId).length,
      byAttractiveness: group(rows, (r) => r.attractivenessName ?? "P0", (r) => r.attractivenessColor ?? "#94a3b8"),
      byStatus: group(rows, (r) => r.statusName ?? "Без статуса", (r) => r.statusColor ?? "#64748b"),
      byTrack: group(rows, (r) => r.trackName ?? "Без трека", () => "")
        .sort((a, b) => Number(a.name === "Без трека") - Number(b.name === "Без трека") || b.count - a.count)
        .map((s, i) => ({ ...s, color: s.name === "Без трека" ? "#94a3b8" : TRACK_PALETTE[i % TRACK_PALETTE.length] })),
    };
  }, [rows]);

  return (
    <Panel title="Аналитика" subtitle={title} onClose={onClose} width={440}>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-3">
          <Kpi label="Всего позиций" value={stats.total} />
          <Kpi label="Отправлено директору" value={stats.sent} tone="emerald" />
          <Kpi label="Просрочено" value={stats.overdue} tone={stats.overdue > 0 ? "red" : undefined} />
          <Kpi label="Без ответственного" value={stats.noOwner} tone={stats.noOwner > 0 ? "amber" : undefined} />
        </div>

        <TrackPie slices={stats.byTrack} />

        <div className="rounded-lg border border-outline-variant bg-surface-low p-4">
          <h3 className="label-caps mb-4">Распределение по вниманию</h3>
          {stats.total === 0 ? (
            <p className="text-[13px] text-outline">Нет данных для выборки.</p>
          ) : (
            <div className="flex items-center gap-6">
              <Donut slices={stats.byAttractiveness} total={stats.total} />
              <ul className="flex flex-1 flex-col gap-2">
                {stats.byAttractiveness.map((s) => (
                  <li key={s.name} className="flex items-center justify-between text-[12px]">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {attractivenessText(s.name)}
                    </span>
                    <span className="font-bold">{Math.round((s.count / stats.total) * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-outline-variant bg-surface-low p-4">
          <h3 className="label-caps mb-3">По статусам</h3>
          {stats.byStatus.length === 0 ? (
            <p className="text-[13px] text-outline">Нет данных для выборки.</p>
          ) : (
            <ul className="space-y-3">
              {stats.byStatus.map((s) => (
                <li key={s.name}>
                  <div className="mb-1 flex justify-between text-[12px]">
                    <span>{s.name}</span>
                    <span className="font-bold">{s.count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-highest">
                    <div className="h-full rounded-full" style={{ width: `${(s.count / stats.total) * 100}%`, background: s.color }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "red" | "amber" }) {
  const color = tone === "emerald" ? "text-status-emerald" : tone === "red" ? "text-status-red" : tone === "amber" ? "text-status-amber" : "text-on-surface";
  return (
    <div className="rounded-lg border border-outline-variant bg-surface p-3.5">
      <div className={`text-[32px] font-bold leading-none tracking-tight ${color}`}>{value}</div>
      <div className="mt-1.5 text-[11px] text-on-surface-variant">{label}</div>
    </div>
  );
}

/** Кольцо по образцу: окружности с stroke-dasharray, сегменты идут друг за другом. */
function Donut({ slices, total }: { slices: Slice[]; total: number }) {
  // смещение каждого сегмента = сумма долей предыдущих (без переприсваивания переменной в цикле)
  const pcts = slices.map((s) => (s.count / total) * 100);
  const offsets = pcts.map((_, i) => pcts.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
      <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="16" fill="none" stroke="#e4eaf0" strokeWidth="4" />
        {slices.map((s, i) => {
          const pct = pcts[i];
          const offset = offsets[i];
          return (
            <circle
              key={s.name}
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke={s.color}
              strokeWidth="4"
              strokeDasharray={`${pct} ${100 - pct}`}
              strokeDashoffset={-offset}
              pathLength={100}
            />
          );
        })}
      </svg>
      <div className="flex flex-col items-center">
        <span className="text-xl font-bold text-on-surface">{total}</span>
        <span className="text-[9px] font-bold uppercase text-outline">Всего</span>
      </div>
    </div>
  );
}

/** Цвета треков: контрастные, по кругу. */
const TRACK_PALETTE = ["#0059a5", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1", "#14b8a6", "#a16207", "#be185d", "#0ea5e9", "#65a30d"];

/** Сектор круга: путь SVG от угла a0 до a1 (в долях круга, 0 — сверху, по часовой). */
function arcPath(a0: number, a1: number, r = 50, c = 50): string {
  if (a1 - a0 >= 0.9999) return `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z`;
  const p = (a: number) => [c + r * Math.sin(2 * Math.PI * a), c - r * Math.cos(2 * Math.PI * a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M ${c} ${c} L ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 0.5 ? 1 : 0} 1 ${x1} ${y1} Z`;
}

/**
 * Круговая диаграмма по трекам. Как фильтр легенды в Excel: галочками убираете треки, и круг с процентами
 * пересчитывается по оставшимся — так видно, какой трек сколько занимает и как треки соотносятся между собой.
 */
function TrackPie({ slices }: { slices: Slice[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const shown = slices.filter((s) => !hidden.has(s.name));
  const total = shown.reduce((a, s) => a + s.count, 0);
  const toggle = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const starts = shown.map((_, i) => shown.slice(0, i).reduce((a, s) => a + s.count, 0) / (total || 1));
  const focus = shown.find((s) => s.name === hover) ?? null;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

  return (
    <div className="rounded-lg border border-outline-variant bg-surface-low p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="label-caps">По трекам</h3>
        {slices.length > 1 && (
          <div className="flex gap-2 text-[11px] font-semibold">
            <button onClick={() => setHidden(new Set())} disabled={hidden.size === 0} className="text-primary disabled:text-outline">Все</button>
            <button onClick={() => setHidden(new Set(slices.map((s) => s.name)))} disabled={hidden.size === slices.length} className="text-primary disabled:text-outline">Снять все</button>
          </div>
        )}
      </div>
      {slices.length === 0 ? (
        <p className="text-[13px] text-outline">Нет данных для выборки.</p>
      ) : (
        <>
          <div className="flex justify-center">
            <div className="relative h-44 w-44">
              <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label="Круговая диаграмма по трекам">
                {total === 0 ? (
                  <circle cx="50" cy="50" r="50" fill="#e4eaf0" />
                ) : (
                  shown.map((s, i) => (
                    <path
                      key={s.name}
                      d={arcPath(starts[i], starts[i] + s.count / total)}
                      fill={s.color}
                      stroke="var(--surface, #fff)"
                      strokeWidth={shown.length > 1 ? 0.8 : 0}
                      opacity={hover && hover !== s.name ? 0.35 : 1}
                      onMouseEnter={() => setHover(s.name)}
                      onMouseLeave={() => setHover(null)}
                      className="cursor-pointer transition-opacity"
                    >
                      <title>{`${s.name}: ${s.count} (${pct(s.count)}%)`}</title>
                    </path>
                  ))
                )}
              </svg>
            </div>
          </div>
          <p className="mt-2 min-h-[18px] text-center text-[12px] text-on-surface-variant">
            {focus ? (
              <>
                <span className="font-semibold text-on-surface">{focus.name}</span> — {focus.count} поз., {pct(focus.count)}%
              </>
            ) : total === 0 ? (
              "Отметьте треки ниже, чтобы построить диаграмму."
            ) : (
              `В диаграмме: ${total} поз., треков: ${shown.length}`
            )}
          </p>
          <ul className="mt-3 max-h-64 space-y-0.5 overflow-y-auto pr-1">
            {slices.map((s) => {
              const on = !hidden.has(s.name);
              return (
                <li key={s.name}>
                  <button
                    onClick={() => toggle(s.name)}
                    onMouseEnter={() => on && setHover(s.name)}
                    onMouseLeave={() => setHover(null)}
                    role="checkbox"
                    aria-checked={on}
                    className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-surface-high ${on ? "text-on-surface" : "text-outline"}`}
                  >
                    <span
                      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border"
                      style={on ? { background: s.color, borderColor: s.color } : { borderColor: "var(--outline, #94a3b8)" }}
                    >
                      {on && <span className="text-[9px] font-black leading-none text-white">✓</span>}
                    </span>
                    <span className={`min-w-0 flex-1 truncate ${on ? "" : "line-through"}`}>{s.name}</span>
                    <span className="shrink-0 tabular-nums text-on-surface-variant">{s.count}</span>
                    <span className="w-12 shrink-0 text-right font-bold tabular-nums">{on ? `${pct(s.count)}%` : "—"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
