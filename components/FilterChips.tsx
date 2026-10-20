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
  width = 280,
  footer,
}: {
  label: string;
  value: string[];
  options: Option[];
  onChange: (ids: string[]) => void;
  allLabel?: string;
  width?: number;
  /** Блок под списком (например, «+ Добавить трек»); close закрывает выпадашку. */
  footer?: (close: () => void) => ReactNode;
}) {
  const [search, setSearch] = useState("");
  const selected = options.filter((o) => value.includes(o.id));
  const filtered = search ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase())) : options;
  const summary = selected.length === 0 ? allLabel : selected.length === 1 ? selected[0].name : `${selected.length} выбрано`;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <Popover width={width} trigger={({ toggle: open }) => <ChipButton label={label} summary={summary} active={selected.length > 0} onClick={open} />}>
      {(close) => (
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
          {footer && <div className="border-t border-outline-variant p-2">{footer(close)}</div>}
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

/** Кнопка чипа «МЕТКА значение ▾»; выбранный фильтр подсвечен. */
function ChipButton({ label, summary, active, onClick }: { label: string; summary: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex h-9 items-center gap-2 rounded-md border px-3 transition-colors ${active ? "border-primary bg-primary-soft" : "border-outline-variant bg-surface hover:bg-surface-high"}`}>
      <span className="label-caps">{label}</span>
      <span className={`max-w-36 truncate text-[13px] font-semibold ${active ? "text-primary" : "text-on-surface"}`}>{summary}</span>
      <ChevronDown size={14} className="text-outline" />
    </button>
  );
}

const ruDate = (v: string) => new Date(`${v}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" });

/** Чип «МЕТКА с — по ▾»: диапазон дат (любая граница может быть пустой). */
export function DateRangeChip({ label, from, to, onChange }: { label: string; from: string; to: string; onChange: (from: string, to: string) => void }) {
  const active = !!(from || to);
  const summary = !active ? "Все" : from && to ? `${ruDate(from)} — ${ruDate(to)}` : from ? `с ${ruDate(from)}` : `по ${ruDate(to)}`;
  return (
    <Popover width={300} trigger={({ toggle }) => <ChipButton label={label} summary={summary} active={active} onClick={toggle} />}>
      {() => (
        <div className="space-y-2 p-3">
          <div className="flex items-center gap-1.5">
            <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} className="input w-full" aria-label={`${label}: с`} />
            <span className="text-outline">—</span>
            <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} className="input w-full" aria-label={`${label}: по`} />
          </div>
          {active && (
            <button onClick={() => onChange("", "")} className="text-[12px] font-semibold text-primary hover:underline">
              Сбросить
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}

/** Чип с одним вариантом из нескольких («Показывать: Активные»); подсвечен, когда выбран не вариант по умолчанию. */
export function ChoiceChip<T extends string>({ label, value, options, defaultValue, onChange }: { label: string; value: T; options: Array<{ id: T; name: string }>; defaultValue: T; onChange: (v: T) => void }) {
  return (
    <Popover width={220} trigger={({ toggle }) => <ChipButton label={label} summary={options.find((o) => o.id === value)?.name ?? ""} active={value !== defaultValue} onClick={toggle} />}>
      {(close) => (
        <div className="py-1">
          {options.map((o) => (
            <button
              key={o.id}
              role="menuitemradio"
              aria-checked={o.id === value}
              onClick={() => {
                onChange(o.id);
                close();
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] hover:bg-primary-soft"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-primary">{o.id === value && <Check size={14} strokeWidth={3} />}</span>
              <span className={o.id === value ? "font-semibold text-primary" : "text-on-surface"}>{o.name}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/**
 * Пунктирная «+ Фильтры»: какие фильтры держать в ряду — галочками (выбор личный, в учётной записи). Отмеченные стоят в ряду
 * в постоянном порядке; снятая галочка прячет фильтр и сбрасывает его — спрятанный фильтр не должен молча отбирать строки.
 */
export function FilterPicker({ items, shown, onToggle }: { items: Array<{ key: string; label: string }>; shown: string[]; onToggle: (key: string, on: boolean) => void }) {
  return (
    <Popover
      width={280}
      trigger={({ toggle }) => (
        <button onClick={toggle} className="flex h-9 items-center gap-1.5 rounded-md border border-dashed border-outline px-3 text-on-surface-variant transition-colors hover:bg-surface-high">
          <Plus size={14} />
          <span className="label-caps" style={{ color: "inherit" }}>Фильтры</span>
        </button>
      )}
    >
      {() => (
        <div className="pb-1">
          <p className="px-3.5 pb-1 pt-2 text-[11px] text-on-surface-variant">Отметьте, какие фильтры держать в ряду. Снятая галочка сбрасывает фильтр.</p>
          {items.map((i) => (
            <Row key={i.key} checked={shown.includes(i.key)} onClick={() => onToggle(i.key, !shown.includes(i.key))}>
              {i.label}
            </Row>
          ))}
        </div>
      )}
    </Popover>
  );
}
