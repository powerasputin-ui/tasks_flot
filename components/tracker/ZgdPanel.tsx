"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { MessageSquare, Star, HelpCircle } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { ruDay, type HotInfo, type TrackerEvent } from "@/lib/tracker";
import type { TRow } from "@/components/tracker/TrackerView";

type Req = { id: string; text: string; createdAt: string; dueAt: string | null; askedByName: string; answer: string | null; answeredByName: string | null; answeredAt: string | null };
type Note = { id: string; text: string; createdAt: string; author: { name: string } };

async function post(body: Record<string, unknown>): Promise<string | null> {
  const r = await fetch("/api/zgd", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.ok) return null;
  return (await r.json().catch(() => null))?.message ?? "Не удалось выполнить действие.";
}

/**
 * Карточка задачи у ЗГД: подтверждённое директором состояние (кем и когда), результат и приёмка, блокер;
 * действия ЗГД — на контроль, запросить статус (со сроком ответа), комментарий. Всё уходит директору (иерархия).
 */
export function ZgdPanel({ row, events, hot, onClose, onChanged }: { row: TRow; events: TrackerEvent[]; hot?: HotInfo; onClose: () => void; onChanged: () => void }) {
  const [info, setInfo] = useState<{ requests: Req[]; notes: Note[] } | null>(null);
  const [mode, setMode] = useState<"request" | "comment" | null>(null);
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [control, setControl] = useState(!!row.zgdControl);

  const load = useCallback(() => {
    fetch(`/api/zgd?itemId=${row.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setInfo(d));
  }, [row.id]);
  useEffect(load, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const err = await post(body);
    setBusy(false);
    if (err) return setError(err);
    setMode(null);
    setText("");
    setDue("");
    load();
    onChanged();
  }

  const rv = row.review;
  const fields: Array<[string, string]> = [
    ["Дирекция", row.directorateName ?? "—"],
    ["Сегмент · трек", [row.segmentName, row.trackName].filter(Boolean).join(" · ") || "—"],
    ["Ответственный", row.ownerName ?? "не назначен"],
    ["Статус", row.statusName ?? "без статуса"],
    ["Срок", row.deadline ? `${ruDay(row.deadline)}${row.originalDeadline && row.originalDeadline.slice(0, 10) !== row.deadline.slice(0, 10) ? ` (исходный ${ruDay(row.originalDeadline)})` : ""}` : "срока нет"],
    ["Ожидаемый результат", row.expectedResult || "не указан"],
  ];
  return (
    <Panel title={row.name} subtitle={`Подтверждено ${row.asOf ? ruDay(row.asOf) : "—"}${row.confirmedBy ? ` · ${row.confirmedBy}` : ""}`} onClose={onClose} width={480}>
      <div className="space-y-4 px-5 py-4 text-[13px]">
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {row.origin === "ZGD" && <span className="rounded-sm bg-[#7c3aed]/10 px-1.5 py-0.5 font-semibold text-[#7c3aed]">поручение ЗГД</span>}
          {control && <span className="rounded-sm bg-status-amber/15 px-1.5 py-0.5 font-semibold text-[#b45309]">на контроле</span>}
        </div>
        {hot && (
          <ul className="space-y-1 rounded-md bg-status-red/10 px-3 py-2 text-status-red">
            {hot.reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 max-sm:grid-cols-1">
          {fields.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-on-surface-variant">{k}</dt>
              <dd className="text-on-surface [overflow-wrap:anywhere]">{v}</dd>
            </Fragment>
          ))}
        </dl>
        {row.blockedBy && <p className="rounded-md bg-status-red/10 px-3 py-2 text-status-red">Заблокировано: ждём {row.blockedBy}{row.blockedUntil ? ` (ожидают к ${ruDay(row.blockedUntil)})` : ""}</p>}
        {row.cancelReason && <p className="rounded-md bg-surface-high px-3 py-2 text-on-surface-variant">Отменена: {row.cancelReason}</p>}
        {rv && (
          <div className="rounded-md border border-outline-variant px-3 py-2">
            <p className="text-on-surface-variant">Сдано на проверку</p>
            <p className="mt-0.5 whitespace-pre-wrap text-on-surface [overflow-wrap:anywhere]">{rv.result}</p>
            {rv.decision && <p className={`mt-1 ${rv.decision === "ACCEPTED" ? "text-status-emerald" : "text-status-red"}`}>{rv.decision === "ACCEPTED" ? "Принято" : "Возвращено"} — {rv.decidedByName}{rv.comment ? `: ${rv.comment}` : ""}</p>}
          </div>
        )}
        {row.comment && <p className="whitespace-pre-wrap text-on-surface [overflow-wrap:anywhere]">{row.comment}</p>}

        {/* действия ЗГД */}
        <div className="flex flex-wrap gap-2">
          <button onClick={async () => { const next = !control; setControl(next); const err = await post({ action: "control", itemId: row.id, on: next }); if (err) { setControl(!next); setError(err); } else onChanged(); }} className={control ? "btn-ghost h-8 text-[#b45309]" : "btn-ghost h-8"}>
            <Star size={14} fill={control ? "currentColor" : "none"} /> {control ? "Снять с контроля" : "На контроль"}
          </button>
          <button onClick={() => { setMode(mode === "request" ? null : "request"); setError(null); }} className="btn-ghost h-8"><HelpCircle size={14} /> Запросить статус</button>
          <button onClick={() => { setMode(mode === "comment" ? null : "comment"); setError(null); }} className="btn-ghost h-8"><MessageSquare size={14} /> Комментарий</button>
        </div>
        {mode && (
          <div className="space-y-2 rounded-md border border-outline-variant bg-surface-low p-3">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={mode === "request" ? 1000 : 2000} className="input w-full" autoFocus placeholder={mode === "request" ? "Что уточнить у директора" : "Комментарий директору и ответственному"} />
            {mode === "request" && (
              <label className="flex items-center gap-2 text-[12px] text-on-surface-variant">
                Ответ нужен к <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="input w-40" />
              </label>
            )}
            <div className="flex gap-2">
              <button disabled={busy || text.trim().length < 3} onClick={() => void act(mode === "request" ? { action: "request", itemId: row.id, text, dueAt: due || null } : { action: "comment", itemId: row.id, text })} className="btn-primary h-8">
                {busy ? "Отправляю…" : mode === "request" ? "Отправить запрос" : "Отправить"}
              </button>
              <button onClick={() => setMode(null)} className="btn-ghost h-8">Отмена</button>
            </div>
          </div>
        )}
        {error && <p className="text-[12px] text-status-red">{error}</p>}

        {!!info?.requests.length && (
          <div>
            <div className="label-caps mb-1">Запросы статуса</div>
            <ul className="space-y-2">
              {info.requests.map((q) => (
                <li key={q.id} className="rounded-md border border-outline-variant px-3 py-2">
                  <p className="text-on-surface">{q.text}</p>
                  <p className="mt-0.5 text-[11px] text-outline">{ruDay(q.createdAt)}{q.dueAt ? ` · ответ к ${ruDay(q.dueAt)}` : ""}</p>
                  {q.answer ? <p className="mt-1 text-status-emerald">{q.answeredByName} ({q.answeredAt ? ruDay(q.answeredAt) : ""}): {q.answer}</p> : <p className="mt-1 text-[#b45309]">Ждём ответа директора</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!!info?.notes.length && (
          <div>
            <div className="label-caps mb-1">Комментарии ЗГД</div>
            <ul className="space-y-1.5">
              {info.notes.map((n) => (
                <li key={n.id}><span className="text-outline">{ruDay(n.createdAt)}</span> {n.text}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <div className="label-caps mb-1">История (подтверждённая)</div>
          <ul className="space-y-1.5">
            {events.map((e, i) => ({ e, i })).sort((a, b) => b.e.at.localeCompare(a.e.at) || a.i - b.i).map(({ e }, k) => (
              <li key={k} className="flex gap-2">
                <span className="w-16 shrink-0 text-outline">{ruDay(e.at)}</span>
                <span className={e.slip ? "font-semibold text-status-red" : "text-on-surface"}>{e.text}{e.who ? <span className="text-outline"> · {e.who}</span> : null}</span>
              </li>
            ))}
            {!events.length && <li className="text-outline">Событий нет.</li>}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

/** «Дать поручение»: дирекция, что сделать, ожидаемый результат, срок. Директор назначит ответственного. */
export function OrderPanel({ directorates, onClose, onDone }: { directorates: Array<{ id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const [dir, setDir] = useState(directorates.length === 1 ? directorates[0].id : "");
  const [title, setTitle] = useState("");
  const [result, setResult] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    const err = await post({ action: "order", directorateId: dir, title, expectedResult: result, deadline: deadline || null });
    setBusy(false);
    if (err) return setError(err);
    onDone();
  }
  return (
    <Panel title="Поручение дирекции" subtitle="Уйдёт директору: он назначит ответственного. Задача сразу на вашем контроле." onClose={onClose} width={480}>
      <div className="space-y-3 px-5 py-4 text-[13px]">
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-on-surface-variant">Дирекция</span>
          <select value={dir} onChange={(e) => setDir(e.target.value)} className="select w-full">
            <option value="">— выберите —</option>
            {directorates.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-on-surface-variant">Что сделать</span>
          <textarea value={title} onChange={(e) => setTitle(e.target.value)} rows={2} maxLength={300} className="input w-full" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-on-surface-variant">Ожидаемый результат</span>
          <textarea value={result} onChange={(e) => setResult(e.target.value)} rows={3} maxLength={2000} className="input w-full" placeholder="По нему директор примет работу: документ, решение, договор…" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-on-surface-variant">Срок</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="input w-44" />
        </label>
        {error && <p className="text-[12px] text-status-red">{error}</p>}
        <div className="flex gap-2">
          <button onClick={() => void send()} disabled={busy || !dir || title.trim().length < 3 || result.trim().length < 3 || !deadline} className="btn-primary">{busy ? "Отправляю…" : "Дать поручение"}</button>
          <button onClick={onClose} className="btn-ghost">Отмена</button>
        </div>
      </div>
    </Panel>
  );
}
