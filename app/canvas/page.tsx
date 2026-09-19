"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  type: "TRACK" | "TASK" | "VESSEL_OPTION";
  segmentId: string | null;
  trackId: string;
  trackName: string;
  name: string;
  ownerName: string | null;
  statusName: string | null;
  statusColor: string | null;
  attractivenessName: string | null;
  attractivenessColor: string | null;
};
type Ref = { id: string; name: string };
type Pos = { x: number; y: number };

const ENTITY = { TRACK: "Track", TASK: "Task", VESSEL_OPTION: "VesselOption" } as const;
const TYPE_LABEL = { TRACK: "Трек", TASK: "Задача", VESSEL_OPTION: "Судно" } as const;
const CARD_H = 92;
const GAP = 10;
const HEADER = 38;
const PAD = 12;
const MIN_LANE = 240;
const keyOf = (r: Row) => `${ENTITY[r.type]}:${r.id}`;

export default function CanvasPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [segments, setSegments] = useState<Ref[]>([]);
  const [saved, setSaved] = useState<Map<string, Pos>>(new Map());
  const [role, setRole] = useState<string | null>(null);
  const [types, setTypes] = useState<Record<Row["type"], boolean>>({ TRACK: true, TASK: false, VESSEL_OPTION: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ key: string; pos: Pos } | null>(null);
  const [width, setWidth] = useState(1200);
  const boxRef = useRef<HTMLDivElement>(null);
  const canArrange = role === "CURATOR";

  const load = useCallback(async () => {
    const [t, s, c, me] = await Promise.all([
      fetch("/api/table").then((r) => r.json()),
      fetch("/api/segments").then((r) => r.json()),
      fetch("/api/canvas").then((r) => r.json()),
      fetch("/api/auth/me").then((r) => (r.ok ? r.json() : { user: null })),
    ]);
    setRows(t.rows ?? []);
    setSegments(s.segments ?? []);
    setSaved(new Map((c.items ?? []).map((i: { entityType: string; entityId: string; x: number; y: number }) => [`${i.entityType}:${i.entityId}`, { x: i.x, y: i.y }])));
    setRole(me.user?.role ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [loading]);

  const lanes = useMemo(() => [...segments.map((s) => ({ id: s.id as string | null, name: s.name })), { id: null, name: "Без сегмента" }], [segments]);
  const laneW = Math.max(MIN_LANE, Math.floor((width - PAD) / lanes.length));
  const cardW = laneW - PAD * 2;

  const visible = useMemo(() => rows.filter((r) => types[r.type]), [rows, types]);

  const layout = useMemo(() => {
    const out = new Map<string, Pos>();
    const counters = new Map<number, number>();
    for (const r of visible) {
      const k = keyOf(r);
      const laneIdx = Math.max(0, lanes.findIndex((l) => l.id === r.segmentId));
      const n = counters.get(laneIdx) ?? 0;
      counters.set(laneIdx, n + 1);
      out.set(k, saved.get(k) ?? { x: laneIdx * laneW + PAD, y: HEADER + n * (CARD_H + GAP) });
    }
    return out;
  }, [visible, lanes, laneW, saved]);

  const height = Math.max(520, ...[...layout.values()].map((p) => p.y + CARD_H + 40));
  const innerW = Math.max(width, lanes.length * laneW + PAD);

  async function persist(r: Row, pos: Pos) {
    const res = await fetch("/api/canvas", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ entityType: ENTITY[r.type], entityId: r.id, x: pos.x, y: pos.y }] }),
    });
    if (res.ok) setSaved((m) => new Map(m).set(keyOf(r), pos));
    else setError(res.status === 403 ? "Расставлять карточки может только Куратор." : "Не удалось сохранить положение карточки.");
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>, r: Row) {
    if (!canArrange || e.button !== 0) return;
    const origin = layout.get(keyOf(r))!;
    const sx = e.clientX;
    const sy = e.clientY;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let moved = false;
    let last = origin;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      last = { x: Math.max(0, Math.round(origin.x + dx)), y: Math.max(0, Math.round(origin.y + dy)) };
      if (moved) setDrag({ key: keyOf(r), pos: last });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDrag(null);
      if (moved) persist(r, last);
      else router.push(`/tracks/${r.trackId}`);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  async function reset() {
    const res = await fetch("/api/canvas", { method: "DELETE" });
    if (res.ok) setSaved(new Map());
  }

  return (
    <div className="w-full px-6 py-6">
      <div className="animate-fade-in mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">Canvas</h1>
          <p className="mt-0.5 max-w-3xl text-[13px] text-neutral-500">
            Визуальный вид тех же данных (раздел 93 ТЗ): карточка ссылается на запись и не хранит своих данных — статус и остальное
            всегда актуальны. {canArrange ? "Перетаскивайте карточки — положение сохраняется." : "Раскладку меняет Куратор."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          {(Object.keys(TYPE_LABEL) as Row["type"][]).map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-1.5 text-neutral-600">
              <input
                type="checkbox"
                checked={types[t]}
                onChange={(e) => setTypes((s) => ({ ...s, [t]: e.target.checked }))}
                className="h-4 w-4 accent-neutral-900"
              />
              {TYPE_LABEL[t]}
            </label>
          ))}
          {canArrange && (
            <button onClick={reset} className="btn-ghost" title="Вернуть автоматическую раскладку по сегментам">
              Сбросить раскладку
            </button>
          )}
        </div>
      </div>

      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-[13px] text-[var(--danger)]">{error}</p>}

      {loading ? (
        <div className="skeleton h-96 rounded-2xl" />
      ) : (
        <div ref={boxRef} className="surface overflow-auto" style={{ maxHeight: "calc(100vh - 190px)" }}>
          <div className="relative select-none" style={{ width: innerW, height }}>
            {lanes.map((l, i) => (
              <div
                key={l.id ?? "none"}
                className={`absolute top-0 border-r border-[var(--border)] ${i % 2 ? "bg-neutral-50/60" : ""}`}
                style={{ left: i * laneW, width: laneW, height }}
              >
                <div className="px-3 py-2 text-[12px] font-semibold text-neutral-700">
                  {l.name}
                  <span className="ml-1.5 font-normal text-neutral-400">{visible.filter((r) => r.segmentId === l.id).length}</span>
                </div>
              </div>
            ))}
            {visible.map((r) => {
              const k = keyOf(r);
              const pos = drag?.key === k ? drag.pos : layout.get(k)!;
              return (
                <div
                  key={k}
                  onPointerDown={(e) => onPointerDown(e, r)}
                  onClick={() => !canArrange && router.push(`/tracks/${r.trackId}`)}
                  className={`surface absolute p-2.5 text-[12px] ${canArrange ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
                    drag?.key === k ? "z-10 shadow-lg" : ""
                  }`}
                  style={{ left: pos.x, top: pos.y, width: cardW, height: CARD_H, touchAction: "none" }}
                  title={r.name}
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">{TYPE_LABEL[r.type]}</span>
                    {r.type !== "TRACK" && <span className="truncate text-[10px] text-neutral-400">{r.trackName}</span>}
                  </div>
                  <div className="line-clamp-2 font-medium leading-snug text-neutral-800">{r.name}</div>
                  <div className="absolute inset-x-2.5 bottom-2 flex items-center gap-1.5 text-[10px]">
                    {r.statusName && (
                      <span className="rounded-full px-1.5 py-0.5 font-medium" style={{ background: `${r.statusColor ?? "#9CA3AF"}1a`, color: r.statusColor ?? "#6B7280" }}>
                        {r.statusName}
                      </span>
                    )}
                    {r.type !== "TASK" && (
                      <span className="rounded-full px-1.5 py-0.5 font-medium" style={{ background: `${r.attractivenessColor ?? "#9CA3AF"}1a`, color: r.attractivenessColor ?? "#6B7280" }}>
                        {r.attractivenessName ?? "P0"}
                      </span>
                    )}
                    {r.ownerName && <span className="ml-auto truncate text-neutral-400">{r.ownerName}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
