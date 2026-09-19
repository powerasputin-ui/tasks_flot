"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { Popover } from "@/components/ui/Popover";

export type Option = { id: string; name: string };

/** Чип-фильтр как в образце: «МЕТКА значение ▾». Активный (значение выбрано) подсвечен. */
export function FilterChip({
  label,
  value,
  options,
  onChange,
  allLabel = "Все",
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (id: string) => void;
  allLabel?: string;
}) {
  const [search, setSearch] = useState("");
  const current = options.find((o) => o.id === value);
  const filtered = search ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase())) : options;

  return (
    <Popover
      width={240}
      trigger={({ toggle }) => (
        <button
          onClick={toggle}
          className={`flex h-9 items-center gap-2 rounded-md border px-3 transition-colors ${
            current ? "border-primary bg-primary-soft" : "border-outline-variant bg-surface hover:bg-surface-high"
          }`}
        >
          <span className="label-caps">{label}</span>
          <span className={`max-w-36 truncate text-[13px] font-semibold ${current ? "text-primary" : "text-on-surface"}`}>{current?.name ?? allLabel}</span>
          <ChevronDown size={14} className="text-outline" />
        </button>
      )}
    >
      {(close) => (
        <div>
          {options.length > 8 && (
            <div className="relative px-2 pb-1 pt-1">
              <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline" />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Найти…" className="input h-8 w-full pl-8" />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto">
            <Row active={!value} onClick={() => { onChange(""); close(); }}>{allLabel}</Row>
            {filtered.map((o) => (
              <Row key={o.id} active={o.id === value} onClick={() => { onChange(o.id); close(); }}>{o.name}</Row>
            ))}
            {filtered.length === 0 && <p className="px-3.5 py-3 text-[12px] text-outline">Ничего не найдено</p>}
          </div>
        </div>
      )}
    </Popover>
  );
}

function Row({ children, active, onClick }: { children: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-primary-soft ${active ? "font-semibold text-primary" : "text-on-surface"}`}>
      <span className="truncate">{children}</span>
      {active && <Check size={14} className="shrink-0" />}
    </button>
  );
}

/** Пунктирная «+ Фильтры»: остальные условия (срок, подразделение, архив). */
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
