"use client";

import { Fragment, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Send } from "lucide-react";
import { ExpandableText } from "@/components/ui/ExpandableText";
import { StatusPill } from "@/components/ui/Badge";
import { groupLevelLabel, type ReportGroup, type ReportModel, type ReportRow, type StatusCount } from "@/lib/report";

/** «Статус текущих задач»: общая сводка плитками — всего, по каждому статусу (в его цвете), просрочено, отправлено. */
export function SummaryTiles({ model }: { model: ReportModel }) {
  const s = model.summary;
  return (
    <div>
      <h2 className="label-caps mb-2">Статус текущих задач</h2>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Tile label="Всего задач" value={s.total} />
        {s.byStatus.map((st) => (
          <Tile key={st.name} label={st.name} value={st.count} color={st.color} />
        ))}
        <Tile label="Просрочено" value={s.overdue} tone={s.overdue > 0 ? "red" : undefined} icon={<AlertTriangle size={14} />} />
        <Tile label="Отправлено куратору" value={s.sent} icon={<Send size={14} />} />
      </div>
      {s.byAttractiveness.length > 0 && (
        <p className="mt-2 text-[12px] text-on-surface-variant">
          По привлекательности:{" "}
          {s.byAttractiveness.map((a, i) => (
            <span key={a.name}>
              {i > 0 && " · "}
              {a.name}
              {a.label ? ` (${a.label.toLowerCase()})` : ""} — {a.count}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function Tile({ label, value, color, tone, icon }: { label: string; value: number; color?: string | null; tone?: "red"; icon?: React.ReactNode }) {
  return (
    <div className="surface min-w-[120px] shrink-0 px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 text-[12px] text-on-surface-variant">
        {color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} /> : icon}
        <span className="truncate">{label}</span>
      </div>
      <p className={`mt-1 text-[24px] font-bold leading-none tracking-tight ${tone === "red" ? "text-status-red" : "text-on-surface"}`}>{value}</p>
    </div>
  );
}

/** Узкая полоса «сколько в каком статусе» для заголовка группы. */
function StatusBar({ items, total }: { items: StatusCount[]; total: number }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-2 w-28 shrink-0 overflow-hidden rounded-full bg-surface-high" title={items.map((i) => `${i.name}: ${i.count}`).join(", ")}>
        {items.map((i) => (
          <span key={i.name} style={{ width: `${(i.count / total) * 100}%`, background: i.color ?? "#94a3b8" }} />
        ))}
      </div>
      <span className="hidden truncate text-[11px] text-on-surface-variant md:inline">{items.map((i) => `${i.name} ${i.count}`).join(" · ")}</span>
    </div>
  );
}

/** Дерево отчёта: разворачиваемые группы (Сегмент → Трек …) и задачи. */
export function ReportTree({ model }: { model: ReportModel }) {
  // «Свернуть/развернуть всё»: меняем ключ блоков, чтобы они пересоздались с нужным начальным состоянием
  const [expand, setExpand] = useState({ open: true, n: 0 });
  if (model.groups) {
    if (model.groups.length === 0) return <Empty />;
    return (
      <div>
        <div className="mb-2 flex items-center justify-between text-[12px] text-on-surface-variant">
          <span>Позиций: {model.summary.total}</span>
          <span className="flex gap-3">
            <button onClick={() => setExpand((e) => ({ open: true, n: e.n + 1 }))} className="font-semibold text-primary hover:underline">Развернуть всё</button>
            <button onClick={() => setExpand((e) => ({ open: false, n: e.n + 1 }))} className="font-semibold text-primary hover:underline">Свернуть всё</button>
          </span>
        </div>
        <div className="space-y-3">
          {model.groups.map((g) => (
            <GroupBlock key={`${g.key}:${expand.n}`} group={g} model={model} depth={0} defaultOpen={expand.open} />
          ))}
        </div>
      </div>
    );
  }
  if (!model.rows || model.rows.length === 0) return <Empty />;
  return (
    <div className="surface overflow-x-auto">
      <RowsTable rows={model.rows} model={model} />
    </div>
  );
}

function Empty() {
  return <p className="surface p-6 text-center text-[13px] text-on-surface-variant">По выбранным условиям задач нет.</p>;
}

function GroupBlock({ group, model, depth, defaultOpen }: { group: ReportGroup; model: ReportModel; depth: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const top = depth === 0;
  return (
    <section className={top ? "surface overflow-hidden" : "border-t border-outline-variant/60"}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 px-4 text-left transition-colors hover:bg-surface-low ${top ? "bg-surface-low py-3" : "py-2.5"}`}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={16} className="shrink-0 text-outline" /> : <ChevronRight size={16} className="shrink-0 text-outline" />}
        <span className="text-[11px] font-bold uppercase tracking-wide text-outline">{groupLevelLabel(group.level)}</span>
        <span className={`min-w-0 truncate ${top ? "text-[14px] font-semibold" : "text-[13px] font-medium"} text-on-surface`}>{group.label}</span>
        <span className="shrink-0 rounded-full bg-surface-high px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">{group.count}</span>
        <span className="ml-auto min-w-0">
          <StatusBar items={group.byStatus} total={group.count} />
        </span>
      </button>
      {open && (
        <div className={depth > 0 || top ? "pl-0" : ""}>
          {group.groups?.map((g) => (
            <div key={g.key} className="pl-4">
              <GroupBlock group={g} model={model} depth={depth + 1} defaultOpen={defaultOpen} />
            </div>
          ))}
          {group.rows && (
            <div className="overflow-x-auto">
              <RowsTable rows={group.rows} model={model} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RowsTable({ rows, model }: { rows: ReportRow[]; model: ReportModel }) {
  if (model.columns.length === 0) return null;
  return (
    <table className="w-full min-w-[640px] border-collapse text-[13px]">
      <thead>
        <tr className="border-t border-outline-variant/60">
          {model.columns.map((c) => (
            <th key={c.key} className="label-caps px-4 py-2 text-left">{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Fragment key={r.id}>
            <tr className="border-t border-outline-variant/40 align-top">
              {model.columns.map((c) => (
                <td key={c.key} className={`px-4 py-2 ${c.key === "name" ? "min-w-56" : ""} ${c.key === "deadline" && r.overdue ? "font-semibold text-status-red" : "text-on-surface"}`}>
                  {c.key === "status" && r.cells[c.key] !== "—" ? (
                    <StatusPill name={r.cells[c.key]} color={r.statusColor} />
                  ) : c.key === "comment" ? (
                    r.cells[c.key] !== "—" ? <ExpandableText text={r.cells[c.key]} lines={3} /> : <span className="text-outline">—</span>
                  ) : c.key === "name" ? (
                    <span className={r.archived ? "text-outline" : ""} style={{ overflowWrap: "anywhere" }}>{r.cells[c.key]}</span>
                  ) : (
                    <span style={{ overflowWrap: "anywhere" }}>{r.cells[c.key]}</span>
                  )}
                </td>
              ))}
            </tr>
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
