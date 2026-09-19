"use client";

import { useEffect, useState } from "react";

type Ev = {
  id: string;
  timestamp: string;
  actorName: string;
  itemId: string;
  itemTitle: string;
  action: string;
  what: string;
  before: string | null;
  after: string | null;
};

const DOT: Record<string, string> = {
  CREATE: "bg-status-emerald",
  ARCHIVE: "bg-status-red",
  RESTORE: "bg-sky",
};

/** «История изменений» под таблицей (как блок с точками в образце): последние правки выбранной выборки. */
export function RecentChanges({ segment, refreshKey, onOpen }: { segment: string; refreshKey: number; onOpen: (itemId: string) => void }) {
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [limit, setLimit] = useState(10);

  useEffect(() => {
    const p = new URLSearchParams({ limit: String(limit + 1) });
    if (segment !== "all") p.set("segmentId", segment);
    fetch(`/api/items/recent-changes?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setEvents(d.events))
      .catch(() => setEvents([]));
  }, [segment, refreshKey, limit]);

  if (events === null || events.length === 0) return null;
  const shown = events.slice(0, limit);

  return (
    <div className="mt-8">
      <h4 className="label-caps mb-4">История изменений</h4>
      <ul className="space-y-3">
        {shown.map((e) => (
          <li key={e.id} className="flex gap-3">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[e.action] ?? "bg-status-amber"}`} />
            <div className="min-w-0">
              <p className="text-[12px] text-on-surface">
                <span className="font-bold">{e.actorName}</span> {e.what}
                {e.before !== null && (
                  <>
                    : <span className="text-outline">{e.before}</span> → <span className="font-semibold">{e.after}</span>
                  </>
                )}{" "}
                у{" "}
                <button onClick={() => onOpen(e.itemId)} className="font-semibold text-primary hover:underline">
                  «{e.itemTitle.length > 60 ? `${e.itemTitle.slice(0, 60)}…` : e.itemTitle}»
                </button>
              </p>
              <p className="text-[10px] text-outline">{new Date(e.timestamp).toLocaleString("ru-RU")}</p>
            </div>
          </li>
        ))}
      </ul>
      {events.length > limit && (
        <button onClick={() => setLimit((l) => l + 20)} className="mt-3 text-[12px] font-semibold text-primary hover:underline">
          Показать ещё
        </button>
      )}
    </div>
  );
}
