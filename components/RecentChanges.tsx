"use client";

import { useEffect, useState } from "react";
import { AuditChange } from "@/components/AuditChange";

type Ev = {
  id: string;
  timestamp: string;
  actorName: string;
  itemId: string;
  itemTitle: string;
  action: string;
  what: string;
  label: string | null;
  before: string | null;
  after: string | null;
};

/** «История изменений» под таблицей (как блок с точками в образце): последние правки выбранной выборки. */
export function RecentChanges({ segments, refreshKey, onOpen }: { segments: string[]; refreshKey: number; onOpen: (itemId: string) => void }) {
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [limit, setLimit] = useState(10);

  useEffect(() => {
    const p = new URLSearchParams({ limit: String(limit + 1) });
    if (segments.length > 0) p.set("segmentIds", segments.join(","));
    fetch(`/api/items/recent-changes?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setEvents(d.events))
      .catch(() => setEvents([]));
  }, [segments, refreshKey, limit]);

  if (events === null || events.length === 0) return null;
  const shown = events.slice(0, limit);

  return (
    <div className="mt-8">
      <h4 className="label-caps mb-4">История изменений</h4>
      <ul className="space-y-3">
        {shown.map((e) => (
          <li key={e.id}>
            <div className="min-w-0">
              <div className="text-[12px] text-on-surface [overflow-wrap:anywhere]">
                <span className="font-bold">{e.actorName}</span>{" "}
                {e.label !== null && e.before !== null ? (
                  <>
                    изменил(а) поле «{e.label}» в задаче{" "}
                  </>
                ) : (
                  <>{e.what}: </>
                )}
                <button onClick={() => onOpen(e.itemId)} className="text-primary hover:underline [overflow-wrap:anywhere]">
                  «{e.itemTitle.length > 80 ? `${e.itemTitle.slice(0, 80)}…` : e.itemTitle}»
                </button>
              </div>
              {e.label !== null && e.before !== null && <AuditChange before={e.before} after={e.after ?? "—"} />}
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
