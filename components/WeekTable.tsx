"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { ArchiveTableView } from "@/components/ArchiveTable";
import type { ArchiveTable, TableDiff } from "@/lib/archive-table";

type WeekData = {
  week: { cycleId: string; number: number; meetingDate: string | null; sentAt: string; revision: number };
  table: ArchiveTable;
  prev: { cycleId: string; number: number } | null;
  diff: TableDiff | null;
};

const ruDate = (v: string) => new Date(v).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Прошлая неделя (завершённая оперативка) в «Общей таблице»: только чтение, с отметками «что изменилось с прошлой недели». */
export function WeekTable({ cycleId }: { cycleId: string }) {
  const [data, setData] = useState<WeekData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetch(`/api/weeks/${cycleId}`)
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 404) setError("Такой недели нет в вашей дирекции.");
        else if (!r.ok) setError("Не удалось загрузить неделю.");
        else setData(await r.json());
      })
      .catch(() => alive && setError("Не удалось загрузить неделю."));
    return () => {
      alive = false;
    };
  }, [cycleId]);

  if (error)
    return (
      <div className="surface p-6 text-center text-[13px] text-on-surface-variant">
        {error}{" "}
        <Link href="/table" className="text-primary hover:underline">
          К текущей неделе
        </Link>
      </div>
    );
  if (!data) return <div className="skeleton h-64 rounded-lg" />;

  const { week, table, prev, diff } = data;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-outline-variant bg-surface-low px-3 py-2 text-[13px]">
        <Lock size={14} className="text-on-surface-variant" />
        <span className="font-semibold text-on-surface">Неделя №{week.number}</span>
        <span className="text-on-surface-variant">
          {week.meetingDate ? `совещание ${ruDate(week.meetingDate)} · ` : ""}отправлена {ruDate(week.sentAt)} · ред. {week.revision} · только чтение
        </span>
        <Link href="/table" className="ml-auto inline-flex items-center gap-1 text-primary hover:underline">
          <ArrowLeft size={14} /> К текущей неделе
        </Link>
      </div>
      {!prev && table.mode === "full" && <p className="mb-3 text-[13px] text-on-surface-variant">Это первая неделя: сравнивать пока не с чем.</p>}
      {prev && !diff && table.mode === "full" && <p className="mb-3 text-[13px] text-on-surface-variant">Прошлая неделя (№{prev.number}) сохранена не полностью — сравнение недоступно.</p>}
      <ArchiveTableView table={table} diff={diff} prevNumber={prev?.number} />
    </div>
  );
}
