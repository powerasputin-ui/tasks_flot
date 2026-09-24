"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { WeekListItem } from "@/app/api/weeks/route";

type Data = { current: { cycleId: string; number: number; status: string; deadline: string } | null; weeks: WeekListItem[] };

const short = (v: string) => new Date(v).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });

/** Выбор недели над «Общей таблицей»: текущая и завершённые оперативки; выбранная неделя — в адресе `?week=`. */
export function WeekBar({ selected }: { selected: string | null }) {
  const [data, setData] = useState<Data | null>(null);

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
  // порядок слева направо: старые → новые → текущая
  const items = [...data.weeks].reverse();
  const ids = [...items.map((w) => w.cycleId), "current"];
  const at = selected ? ids.indexOf(selected) : ids.length - 1;
  const hrefOf = (id: string) => (id === "current" ? "/table" : `/table?week=${id}`);
  const older = at > 0 ? ids[at - 1] : null;
  const newer = at >= 0 && at < ids.length - 1 ? ids[at + 1] : null;
  const chip = (active: boolean) => `shrink-0 rounded-md border px-3 py-1.5 text-[13px] ${active ? "border-primary bg-primary-soft font-semibold text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-high"}`;

  return (
    <nav aria-label="Недели" className="mb-3 flex items-center gap-2">
      {older ? (
        <Link href={hrefOf(older)} aria-label="Более ранняя неделя" className="btn-icon shrink-0">
          <ChevronLeft size={16} />
        </Link>
      ) : (
        <span className="w-9 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-0.5">
        {items.map((w) => (
          <Link key={w.cycleId} href={hrefOf(w.cycleId)} className={chip(selected === w.cycleId)} aria-current={selected === w.cycleId ? "page" : undefined} title={w.meetingDate ? `Совещание ${short(w.meetingDate)}` : `Отправлена ${short(w.sentAt)}`}>
            №{w.number} · {short(w.meetingDate ?? w.sentAt)}
          </Link>
        ))}
        <Link href="/table" className={chip(!selected)} aria-current={!selected ? "page" : undefined}>
          Текущая{data.current ? ` · №${data.current.number}` : ""}
        </Link>
      </div>
      {newer ? (
        <Link href={hrefOf(newer)} aria-label="Более поздняя неделя" className="btn-icon shrink-0">
          <ChevronRight size={16} />
        </Link>
      ) : (
        <span className="w-9 shrink-0" />
      )}
    </nav>
  );
}
