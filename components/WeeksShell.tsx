"use client";

import { useSearchParams } from "next/navigation";
import { TableView } from "@/components/TableView";
import { WeekBar } from "@/components/WeekBar";
import { WeekTable } from "@/components/WeekTable";

/** «Общая таблица»: текущая неделя (редактируемая) или прошлая по `?week=` (только чтение). */
export function WeeksShell() {
  const week = useSearchParams().get("week");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WeekBar selected={week} />
      <div className={week ? "min-h-0 flex-1 overflow-y-auto" : "min-h-0 flex-1"}>{week ? <WeekTable cycleId={week} /> : <TableView />}</div>
    </div>
  );
}
