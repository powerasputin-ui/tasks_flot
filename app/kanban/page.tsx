"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Ref = { id: string; name: string };

type TableRow = {
  id: string;
  type: "TRACK" | "TASK" | "VESSEL_OPTION";
  segmentName: string | null;
  trackId: string;
  trackName: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  deadline: string | null;
  statusId: string | null;
  statusName: string | null;
  statusColor: string | null;
};

const TYPE_LABEL: Record<TableRow["type"], string> = {
  TRACK: "Трек",
  TASK: "Задача",
  VESSEL_OPTION: "Судно",
};

function stringToColor(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = input.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}

export default function KanbanPage() {
  const [rows, setRows] = useState<TableRow[]>([]);
  const [statuses, setStatuses] = useState<Ref[]>([]);
  const [type, setType] = useState<"" | TableRow["type"]>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOverStatusId, setDragOverStatusId] = useState<string | null>(null);
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    const [rowsRes, statusesRes, meRes] = await Promise.all([
      fetch(`/api/table?${params.toString()}`),
      fetch("/api/statuses"),
      fetch("/api/auth/me"),
    ]);
    if (rowsRes.ok) setRows((await rowsRes.json()).rows);
    if (statusesRes.ok) setStatuses((await statusesRes.json()).statuses);
    if (meRes.ok) setMe((await meRes.json()).user);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const columns = useMemo(
    () => statuses.map((s) => ({ ...s, items: rows.filter((r) => r.statusId === s.id) })),
    [statuses, rows]
  );
  const noStatus = rows.filter((r) => !r.statusId);

  function canDrag(row: TableRow): boolean {
    if (!me) return false;
    if (me.role !== "RESPONSIBLE") return false;
    // VesselOption редактируется владельцем трека, не своим ownerId (раздел 15) —
    // здесь у нас нет trackOwnerId в строке, поэтому для судов разрешаем попытку,
    // сервер сам откажет, если пользователь не владелец трека.
    if (row.type === "VESSEL_OPTION") return true;
    return row.ownerId === me.id;
  }

  async function moveRow(row: TableRow, newStatusId: string) {
    if (row.statusId === newStatusId) return;
    setError(null);
    const endpoint =
      row.type === "TRACK" ? `/api/tracks/${row.id}` : row.type === "TASK" ? `/api/tasks/${row.id}` : `/api/vessel-options/${row.id}`;
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusId: newStatusId }),
    });
    if (!res.ok) {
      setError(
        res.status === 403
          ? "Нет прав менять эту запись — редактировать может только владелец (раздел 35/38 ТЗ)."
          : "Не удалось сохранить изменения. Данные не потеряны. Попробуйте ещё раз."
      );
      return;
    }
    load();
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="animate-fade-in mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">Kanban</h1>
          <p className="mt-0.5 text-[13px] text-neutral-500">
            Тот же набор данных, что в Треках (раздел 107-108 ТЗ) — перетаскивание меняет статус.
          </p>
        </div>
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="select">
          <option value="">Все типы</option>
          <option value="TRACK">Трек</option>
          <option value="TASK">Задача</option>
          <option value="VESSEL_OPTION">Судно</option>
        </select>
      </div>

      {error && (
        <p className="mb-3 animate-fade-in rounded-md bg-red-50 px-3 py-2 text-[13px] text-[var(--danger)]">{error}</p>
      )}

      {loading ? (
        <div className="skeleton h-64 rounded-2xl" />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {noStatus.length > 0 && (
            <KanbanColumn
              title="Без статуса"
              color="#9CA3AF"
              items={noStatus}
              statusId={null}
              canDrag={canDrag}
              onDrop={moveRow}
              dragOver={dragOverStatusId === "none"}
              setDragOver={(v) => setDragOverStatusId(v ? "none" : null)}
            />
          )}
          {columns.map((col) => (
            <KanbanColumn
              key={col.id}
              title={col.name}
              color={undefined}
              items={col.items}
              statusId={col.id}
              canDrag={canDrag}
              onDrop={moveRow}
              dragOver={dragOverStatusId === col.id}
              setDragOver={(v) => setDragOverStatusId(v ? col.id : null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KanbanColumn({
  title,
  items,
  statusId,
  canDrag,
  onDrop,
  dragOver,
  setDragOver,
}: {
  title: string;
  color?: string;
  items: TableRow[];
  statusId: string | null;
  canDrag: (row: TableRow) => boolean;
  onDrop: (row: TableRow, statusId: string) => void;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!statusId) return;
        const data = e.dataTransfer.getData("application/json");
        if (!data) return;
        onDrop(JSON.parse(data) as TableRow, statusId);
      }}
      className={`w-72 shrink-0 rounded-xl border p-2 transition-colors ${
        dragOver ? "border-neutral-400 bg-neutral-50" : "border-[var(--border)] bg-neutral-50/50"
      }`}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-[12px] font-semibold text-neutral-700">{title}</h3>
        <span className="text-[11px] text-neutral-400">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.map((row) => {
          const draggable = canDrag(row);
          return (
            <div
              key={`${row.type}-${row.id}`}
              draggable={draggable}
              onDragStart={(e) => {
                if (!draggable) return;
                e.dataTransfer.setData("application/json", JSON.stringify(row));
              }}
              className={`surface p-2.5 text-[12px] ${draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default opacity-90"}`}
              title={draggable ? "Перетащите, чтобы изменить статус" : "Только владелец может менять статус"}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                  {TYPE_LABEL[row.type]}
                </span>
                {row.segmentName && <span className="truncate text-[10px] text-neutral-400">{row.segmentName}</span>}
              </div>
              <Link href={`/tracks/${row.trackId}`} className="link-subtle block font-medium text-neutral-800">
                {row.name}
              </Link>
              {row.type !== "TRACK" && <div className="mt-0.5 text-[10px] text-neutral-400">{row.trackName}</div>}
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-neutral-400">
                {row.ownerName ? (
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                      style={{ background: stringToColor(row.ownerName) }}
                    >
                      {row.ownerName.charAt(0).toUpperCase()}
                    </span>
                    {row.ownerName}
                  </span>
                ) : (
                  <span>—</span>
                )}
                {row.deadline && <span>{new Date(row.deadline).toLocaleDateString("ru-RU")}</span>}
              </div>
            </div>
          );
        })}
        {items.length === 0 && <p className="px-1 py-2 text-[11px] text-neutral-400">Пусто</p>}
      </div>
    </div>
  );
}
