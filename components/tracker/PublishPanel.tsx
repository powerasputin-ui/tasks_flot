"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";

type Changed = { id: string; title: string; changes: string[] };

/**
 * «Обновить для ЗГД» — предпросмотр перед подтверждением: какие задачи изменились и что именно. Директор выбирает,
 * что ЗГД увидит. Это не одобрение работы (принять — кнопкой «Принять» в задаче), а подтверждение актуальности данных.
 */
export function PublishPanel({ onClose, onOpen, onDone }: { onClose: () => void; onOpen: (id: string) => void; onDone: (n: number) => void }) {
  const [list, setList] = useState<Changed[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tracker/publish")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { items: Changed[] }) => {
        setList(d.items);
        setPicked(new Set(d.items.map((x) => x.id)));
      })
      .catch(() => setError("Не удалось загрузить изменения."));
  }, []);

  async function send() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/tracker/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemIds: [...picked] }) });
    const d = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(d?.message ?? "Не удалось подтвердить.");
    onDone(d.published);
  }

  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <Panel title="Показать ЗГД изменения" subtitle="ЗГД видит только подтверждённое вами. Это не одобрение работы — принять задачу можно только кнопкой «Принять»." onClose={onClose} width={520}>
      <div className="space-y-3 px-5 py-4 text-[13px]">
        {!list && !error && <div className="skeleton h-24 w-full rounded" />}
        {list && list.length === 0 && <p className="text-on-surface-variant">Изменений нет — ЗГД видит актуальное состояние всех задач.</p>}
        {list && list.length > 0 && (
          <>
            <div className="flex items-center justify-between text-[12px] text-on-surface-variant">
              <span>Изменено после прошлого подтверждения: {list.length}</span>
              <button onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((x) => x.id)))} className="link-subtle">
                {picked.size === list.length ? "Снять все" : "Выбрать все"}
              </button>
            </div>
            <ul className="divide-y divide-outline-variant/60 rounded-md border border-outline-variant">
              {list.map((x) => (
                <li key={x.id} className="flex gap-3 px-3 py-2">
                  <input type="checkbox" checked={picked.has(x.id)} onChange={() => toggle(x.id)} className="mt-1" aria-label={`Показать ЗГД: ${x.title}`} />
                  <div className="min-w-0 flex-1">
                    <button onClick={() => onOpen(x.id)} className="text-left font-medium text-on-surface hover:underline [overflow-wrap:anywhere]">
                      {x.title}
                    </button>
                    <ul className="mt-0.5 text-[12px] text-on-surface-variant">
                      {x.changes.map((c) => (
                        <li key={c}>· {c}</li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && <p className="text-[12px] text-status-red">{error}</p>}
        <div className="flex gap-2">
          <button onClick={() => void send()} disabled={busy || !picked.size} className="btn-primary">
            {busy ? "Подтверждаю…" : `Показать ЗГД выбранные (${picked.size})`}
          </button>
          <button onClick={onClose} className="btn-ghost">Отмена</button>
        </div>
      </div>
    </Panel>
  );
}
