"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import type { WeekListItem } from "@/app/api/weeks/route";

type Data = { current: { number: number } | null; weeks: WeekListItem[] };

const short = (v: string) => new Date(v).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Выбор недели — чип в ряду фильтров: «Текущая» или прошлая оперативка. Список с поиском (по номеру и дате). Нет прошлых недель — не показывается. */
export function WeekSelect({ selected }: { selected: string | null }) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/weeks")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!data || data.weeks.length === 0) return null;
  const current = { id: "", name: `Текущая${data.current ? ` · №${data.current.number}` : ""}` };
  const options = [current, ...data.weeks.map((w) => ({ id: w.cycleId, name: `№${w.number} · ${short(w.meetingDate ?? w.sentAt)}` }))];
  const shown = search.trim() ? options.filter((o) => o.name.toLowerCase().includes(search.trim().toLowerCase())) : options;
  const active = options.find((o) => o.id === (selected ?? "")) ?? current;
  const pick = (id: string, close: () => void) => {
    close();
    setSearch("");
    router.push(id ? `/table?week=${id}` : "/table");
  };

  return (
    <Popover
      width={260}
      trigger={({ toggle }) => (
        <button onClick={toggle} className={`flex h-9 items-center gap-2 rounded-md border px-3 transition-colors ${selected ? "border-primary bg-primary-soft" : "border-outline-variant bg-surface hover:bg-surface-high"}`}>
          <span className="label-caps">Неделя</span>
          <span className={`max-w-40 truncate text-[13px] font-semibold ${selected ? "text-primary" : "text-on-surface"}`}>{active.name}</span>
          <ChevronDown size={14} className="text-outline" />
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="relative px-2 pb-1 pt-1">
            <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline" />
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Найти неделю…" className="input h-8 w-full pl-8" />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {shown.map((o) => (
              <button key={o.id || "current"} onClick={() => pick(o.id, close)} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] hover:bg-primary-soft">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-primary">{o.id === (selected ?? "") && <Check size={14} strokeWidth={3} />}</span>
                <span className={o.id === (selected ?? "") ? "font-semibold text-primary" : "text-on-surface"}>{o.name}</span>
              </button>
            ))}
            {shown.length === 0 && <p className="px-3.5 py-3 text-[12px] text-outline">Ничего не найдено</p>}
          </div>
        </div>
      )}
    </Popover>
  );
}
