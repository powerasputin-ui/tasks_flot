"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";

type AppError = { id: string; source: string; route: string; message: string; stack: string | null; role: string | null; count: number; firstAt: string; lastAt: string };

const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

/** Настройки → «Ошибки»: журнал ошибок сайта (lib/error-log.ts). Решённую ошибку отмечают — запись удаляется; повторится — появится снова. */
export function ErrorsSettings() {
  const [list, setList] = useState<AppError[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/errors").catch(() => null);
    if (!res?.ok) return setError("Не удалось загрузить журнал.");
    setError(null);
    setList((await res.json()).errors);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(id: string) {
    const res = await fetch(`/api/errors?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setError("Не удалось отметить.");
    setList((l) => l?.filter((e) => e.id !== id) ?? l);
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-on-surface">Ошибки сайта</h2>
          <p className="mt-1 text-[12px] text-on-surface-variant">
            Сбои сервера и браузера за последние 90 дней. Одинаковые склеены: «×N» — сколько раз повторилась. Тексты задач и личные данные сюда не попадают. Раз в сутки админам приходит сводка о новых ошибках.
          </p>
        </div>
        <button onClick={() => void load()} className="btn-ghost h-8 shrink-0" title="Обновить">
          <RefreshCw size={14} /> Обновить
        </button>
      </div>
      {error && <p className="mt-3 text-[13px] text-status-red">{error}</p>}
      {list === null && !error && <div className="skeleton mt-4 h-24 w-full rounded-lg" />}
      {list && list.length === 0 && <p className="mt-4 rounded-lg border border-outline-variant bg-surface px-4 py-6 text-center text-[13px] text-on-surface-variant">Ошибок нет.</p>}
      {list && list.length > 0 && (
        <ul className="surface mt-4 divide-y divide-outline-variant/60">
          {list.map((e) => (
            <li key={e.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <button onClick={() => setOpen((o) => (o === e.id ? null : e.id))} className="text-left text-[13px] font-semibold text-on-surface [overflow-wrap:anywhere] hover:underline">
                    {e.message}
                  </button>
                  <p className="mt-0.5 text-[11px] text-on-surface-variant">
                    <span className={`mr-1.5 rounded-sm px-1.5 py-px font-semibold ${e.source === "SERVER" ? "bg-status-red/10 text-status-red" : "bg-status-amber/15 text-[#b45309]"}`}>{e.source === "SERVER" ? "сервер" : "браузер"}</span>
                    {e.route} · ×{e.count} · впервые {when(e.firstAt)} · последний раз {when(e.lastAt)}
                    {e.role ? ` · роль ${e.role}` : ""}
                  </p>
                  {open === e.id && e.stack && <pre className="mt-2 overflow-x-auto rounded-md bg-surface-low p-2 text-[11px] text-on-surface-variant">{e.stack}</pre>}
                </div>
                <button onClick={() => void resolve(e.id)} className="btn-ghost h-8 shrink-0 text-[12px]" title="Причина устранена — убрать из журнала">
                  <Check size={14} /> Решено
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
