"use client";

import { useMemo } from "react";
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

/** Аналитика выборки (по образцу): считается из строк, которые сейчас видны в таблице. */
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
    };
  }, [rows]);

  return (
    <Panel title="Аналитика выборки" subtitle={title} onClose={onClose} width={400}>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-3">
          <Kpi label="Всего позиций" value={stats.total} />
          <Kpi label="Отправлено куратору" value={stats.sent} tone="emerald" />
          <Kpi label="Просрочено" value={stats.overdue} tone={stats.overdue > 0 ? "red" : undefined} />
          <Kpi label="Без ответственного" value={stats.noOwner} tone={stats.noOwner > 0 ? "amber" : undefined} />
        </div>

        <div className="rounded-lg border border-outline-variant bg-surface-low p-4">
          <h3 className="label-caps mb-4">Распределение по привлекательности</h3>
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
                      {s.name}
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
