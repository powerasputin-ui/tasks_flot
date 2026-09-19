"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Row = {
  id: string;
  type: "TRACK" | "TASK" | "VESSEL_OPTION";
  segmentName: string | null;
  trackId: string;
  trackName: string;
  name: string;
  attractivenessName: string | null;
  ownerName: string | null;
  deadline: string | null;
  statusName: string | null;
  operFlag: boolean;
};

const TYPE_LABEL = { TRACK: "Трек", TASK: "Задача", VESSEL_OPTION: "Судно" } as const;
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function HistoryPage() {
  const [date, setDate] = useState(todayStr());
  const [type, setType] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    setError(false);
    fetch(`/api/history?date=${date}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRows(d.rows))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [date]);

  const shown = type ? rows.filter((r) => r.type === type) : rows;

  return (
    <div className="w-full px-6 py-6">
      <div className="animate-fade-in mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">Состояние на дату</h1>
          <p className="mt-0.5 max-w-3xl text-[13px] text-neutral-500">
            Раздел 30 ТЗ (Time Travel). Восстанавливается из журнала изменений: показываются записи, существовавшие на выбранный день, с
            значениями на тот момент. Изменения до начала ведения журнала (например, до импорта из Excel) недоступны.
          </p>
        </div>
        <div className="flex gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-neutral-500">Дата</label>
            <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-neutral-500">Тип</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="select">
              <option value="">Все</option>
              <option value="TRACK">Трек</option>
              <option value="TASK">Задача</option>
              <option value="VESSEL_OPTION">Судно</option>
            </select>
          </div>
        </div>
      </div>

      {error && <p className="mb-3 text-[13px] text-[var(--danger)]">Не удалось загрузить состояние на выбранную дату.</p>}

      <div className="surface overflow-hidden">
        <table className="w-full text-[13px]" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              {["Тип", "Сегмент", "Трек", "Название", "Привлекательность", "Ответственный", "Срок", "Статус", "Опер"].map((h) => (
                <th key={h} className="px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-neutral-400">Загрузка…</td></tr>
            )}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-14 text-center text-neutral-400">На эту дату записей нет.</td></tr>
            )}
            {!loading &&
              shown.map((r) => (
                <tr key={`${r.type}-${r.id}`} className="row-hover border-b border-[var(--border)] last:border-0">
                  <td className="truncate px-4 py-2.5 text-neutral-500">{TYPE_LABEL[r.type]}</td>
                  <td className="truncate px-4 py-2.5">{r.segmentName ?? "—"}</td>
                  <td className="truncate px-4 py-2.5">
                    <Link href={`/tracks/${r.trackId}`} className="link-subtle">{r.trackName}</Link>
                  </td>
                  <td className="truncate px-4 py-2.5" title={r.name}>{r.name}</td>
                  <td className="truncate px-4 py-2.5">{r.type === "TASK" ? "—" : r.attractivenessName ?? "P0"}</td>
                  <td className="truncate px-4 py-2.5">{r.ownerName ?? "—"}</td>
                  <td className="truncate px-4 py-2.5">{r.deadline ? new Date(r.deadline).toLocaleDateString("ru-RU") : "—"}</td>
                  <td className="truncate px-4 py-2.5">{r.statusName ?? "—"}</td>
                  <td className="truncate px-4 py-2.5">{r.type === "VESSEL_OPTION" ? "—" : r.operFlag ? "да" : "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!loading && <p className="mt-2 text-[11px] text-neutral-400">Записей: {shown.length}</p>}
    </div>
  );
}
