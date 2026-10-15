"use client";

import { useEffect, useState } from "react";
import { clearBootstrap, loadBootstrap } from "@/lib/client-bootstrap";
import { SYSTEM_STATUSES } from "@/lib/statuses";
import { COLUMN_LABEL, type TrackerColumnKey } from "@/lib/tracker";

type S = { id: string; name: string; trackerColumn: TrackerColumnKey | null };
const KEYS: TrackerColumnKey[] = ["TODO", "DOING", "REVIEW", "DONE", "HIDDEN"];

/** Настройки → Статусы: в какой колонке «Трекера» стоит каждый статус, и показывать ли «Трекер» в меню. */
export function TrackerSettings({ reloadKey }: { reloadKey: number }) {
  const [statuses, setStatuses] = useState<S[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/statuses")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatuses(d?.statuses ?? []));
    loadBootstrap().then((b) => setEnabled(b?.tracker ?? false));
  }, [reloadKey]);

  async function setColumn(s: S, col: TrackerColumnKey) {
    const res = await fetch(`/api/statuses/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackerColumn: col }) });
    if (res.ok) {
      setStatuses((list) => list.map((x) => (x.id === s.id ? { ...x, trackerColumn: col } : x)));
      clearBootstrap();
      setMsg("Колонка сохранена.");
    } else setMsg("Не удалось сохранить колонку.");
  }

  async function toggle(next: boolean) {
    const res = await fetch("/api/tracker", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) });
    if (res.ok) {
      setEnabled(next);
      clearBootstrap();
      setMsg(next ? "«Трекер» показан в меню." : "«Трекер» скрыт из меню у всех. Данные не тронуты.");
    } else setMsg("Не удалось изменить настройку.");
  }

  return (
    <div className="mt-8 max-w-xl">
      <h3 className="text-[15px] font-bold text-on-surface">Трекер</h3>
      <p className="mt-1 text-[13px] text-on-surface-variant">
        Доска «Сделать → В работе → На проверке → Выполнено» строится по статусам таблицы. «Выполнено» ставит и снимает только директор или админ.
      </p>
      {enabled !== null && (
        <label className="mt-3 flex items-center gap-2 text-[13px] text-on-surface">
          <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} /> Показывать «Трекер» в меню
        </label>
      )}
      <ul className="surface mt-3 divide-y divide-outline-variant/60">
        {statuses.map((s) => {
          const fixed = SYSTEM_STATUSES.includes(s.name);
          return (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
              <span className="text-on-surface">{s.name}</span>
              <select
                className="select w-44"
                value={s.trackerColumn ?? "TODO"}
                disabled={fixed}
                title={fixed ? "Системный статус: колонка закреплена" : undefined}
                onChange={(e) => setColumn(s, e.target.value as TrackerColumnKey)}
                aria-label={`Колонка трекера для статуса ${s.name}`}
              >
                {KEYS.map((k) => (
                  <option key={k} value={k}>
                    {COLUMN_LABEL[k]}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      {msg && <p className="mt-2 text-[12px] text-on-surface-variant">{msg}</p>}
    </div>
  );
}
