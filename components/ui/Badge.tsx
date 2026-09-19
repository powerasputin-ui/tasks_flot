const ATTRACTIVENESS_LABEL: Record<string, string> = {
  P100: "Высокая",
  P70: "Выше среднего",
  P50: "Средняя",
  P10: "Низкая",
  P0: "Отсутствует",
};

/** Бейдж шкалы привлекательности (как P90/P50/P10 в образце): цвет берётся из справочника. */
export function AttractivenessBadge({ name, color }: { name: string | null; color: string | null }) {
  const code = name ?? "P0";
  const c = color ?? "#94a3b8";
  return (
    <span
      className="inline-flex min-w-10 items-center justify-center rounded-sm border px-2 py-0.5 text-[11px] font-bold"
      style={{ background: `${c}1f`, color: c, borderColor: `${c}4d` }}
      title={ATTRACTIVENESS_LABEL[code] ?? code}
    >
      {code}
    </span>
  );
}

export function StatusPill({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return <span className="text-outline">—</span>;
  const c = color ?? "#64748b";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${c}1a`, color: c }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {name}
    </span>
  );
}

export { ATTRACTIVENESS_LABEL };
