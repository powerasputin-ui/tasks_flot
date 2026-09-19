"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { startOfISOWeek, addWeeks, getISOWeek, format } from "date-fns";

type Row = {
  id: string;
  type: "TRACK" | "TASK" | "VESSEL_OPTION";
  segmentId: string | null;
  segmentName: string | null;
  trackId: string;
  trackName: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  deadline: string | null;
  statusName: string | null;
};
type Ref = { id: string; name: string };

const MAX_CHIPS = 3;

export default function TimelinePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [segments, setSegments] = useState<Ref[]>([]);
  const [users, setUsers] = useState<Ref[]>([]);
  const [segmentId, setSegmentId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/table?type=TASK").then((r) => r.json()),
      fetch("/api/segments").then((r) => r.json()),
      fetch("/api/users").then((r) => r.json()),
    ])
      .then(([t, s, u]) => {
        setRows(t.rows ?? []);
        setSegments(s.segments ?? []);
        setUsers(u.users ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledOnce = useRef(false);

  useEffect(() => {
    const box = scrollRef.current;
    const cur = box?.querySelector<HTMLElement>("th[data-current]");
    if (!box || !cur || scrolledOnce.current) return;
    scrolledOnce.current = true;
    box.scrollLeft = Math.max(0, cur.offsetLeft - 220 - 100);
  });

  const now = new Date();
  const currentWeek = startOfISOWeek(now).getTime();

  const { weeks, tracks } = useMemo(() => {
    const tasks = rows.filter(
      (r) => r.deadline && (!segmentId || r.segmentId === segmentId) && (!ownerId || r.ownerId === ownerId)
    );
    if (tasks.length === 0) return { weeks: [] as Date[], tracks: [] as Array<{ id: string; name: string; cells: Map<number, Row[]> }> };

    const weekOf = (r: Row) => startOfISOWeek(new Date(r.deadline!)).getTime();
    const keys = tasks.map(weekOf);
    let cursor = new Date(Math.min(...keys, currentWeek));
    const last = Math.max(...keys, currentWeek);
    const weeks: Date[] = [];
    while (cursor.getTime() <= last) {
      weeks.push(cursor);
      cursor = addWeeks(cursor, 1);
    }

    const byTrack = new Map<string, { id: string; name: string; cells: Map<number, Row[]> }>();
    for (const t of tasks) {
      if (!byTrack.has(t.trackId)) byTrack.set(t.trackId, { id: t.trackId, name: t.trackName, cells: new Map() });
      const cells = byTrack.get(t.trackId)!.cells;
      const k = weekOf(t);
      cells.set(k, [...(cells.get(k) ?? []), t]);
    }
    return { weeks, tracks: [...byTrack.values()].sort((a, b) => a.name.localeCompare(b.name, "ru")) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, segmentId, ownerId]);

  function chipClass(r: Row): string {
    const closed = r.statusName === "Завершено" || r.statusName === "Не актуально";
    if (closed) return "bg-neutral-100 text-neutral-400 line-through";
    if (new Date(r.deadline!) < now) return "bg-red-50 text-[var(--danger)]";
    return "bg-blue-50 text-blue-800";
  }

  return (
    <div className="w-full px-6 py-6">
      <div className="animate-fade-in mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">Timeline</h1>
          <p className="mt-0.5 text-[13px] text-neutral-500">
            Сроки задач по неделям (тот же набор данных, что в Треках; неделя считается от срока, раздел 14 ТЗ).
          </p>
        </div>
        <div className="flex gap-3">
          <FilterSelect label="Сегмент" value={segmentId} onChange={setSegmentId} options={segments} />
          <FilterSelect label="Ответственный" value={ownerId} onChange={setOwnerId} options={users} />
        </div>
      </div>

      {loading ? (
        <div className="skeleton h-64 rounded-2xl" />
      ) : tracks.length === 0 ? (
        <div className="surface p-6 text-center text-[13px] text-neutral-400">Нет задач со сроком по выбранным фильтрам.</div>
      ) : (
        <div ref={scrollRef} className="surface overflow-x-auto">
          <table className="w-full border-collapse text-[12px]" style={{ tableLayout: "fixed", minWidth: 220 + weeks.length * 100 }}>
            <colgroup>
              <col style={{ width: 220 }} />
              {weeks.map((w) => (
                <col key={w.getTime()} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-[var(--border)] text-[11px] text-neutral-500">
                <th className="sticky left-0 z-[1] bg-white px-3 py-2 text-left font-medium">Трек</th>
                {weeks.map((w) => (
                  <th
                    key={w.getTime()}
                    data-current={w.getTime() === currentWeek ? "true" : undefined}
                    className={`px-2 py-2 text-center font-medium ${w.getTime() === currentWeek ? "bg-amber-50 text-neutral-900" : ""}`}
                  >
                    <div>Нед. {getISOWeek(w)}</div>
                    <div className="text-[10px] font-normal text-neutral-400">{format(w, "dd.MM")}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tracks.map((t) => (
                <tr key={t.id} className="border-b border-[var(--border)] align-top last:border-0">
                  <td className="sticky left-0 z-[1] bg-white px-3 py-2">
                    <Link href={`/tracks/${t.id}`} className="link-subtle font-medium">
                      {t.name}
                    </Link>
                  </td>
                  {weeks.map((w) => {
                    const items = t.cells.get(w.getTime()) ?? [];
                    return (
                      <td key={w.getTime()} className={`px-1.5 py-1.5 ${w.getTime() === currentWeek ? "bg-amber-50/50" : ""}`}>
                        <div className="space-y-1">
                          {items.slice(0, MAX_CHIPS).map((r) => (
                            <Link
                              key={r.id}
                              href={`/tracks/${r.trackId}`}
                              title={`${r.name}\n${new Date(r.deadline!).toLocaleDateString("ru-RU")}${r.ownerName ? " · " + r.ownerName : ""}${r.statusName ? " · " + r.statusName : ""}`}
                              className={`block truncate rounded px-1.5 py-0.5 ${chipClass(r)}`}
                            >
                              {r.name}
                            </Link>
                          ))}
                          {items.length > MAX_CHIPS && (
                            <div className="px-1 text-[10px] text-neutral-400" title={items.slice(MAX_CHIPS).map((r) => r.name).join("\n")}>
                              +{items.length - MAX_CHIPS} ещё
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-neutral-400">
        Синий — в работе, красный — просрочено, серое — завершено/не актуально. Подсвечена текущая неделя.
      </p>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Ref[] }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-neutral-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="select">
        <option value="">Все</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
