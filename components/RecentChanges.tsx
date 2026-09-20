"use client";

import { useEffect, useMemo, useState } from "react";
import { AuditChange } from "@/components/AuditChange";
import { FilterChip, type Option } from "@/components/FilterChips";
import { HistoryEntry } from "@/components/HistoryEntry";
import { PersonAvatar } from "@/components/ui/Person";
import { FIELD_LABEL } from "@/lib/audit-format";

type Ev = {
  id: string;
  timestamp: string;
  actorId: string | null;
  actorName: string;
  itemId: string;
  itemTitle: string;
  action: string;
  what: string;
  label: string | null;
  before: string | null;
  after: string | null;
};

/** Значение фильтра «Поле» для событий без поля (создание позиции, архив, возврат). */
const NO_FIELD = "__none";
const PAGE = 10;
const STANDARD_FIELDS = ["title", "comment", "cost", "attractivenessId", "responsibleId", "deadline", "statusId", "operFlag", "trackId", "segmentId"];

/**
 * «История изменений» под таблицей: последние правки выбранной выборки с фильтрами по человеку и полю.
 * Люди различаются цветом (аватар и имя), фильтры работают на сервере, поэтому «Показать ещё» остаётся точным.
 */
export function RecentChanges({
  segments,
  refreshKey,
  onOpen,
  people,
  customColumns,
}: {
  segments: string[];
  refreshKey: number;
  onOpen: (itemId: string) => void;
  people: Array<{ id: string; name: string }>;
  customColumns: Array<{ id: string; name: string }>;
}) {
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [actorIds, setActorIds] = useState<string[]>([]);
  const [fields, setFields] = useState<string[]>([]);

  const peopleOptions = useMemo<Option[]>(() => people.map((p) => ({ id: p.id, name: p.name, leading: <PersonAvatar name={p.name} size={18} /> })), [people]);
  const fieldOptions = useMemo<Option[]>(
    () => [
      ...STANDARD_FIELDS.map((f) => ({ id: f, name: FIELD_LABEL[f] ?? f })),
      ...customColumns.map((c) => ({ id: `custom:${c.id}`, name: c.name })),
      { id: NO_FIELD, name: "Создание и архив" },
    ],
    [customColumns]
  );

  useEffect(() => {
    const p = new URLSearchParams({ limit: String(limit + 1) });
    if (segments.length > 0) p.set("segmentIds", segments.join(","));
    if (actorIds.length > 0) p.set("actorIds", actorIds.join(","));
    if (fields.length > 0) p.set("fields", fields.join(","));
    fetch(`/api/items/recent-changes?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setEvents(d.events))
      .catch(() => setEvents([]));
  }, [segments, refreshKey, limit, actorIds, fields]);

  const filtered = actorIds.length > 0 || fields.length > 0;
  // без данных и без фильтров раздел не нужен; при фильтрах остаётся, чтобы их можно было сбросить
  if (events !== null && events.length === 0 && !filtered) return null;

  const shown = events?.slice(0, limit) ?? [];
  const more = events ? Math.max(0, events.length - limit) : 0;

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h4 className="label-caps mr-2">История изменений</h4>
        <FilterChip label="Кто" value={actorIds} options={peopleOptions} onChange={(v) => { setActorIds(v); setLimit(PAGE); }} />
        <FilterChip label="Поле" value={fields} options={fieldOptions} onChange={(v) => { setFields(v); setLimit(PAGE); }} />
        {filtered && (
          <button onClick={() => { setActorIds([]); setFields([]); setLimit(PAGE); }} className="flex h-9 items-center px-2 text-[12px] font-semibold text-primary hover:underline">
            Сбросить
          </button>
        )}
      </div>

      <div className="rounded-lg border border-outline-variant bg-surface px-4 py-4 shadow-sm">
        {events === null ? (
          <ul className="space-y-4">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex gap-3">
                <div className="skeleton h-6 w-6 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3.5 w-2/3 rounded" />
                  <div className="skeleton h-3.5 w-1/3 rounded" />
                </div>
              </li>
            ))}
          </ul>
        ) : shown.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-on-surface-variant">Нет изменений по выбранным условиям.</p>
        ) : (
          <ul>
            {shown.map((e) => (
              <HistoryEntry
                key={e.id}
                actorName={e.actorName}
                timestamp={e.timestamp}
                headline={
                  <>
                    {e.label !== null && e.before !== null ? <>изменил(а) поле «{e.label}» в задаче </> : <>{e.what}: </>}
                    <button onClick={() => onOpen(e.itemId)} className="text-primary hover:underline [overflow-wrap:anywhere]">
                      «{e.itemTitle.length > 80 ? `${e.itemTitle.slice(0, 80)}…` : e.itemTitle}»
                    </button>
                  </>
                }
                detail={e.label !== null && e.before !== null ? <AuditChange before={e.before} after={e.after ?? "—"} /> : undefined}
              />
            ))}
          </ul>
        )}

        {more > 0 && (
          <div className="mt-3 flex justify-center border-t border-outline-variant/50 pt-3">
            <button onClick={() => setLimit((l) => l + 20)} className="btn-ghost h-8">
              Показать ещё
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
