"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Lock } from "lucide-react";

type Payload = {
  cycle: { number: number; deadline: string; status: "OPEN" | "IN_REVIEW" | "FINAL" } | null;
  mine?: { total: number; sent: number };
};

/** «через 3 дн.» / «сегодня» / «просрочен на 2 дн.» */
function hint(iso: string): { text: string; late: boolean } {
  const d = new Date(iso);
  const t = new Date();
  const days = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
  if (days === 0) return { text: "сегодня", late: false };
  if (days > 0) return { text: `через ${days} дн.`, late: false };
  return { text: `просрочен на ${-days} дн.`, late: true };
}

/**
 * Полоса цикла в таблице руководителя: вместо отдельной вкладки «Оперативка». Показывает, идёт ли сбор, срок
 * и сколько его позиций подано директору. Чужих подач руководитель не видит: сервер отдаёт ему только его цифры.
 */
export function CycleStrip() {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/cycles/current")
      .then((r) => (r.ok ? (r.json() as Promise<Payload>) : null))
      .then((d) => alive && setData(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!data?.cycle || !data.mine) return null;
  const { cycle, mine } = data;
  const review = cycle.status === "IN_REVIEW";
  const h = hint(cycle.deadline);
  const left = Math.max(mine.total - mine.sent, 0);

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-6 py-2 text-[13px] ${review ? "border-status-amber/30 bg-status-amber/10 text-on-surface" : "border-outline-variant bg-primary-soft text-on-surface"}`}>
      {review ? <Lock size={15} className="text-status-amber" /> : <CalendarClock size={15} className="text-primary" />}
      <span className="font-semibold">Оперативка №{cycle.number}</span>
      {review ? (
        <span className="text-on-surface-variant">Идёт сборка директором: поданные позиции сейчас не меняются.</span>
      ) : (
        <>
          <span className="text-on-surface-variant">
            Срок подачи: {new Date(cycle.deadline).toLocaleDateString("ru-RU")}
            <span className={h.late ? "ml-1 font-semibold text-status-red" : "ml-1"}>({h.text})</span>
          </span>
          <span className="text-on-surface-variant">
            Подано ваших: <span className="font-semibold text-on-surface">{mine.sent}</span> из {mine.total}
            {left > 0 && ` · осталось ${left}`}
          </span>
        </>
      )}
    </div>
  );
}
