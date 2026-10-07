import { ATTRACTIVENESS_LABEL, attractivenessText } from "@/lib/attractiveness";

/** Бейдж шкалы привлекательности: слово («Высокая», «Средняя»…), цвет берётся из справочника; код шкалы — в подсказке. */
export function AttractivenessBadge({ name, color }: { name: string | null; color: string | null }) {
  const code = name ?? "P0";
  const c = color ?? "#94a3b8";
  return (
    <span
      className="inline-flex items-center justify-center whitespace-nowrap rounded-sm border px-2 py-0.5 text-[11px] font-bold"
      style={{ background: `${c}1f`, color: c, borderColor: `${c}4d` }}
      title={code}
    >
      {attractivenessText(code)}
    </span>
  );
}

export function StatusPill({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return <span className="text-outline">—</span>;
  const c = color ?? "#64748b";
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${c}1a`, color: c }}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c }} />
      <span className="truncate">{name}</span>
    </span>
  );
}

export { ATTRACTIVENESS_LABEL };
