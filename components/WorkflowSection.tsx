"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Lock, RotateCcw, Send, ShieldAlert, Star, Undo2, Unlock, XCircle } from "lucide-react";
import { ACTION_LABEL, availableActions, type WorkflowAction } from "@/lib/workflow";
import type { TrackerColumnKey } from "@/lib/tracker";

const ru = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Europe/Moscow" }) : "—");

type Review = { id: string; submittedByName: string; submittedAt: string; result: string; decision: string | null; decidedByName: string | null; decidedAt: string | null; comment: string | null };
type Info = { reviews: Review[]; publication: { publishedAt: string; publishedByName: string; reason: string } | null };

export type WorkflowRow = {
  id: string;
  version: number;
  ownerId: string | null;
  createdById: string;
  archived: boolean;
  blockedBy?: string | null;
  blockedUntil?: string | null;
  cancelReason?: string | null;
  origin?: string | null;
  assignedByName?: string | null;
  zgdControl?: boolean;
  originalDeadline?: string | null;
  deadline: string | null;
};

const ICON: Record<WorkflowAction, typeof Send> = { submit: Send, accept: CheckCircle2, return: Undo2, block: Lock, unblock: Unlock, cancel: XCircle, reopen: RotateCcw };
// что спросить в диалоге действия
export const ASK: Partial<Record<WorkflowAction, { field: "result" | "comment" | "blockedBy" | "reason"; label: string; placeholder: string; optional?: boolean }>> = {
  submit: { field: "result", label: "Результат", placeholder: "Что сделано и где посмотреть (документ, письмо, решение)" },
  accept: { field: "comment", label: "Комментарий (необязательно)", placeholder: "Например: принято, доложить на ОС", optional: true },
  return: { field: "comment", label: "Что доработать", placeholder: "Чего не хватает в результате" },
  block: { field: "blockedBy", label: "На чём ждём", placeholder: "Чьё решение / документ / поставка" },
  cancel: { field: "reason", label: "Причина отмены", placeholder: "Почему задача больше не нужна" },
  reopen: { field: "reason", label: "Почему снова в работе", placeholder: "Что изменилось" },
};

/**
 * «Ход работы» в карточке позиции: состояние по трекеру и действия — сдать на проверку, принять / вернуть (директор),
 * заблокировать / снять блок, отменить / переоткрыть (директор). Права и обязательные поля — lib/workflow.ts (сервер проверяет то же).
 */
export function WorkflowSection({ row, column, actor, readOnly, onChanged }: { row: WorkflowRow; column: TrackerColumnKey; actor: { id: string; role: string } | null; readOnly?: boolean; onChanged: (row: unknown) => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [open, setOpen] = useState<WorkflowAction | null>(null);
  const [text, setText] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/items/${row.id}/workflow`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setInfo(d));
  }, [row.id]);
  useEffect(load, [load]);

  const actions = actor && !readOnly ? availableActions({ id: actor.id, role: actor.role as never }, { column, responsibleId: row.ownerId, createdById: row.createdById, blocked: !!row.blockedBy, archived: row.archived }) : [];
  const last = info?.reviews[0] ?? null;

  async function run(action: WorkflowAction) {
    setBusy(true);
    setError(null);
    const ask = ASK[action];
    const body: Record<string, unknown> = { action, version: row.version };
    if (ask) body[ask.field] = text;
    if (action === "block" && until) body.blockedUntil = until;
    const res = await fetch(`/api/items/${row.id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(d?.message ?? "Не удалось выполнить действие.");
    setOpen(null);
    setText("");
    setUntil("");
    load();
    onChanged(d.row);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {row.origin === "ZGD" && <span className="rounded-sm bg-[#7c3aed]/10 px-1.5 py-0.5 font-semibold text-[#7c3aed]">поручение ЗГД{row.assignedByName ? ` · ${row.assignedByName}` : ""}</span>}
        {row.zgdControl && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-status-amber/15 px-1.5 py-0.5 font-semibold text-[#b45309]">
            <Star size={11} /> на контроле ЗГД — срок переносится только с согласия директора
          </span>
        )}
        {row.originalDeadline && row.deadline && row.originalDeadline.slice(0, 10) !== row.deadline.slice(0, 10) && (
          <span className="rounded-sm bg-surface-high px-1.5 py-0.5 text-on-surface-variant">исходный срок {ru(row.originalDeadline)}</span>
        )}
        {info?.publication && <span className="rounded-sm bg-primary-soft px-1.5 py-0.5 text-primary" title={`${info.publication.reason} — ${info.publication.publishedByName}`}>для ЗГД подтверждено {ru(info.publication.publishedAt)}</span>}
      </div>

      {row.blockedBy && (
        <p className="flex items-start gap-2 rounded-md bg-status-red/10 px-3 py-2 text-[13px] text-status-red">
          <ShieldAlert size={15} className="mt-0.5 shrink-0" /> Заблокировано: ждём {row.blockedBy}
          {row.blockedUntil ? ` (ожидаем к ${ru(row.blockedUntil)})` : ""}
        </p>
      )}
      {column === "HIDDEN" && row.cancelReason && <p className="rounded-md bg-surface-high px-3 py-2 text-[13px] text-on-surface-variant">Отменена: {row.cancelReason}</p>}
      {last && (
        <div className="rounded-md border border-outline-variant px-3 py-2 text-[13px]">
          <p className="text-on-surface-variant">
            Сдано на проверку {ru(last.submittedAt)} — {last.submittedByName}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-on-surface [overflow-wrap:anywhere]">{last.result}</p>
          {last.decision && (
            <p className={`mt-1.5 ${last.decision === "ACCEPTED" ? "text-status-emerald" : "text-status-red"}`}>
              {last.decision === "ACCEPTED" ? "Принято" : "Возвращено на доработку"} {ru(last.decidedAt)} — {last.decidedByName}
              {last.comment ? `: ${last.comment}` : ""}
            </p>
          )}
          {!last.decision && column === "REVIEW" && <p className="mt-1.5 text-[#b45309]">Ждёт решения директора</p>}
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => {
            const Icon = ICON[a];
            return (
              <button
                key={a}
                onClick={() => (ASK[a] ? (setOpen(open === a ? null : a), setText(""), setError(null)) : void run(a))}
                disabled={busy}
                className={a === "accept" ? "btn-success h-8" : a === "submit" ? "btn-primary h-8" : a === "cancel" || a === "return" ? "btn-ghost h-8 text-status-red" : "btn-ghost h-8"}
              >
                <Icon size={14} /> {ACTION_LABEL[a]}
              </button>
            );
          })}
        </div>
      )}

      {open && ASK[open] && (
        <div className="space-y-2 rounded-md border border-outline-variant bg-surface-low p-3">
          <label className="block text-[12px] font-semibold text-on-surface-variant">{ASK[open]!.label}</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} placeholder={ASK[open]!.placeholder} className="input w-full" autoFocus />
          {open === "block" && (
            <label className="flex items-center gap-2 text-[12px] text-on-surface-variant">
              Ожидаем к <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="input w-40" />
            </label>
          )}
          {error && <p className="text-[12px] text-status-red">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => void run(open)} disabled={busy || (!ASK[open]!.optional && text.trim().length < 3)} className="btn-primary h-8">
              {busy ? "Сохраняю…" : ACTION_LABEL[open]}
            </button>
            <button onClick={() => setOpen(null)} className="btn-ghost h-8">Отмена</button>
          </div>
        </div>
      )}
      {!open && error && <p className="text-[12px] text-status-red">{error}</p>}
    </div>
  );
}
