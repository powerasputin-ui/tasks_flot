"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { addWeeks, addMonths, format } from "date-fns";

type Row = { id: string; type: "TRACK" | "TASK" | "VESSEL_OPTION"; trackId: string; trackName: string; name: string };
type Change = { field: string; before: string | null; after: string | null };
type Result = {
  period: { label: string; days: number };
  journalEmptyBefore: boolean;
  added: Row[];
  removed: Row[];
  changed: Array<{ row: Row; changes: Change[] }>;
};

const TYPE_LABEL = { TRACK: "Трек", TASK: "Задача", VESSEL_OPTION: "Судно" } as const;

export default function ChangesPage() {
  const [kind, setKind] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(new Date());
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetch(`/api/changes?kind=${kind}&date=${format(anchor, "yyyy-MM-dd")}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [kind, anchor]);

  const step = (dir: -1 | 1) => setAnchor((a) => (kind === "week" ? addWeeks(a, dir) : addMonths(a, dir)));

  return (
    <div className="w-full px-6 py-6">
      <div className="animate-fade-in mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">Изменения за период</h1>
          <p className="mt-0.5 max-w-3xl text-[13px] text-neutral-500">
            Change Engine (раздел 31 ТЗ): сравнение состояния на конец предыдущего периода с состоянием на конец выбранного. Границы
            берутся из календаря — ISO-неделя (пн-вс) или календарный месяц с реальным числом дней.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value as "week" | "month")} className="select">
            <option value="week">Неделя</option>
            <option value="month">Месяц</option>
          </select>
          <button onClick={() => step(-1)} className="btn-ghost px-3" title="Предыдущий период">←</button>
          <button onClick={() => setAnchor(new Date())} className="btn-ghost">Сегодня</button>
          <button onClick={() => step(1)} className="btn-ghost px-3" title="Следующий период">→</button>
        </div>
      </div>

      {error && <p className="text-[13px] text-[var(--danger)]">Не удалось посчитать изменения.</p>}
      {loading && <div className="skeleton h-40 rounded-2xl" />}

      {!loading && data && (
        <>
          <p className="mb-3 text-[14px] font-medium capitalize text-neutral-800">
            {data.period.label} <span className="font-normal normal-case text-neutral-400">· {data.period.days} дн.</span>
          </p>

          {data.journalEmptyBefore && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              До начала этого периода записей в системе нет (журнал изменений ещё не велся), поэтому все существующие записи
              показаны как добавленные.
            </p>
          )}

          <div className="mb-4 grid grid-cols-3 gap-3">
            <Kpi label="Добавлено" value={data.added.length} />
            <Kpi label="Изменено" value={data.changed.length} />
            <Kpi label="Архивировано" value={data.removed.length} />
          </div>

          <Block title={`Изменено (${data.changed.length})`}>
            {data.changed.length === 0 ? (
              <Empty />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {data.changed.map(({ row, changes }) => (
                  <li key={`${row.type}-${row.id}`} className="py-2">
                    <RowLink row={row} />
                    <ul className="mt-1 space-y-0.5 text-[12px] text-neutral-500">
                      {changes.map((c) => (
                        <li key={c.field}>
                          {c.field}: <span className="text-neutral-400">{c.before ?? "—"}</span> →{" "}
                          <span className="text-neutral-800">{c.after ?? "—"}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title={`Добавлено (${data.added.length})`}>
            <RowList rows={data.added} />
          </Block>
          <Block title={`Архивировано (${data.removed.length})`}>
            <RowList rows={data.removed} />
          </Block>
        </>
      )}
    </div>
  );
}

function RowLink({ row }: { row: Row }) {
  return (
    <div className="text-[13px]">
      <span className="mr-2 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">{TYPE_LABEL[row.type]}</span>
      <Link href={`/tracks/${row.trackId}`} className="link-subtle font-medium">{row.name}</Link>
      {row.type !== "TRACK" && <span className="ml-2 text-[11px] text-neutral-400">{row.trackName}</span>}
    </div>
  );
}

function RowList({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return <Empty />;
  return (
    <ul className="divide-y divide-[var(--border)]">
      {rows.map((r) => (
        <li key={`${r.type}-${r.id}`} className="py-1.5"><RowLink row={r} /></li>
      ))}
    </ul>
  );
}

const Empty = () => <p className="text-[13px] text-neutral-400">Нет записей.</p>;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="animate-fade-in mb-5">
      <h2 className="mb-2 text-[13px] font-semibold text-neutral-700">{title}</h2>
      <div className="surface p-4">{children}</div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface p-3">
      <div className="text-2xl font-semibold text-neutral-900">{value}</div>
      <div className="mt-0.5 text-[11px] text-neutral-500">{label}</div>
    </div>
  );
}
