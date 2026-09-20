"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { Popover } from "@/components/ui/Popover";

export type Option = { id: string; name: string; /** Пояснение справа от названия (например, «Выше среднего» у P70). */ hint?: string; /** Значок слева от названия (например, аватар человека). */ leading?: ReactNode };

/**
 * Чип-фильтр как в образце: «МЕТКА значение ▾». Можно выбрать несколько значений сразу —
 * так удобно сравнивать выборки. Список не закрывается при выборе. Активный чип подсвечен.
 */
export function FilterChip({
  label,
  value,
  options,
  onChange,
  allLabel = "Все",
}: {
  label: string;
  value: string[];
  options: Option[];
  onChange: (ids: string[]) => void;
  allLabel?: string;
}) {
  const [search, setSearch] = useState("");
  const selected = options.filter((o) => value.includes(o.id));
  const filtered = search ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase())) : options;
  const summary = selected.length === 0 ? allLabel : selected.length === 1 ? selected[0].name : `${selected.length} выбрано`;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <Popover
      width={280}
      trigger={({ toggle: open }) => (
        <button
          onClick={open}
          className={`flex h-9 items-center gap-2 rounded-md border px-3 transition-colors ${
            selected.length > 0 ? "border-primary bg-primary-soft" : "border-outline-variant bg-surface hover:bg-surface-high"
          }`}
        >
          <span className="label-caps">{label}</span>
          <span className={`max-w-36 truncate text-[13px] font-semibold ${selected.length > 0 ? "text-primary" : "text-on-surface"}`}>{summary}</span>
          <ChevronDown size={14} className="text-outline" />
        </button>
      )}
    >
      {() => (
        <div>
          {options.length > 8 && (
            <div className="relative px-2 pb-1 pt-1">
              <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline" />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Найти…" className="input h-8 w-full pl-8" />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto">
            <Row checked={value.length === 0} onClick={() => onChange([])}>{allLabel}</Row>
            {filtered.map((o) => (
              <Row key={o.id} checked={value.includes(o.id)} onClick={() => toggle(o.id)} hint={o.hint} leading={o.leading}>{o.name}</Row>
            ))}
            {filtered.length === 0 && <p className="px-3.5 py-3 text-[12px] text-outline">Ничего не найдено</p>}
          </div>
          {value.length > 0 && (
            <button onClick={() => onChange([])} className="w-full border-t border-outline-variant px-3.5 py-2 text-left text-[12px] font-semibold text-primary hover:bg-primary-soft">
              Сбросить ({value.length})
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}

function Row({ children, checked, onClick, hint, leading }: { children: ReactNode; checked: boolean; onClick: () => void; hint?: string; leading?: ReactNode }) {
  return (
    <button onClick={onClick} role="checkbox" aria-checked={checked} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-primary-soft">
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${checked ? "border-primary bg-primary text-white" : "border-outline bg-surface"}`}>
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      {leading}
      <span className={`flex min-w-0 items-baseline gap-2 ${checked ? "font-semibold text-primary" : "text-on-surface"}`}>
        <span className="truncate">{children}</span>
        {hint && <span className="truncate text-[12px] font-normal text-on-surface-variant">— {hint}</span>}
      </span>
    </button>
  );
}

/** Пунктирная «+ Фильтры»: остальные условия (срок, архив). */
export function MoreFilters({ activeCount, children }: { activeCount: number; children: ReactNode }) {
  return (
    <Popover
      width={340}
      trigger={({ toggle }) => (
        <button
          onClick={toggle}
          className={`flex h-9 items-center gap-1.5 rounded-md border border-dashed px-3 transition-colors ${
            activeCount > 0 ? "border-primary bg-primary-soft text-primary" : "border-outline text-on-surface-variant hover:bg-surface-high"
          }`}
        >
          <Plus size={14} />
          <span className="label-caps" style={{ color: "inherit" }}>Фильтры</span>
          {activeCount > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">{activeCount}</span>}
        </button>
      )}
    >
      {() => <div className="space-y-3 p-3.5">{children}</div>}
    </Popover>
  );
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label-caps mb-1 block">{label}</label>
      {children}
    </div>
  );
}
