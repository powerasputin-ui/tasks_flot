"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileDown, Search } from "lucide-react";
import { Highlight } from "@/components/ui/Highlight";
import { HoverText } from "@/components/ui/HoverText";
import { Avatar } from "@/components/ui/Avatar";
import { AttractivenessBadge, StatusPill } from "@/components/ui/Badge";
import { segmentColors } from "@/components/SegmentList";
import { groupBySegment, NO_SEGMENT } from "@/lib/segment-counts";
import { WIDTH, type StdKey } from "@/lib/table-columns";
import { filterArchiveRows, type ArchiveColumn, type ArchiveRow, type ArchiveTable as Table, type ArchiveView } from "@/lib/archive-table";

const MARK_W = 104;
const CUSTOM_W = 150;
const CENTERED = new Set(["cost", "attractiveness", "deadline", "deadlineWeek", "status"]);

/**
 * Таблица оперативки на момент отправки справки — только чтение. Столбцы и их названия — как были в тот день;
 * у каждой строки пометка: подана директору / вошла в справку.
 */
export function ArchiveTable({ versionId, focusItemId }: { versionId: string; focusItemId?: string | null }) {
  const [table, setTable] = useState<Table | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ArchiveView>("all");
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState<string>("");
  const focusRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/memo-archive/${versionId}/table`)
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) setError("Таблица недоступна.");
        else setTable(await r.json());
      })
      .catch(() => alive && setError("Не удалось загрузить таблицу."));
    return () => {
      alive = false;
    };
  }, [versionId]);

  // пришли из пункта справки «показать в таблице» — сбрасываем фильтры, чтобы строка точно была видна, и прокручиваем к ней
  useEffect(() => {
    if (!focusItemId || !table) return;
    setView("all");
    setQ("");
    setSegment("");
  }, [focusItemId, table]);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "center" });
  }, [focusItemId, table, view, q, segment]);

  const rows = useMemo(() => (table ? filterArchiveRows(table.rows, { view, q, segmentId: segment || null }) : []), [table, view, q, segment]);
  const colors = useMemo(() => segmentColors(table?.segments ?? []), [table]);
  const groups = useMemo(() => groupBySegment(rows, (table?.segments ?? []).map((s) => s.id)), [rows, table]);

  if (error) return <p className="surface p-6 text-center text-[13px] text-on-surface-variant">{error}</p>;
  if (!table) return <div className="skeleton h-64 rounded-lg" />;
  if (table.mode === "none")
    return (
      <p className="surface p-6 text-center text-[13px] text-on-surface-variant">
        Для этой редакции справки таблица не сохранялась: её отправили до того, как архив начал хранить таблицу целиком. Таблица есть у последней редакции этой оперативки.
      </p>
    );

  const total = table.rows.length;
  const submitted = table.rows.filter((r) => r.submitted).length;
  const inMemo = table.rows.filter((r) => r.inMemo).length;
  const segmentName = (id: string) => (id === NO_SEGMENT ? "Без сегмента" : table.segments.find((s) => s.id === id)?.name ?? "Сегмент");
  const segmentsInTable = [...new Set(table.rows.map((r) => r.segmentId ?? NO_SEGMENT))];
  const exportHref = (format: string) => {
    const p = new URLSearchParams({ format, view });
    if (q.trim()) p.set("q", q.trim());
    if (segment) p.set("segment", segment);
    return `/api/memo-archive/${versionId}/table?${p.toString()}`;
  };
  const colWidth = (c: ArchiveColumn) => (c.key.startsWith("custom:") ? CUSTOM_W : WIDTH[c.key as StdKey] ?? CUSTOM_W);
  const tableWidth = MARK_W + table.columns.reduce((s, c) => s + colWidth(c), 0);
  const cols = table.columns.length + 1;

  const tabs: Array<{ id: ArchiveView; label: string; n: number }> = [
    { id: "all", label: "Все строки", n: total },
    { id: "submitted", label: "Поданные", n: submitted },
    { id: "memo", label: "В справке", n: inMemo },
  ];

  return (
    <div>
      {table.mode === "submitted" && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-status-amber/40 bg-status-amber/10 px-3 py-2 text-[13px] text-on-surface">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-status-amber" />
          Справку отправили до того, как архив начал хранить таблицу целиком: здесь только строки, поданные директору.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-outline-variant">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={`px-3 py-1.5 text-[13px] ${view === t.id ? "bg-primary-soft font-semibold text-primary" : "text-on-surface-variant hover:bg-surface-high"}`}
            >
              {t.label} <span className="text-[12px] opacity-70">{t.n}</span>
            </button>
          ))}
        </div>
        {segmentsInTable.length > 1 && (
          <select value={segment} onChange={(e) => setSegment(e.target.value)} className="input h-9" aria-label="Сегмент">
            <option value="">Все сегменты</option>
            {segmentsInTable.map((id) => (
              <option key={id} value={id}>
                {segmentName(id)}
              </option>
            ))}
          </select>
        )}
        <div className="relative w-full max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти в таблице" className="input h-9 w-full pl-9" maxLength={200} />
        </div>
        <a href={exportHref("xlsx")} className="btn-ghost ml-auto h-8" download>
          <FileDown size={14} /> Excel
        </a>
      </div>

      <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface shadow-sm">
        <table className="table-fixed border-collapse text-[13px]" style={{ width: tableWidth, minWidth: "100%" }}>
          <colgroup>
            <col style={{ width: MARK_W }} />
            {table.columns.map((c) => (
              <col key={c.key} style={{ width: colWidth(c) }} />
            ))}
          </colgroup>
          <thead className="bg-surface-high">
            <tr>
              <th className="border-r border-outline-variant/60 px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">Подача</th>
              {table.columns.map((c) => (
                <th key={c.key} className="truncate border-r border-outline-variant/60 px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant last:border-r-0" title={c.label}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.id}>
                <tr className="bg-surface-low">
                  <td colSpan={cols} className="border-y border-outline-variant border-l-4 px-4 py-2" style={{ borderLeftColor: colors.get(group.id) ?? "#94a3b8" }}>
                    <span className="text-[12px] font-bold text-on-surface">{segmentName(group.id)}</span>
                    <span className="ml-2 text-[11px] text-on-surface-variant">{group.rows.length} поз.</span>
                  </td>
                </tr>
                {group.rows.map((row) => {
                  const focused = row.id === focusItemId;
                  return (
                    <tr
                      key={row.id}
                      ref={focused ? focusRef : undefined}
                      className={`border-t border-outline-variant/50 ${focused ? "bg-primary-soft outline outline-2 -outline-offset-2 outline-primary" : row.inMemo ? "bg-primary-soft/40" : ""}`}
                    >
                      <td className="px-2 py-3 text-center align-middle">
                        <Marks row={row} />
                      </td>
                      {table.columns.map((c) => (
                        <td key={c.key} className={`px-3 py-3 align-middle text-on-surface ${CENTERED.has(c.key) ? "text-center" : ""} ${c.key === "name" || c.key === "comment" ? "" : "truncate"}`}>
                          <Cell row={row} col={c} q={q} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-[13px] text-on-surface-variant">{total === 0 ? "Таблица была пустой." : "Ничего не найдено."}</p>}
      </div>
    </div>
  );
}

function Marks({ row }: { row: ArchiveRow }) {
  if (row.inMemo) return <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-white">в справке</span>;
  if (row.submitted) return <span className="rounded-full bg-status-amber/15 px-2 py-0.5 text-[11px] font-semibold text-status-amber">подано</span>;
  return <span className="text-outline">—</span>;
}

const ruDate = (v: string) => new Date(v).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

function Cell({ row, col, q }: { row: ArchiveRow; col: ArchiveColumn; q: string }) {
  switch (col.key) {
    case "track":
      return row.trackName ? <Highlight text={row.trackName} query={q} /> : "—";
    case "cost":
      return row.cost ? <Highlight text={row.cost} query={q} /> : "—";
    case "attractiveness":
      return <AttractivenessBadge name={row.attractivenessName} color={row.attractivenessColor} />;
    case "name":
      return <HoverText text={row.name} lines={2} query={q} className="text-[13px] leading-snug text-on-surface" />;
    case "deadline":
      return row.deadline ? ruDate(row.deadline) : "—";
    case "deadlineWeek":
      return row.deadlineWeek ?? "—";
    case "owner":
      return row.ownerName ? (
        <span className="inline-flex items-center gap-2">
          <Avatar name={row.ownerName} size={20} />
          <span className="truncate">
            <Highlight text={row.ownerName} query={q} />
          </span>
        </span>
      ) : (
        "—"
      );
    case "status":
      return <StatusPill name={row.statusName} color={row.statusColor} />;
    case "comment":
      return row.comment ? <HoverText text={row.comment} lines={3} query={q} className="text-[13px] leading-snug text-on-surface" /> : "—";
    default: {
      const v = col.key.startsWith("custom:") ? row.customValues[col.key.slice("custom:".length)] : undefined;
      if (!v) return "—";
      return <Highlight text={col.type === "DATE" ? ruDate(v) : v} query={q} />;
    }
  }
}
