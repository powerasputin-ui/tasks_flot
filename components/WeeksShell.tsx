"use client";

import { useSearchParams } from "next/navigation";
import { TableView } from "@/components/TableView";
import { WeekTable } from "@/components/WeekTable";

/** «Общая таблица»: текущая неделя (редактируемая) или прошлая по `?week=` (только чтение). Выбор недели — чип в ряду фильтров. */
export function WeeksShell() {
  const week = useSearchParams().get("week");
  return week ? (
    <div className="h-full overflow-y-auto px-6 py-4 max-md:px-3">
      <WeekTable cycleId={week} />
    </div>
  ) : (
    <TableView />
  );
}
