"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, MessageSquare, Smartphone } from "lucide-react";
import { loadBootstrap } from "@/lib/client-bootstrap";
import { useInstall } from "@/components/PwaRegister";
import { buildToday, type TodayHot, type TodayRow, type TodaySection } from "@/lib/today";
import type { TrackerColumnKey } from "@/lib/tracker";
import { DirectoratesTab, OrdersTab, TrendTab, type ZgdAnalytics } from "@/components/today/ZgdTabs";

// вкладки «Моего дня» ЗГД: что требует внимания сейчас · где хуже нормы · лучше или хуже · что не исполнено
const ZGD_TABS = [
  { key: "today", label: "Сегодня" },
  { key: "dirs", label: "Дирекции" },
  { key: "trend", label: "Динамика" },
  { key: "orders", label: "Поручения" },
] as const;
type ZgdTab = (typeof ZGD_TABS)[number]["key"];

type Status = { id: string; name: string; trackerColumn: TrackerColumnKey | null };
type Data = { rows: TodayRow[]; statuses: Status[]; hot: TodayHot };

const TONE: Record<TodaySection["tone"], { bar: string; count: string }> = {
  red: { bar: "border-l-status-red", count: "bg-status-red/10 text-status-red" },
  amber: { bar: "border-l-status-amber", count: "bg-status-amber/15 text-[#b45309]" },
  primary: { bar: "border-l-primary", count: "bg-primary-soft text-primary" },
  grey: { bar: "border-l-outline", count: "bg-surface-high text-on-surface-variant" },
};
const SHOWN = 8;

/** «Мой день»: что требует внимания сегодня — по роли (lib/today.ts): просрочено, срок скоро, ждёт решения, запросы; плюс непрочитанный чат. */
export function TodayView() {
  const [role, setRole] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const install = useInstall();
  const [tab, setTab] = useState<ZgdTab>("today");
  const [zgd, setZgd] = useState<ZgdAnalytics | null>(null);
  const [zgdError, setZgdError] = useState<string | null>(null);
  const zgdRole = role === "EXECUTIVE";
  const showToday = !zgdRole || tab === "today";

  // вкладка — в адресе (?tab=), чтобы ссылку можно было переслать и она переживала перезагрузку
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (ZGD_TABS.some((x) => x.key === t)) setTab(t as ZgdTab);
  }, []);
  const pickTab = (t: ZgdTab) => {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "today") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  };
  // аналитика ЗГД — по первому заходу на вкладку (считается на сервере только из подтверждённого)
  useEffect(() => {
    if (!zgdRole || tab === "today" || zgd || zgdError) return;
    let stop = false;
    void (async () => {
      const res = await fetch("/api/today/zgd").catch(() => null);
      if (stop) return;
      if (!res?.ok) return setZgdError("Не удалось загрузить аналитику.");
      setZgd(await res.json());
    })();
    return () => {
      stop = true;
    };
  }, [zgdRole, tab, zgd, zgdError]);

  useEffect(() => {
    let stop = false;
    void (async () => {
      const boot = await loadBootstrap().catch(() => null);
      if (stop || !boot?.user) return;
      setRole(boot.user.role);
      setMeId(boot.user.id);
      try {
        const res = await fetch("/api/tracker");
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        if (!stop) {
          // у ЗГД трекер показывает и отключённые дирекции (архив), а в «Моём дне» — только действующие, как во вкладке «Дирекции»
          const active = d.mode === "sent" && Array.isArray(d.directorates) ? new Set((d.directorates as Array<{ id: string }>).map((x) => x.id)) : null;
          setData({ rows: active ? (d.rows as TodayRow[]).filter((r) => !r.directorateId || active.has(r.directorateId)) : d.rows, statuses: d.statuses, hot: d.hot });
          setNow(Date.now());
        }
      } catch {
        if (!stop) setError("Не удалось загрузить данные. Обновите страницу.");
      }
      const u = await fetch("/api/chat/unread").then((r) => (r.ok ? r.json() : { unread: 0 })).catch(() => ({ unread: 0 }));
      if (!stop) setUnread(u.unread ?? 0);
    })();
    return () => {
      stop = true;
    };
  }, []);

  const sections = useMemo(() => {
    if (!data || !role || !meId) return null;
    return buildToday({ role, meId, rows: data.rows, hot: data.hot, colOf: new Map(data.statuses.map((s) => [s.id, s.trackerColumn])), now });
  }, [data, role, meId, now]);

  const date = new Date(now).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Moscow" });
  const total = sections?.reduce((s, x) => s + x.items.length, 0) ?? 0;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6 max-md:p-3">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-[20px] font-bold text-on-surface">Мой день</h1>
        <p className="mt-0.5 text-[13px] text-on-surface-variant first-letter:uppercase">{date}</p>

        {zgdRole && (
          <div role="tablist" aria-label="Разделы «Моего дня»" className="mt-4 flex gap-1 overflow-x-auto border-b border-outline-variant">
            {ZGD_TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => pickTab(t.key)} className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === t.key ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-on-surface"}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        {zgdRole && tab !== "today" && (
          <div className="mt-4">
            {zgdError && (
              <p className="flex items-center gap-3 rounded-md bg-status-red/10 px-3 py-2 text-[13px] text-status-red">
                {zgdError}
                <button onClick={() => setZgdError(null)} className="ml-auto font-semibold underline">
                  Повторить
                </button>
              </p>
            )}
            {!zgd && !zgdError && <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="skeleton h-32 w-full rounded-lg" />)}</div>}
            {zgd && tab === "dirs" && <DirectoratesTab data={zgd} now={now} />}
            {zgd && tab === "trend" && <TrendTab data={zgd} />}
            {zgd && tab === "orders" && <OrdersTab data={zgd} />}
          </div>
        )}

        {showToday && unread > 0 && (
          <button onClick={() => window.dispatchEvent(new CustomEvent("chat:open"))} className="mt-4 flex w-full items-center gap-3 rounded-lg border border-outline-variant bg-surface px-4 py-3 text-left hover:bg-surface-low">
            <MessageSquare size={18} className="shrink-0 text-primary" />
            <span className="text-[13px] font-semibold text-on-surface">Непрочитанных сообщений в чате: {unread}</span>
            <span className="ml-auto text-[12px] font-semibold text-primary">Открыть чат</span>
          </button>
        )}

        {showToday && error && <p className="mt-4 rounded-md bg-status-red/10 px-3 py-2 text-[13px] text-status-red">{error}</p>}
        {showToday && !sections && !error && <div className="mt-4 space-y-3">{[0, 1].map((i) => <div key={i} className="skeleton h-28 w-full rounded-lg" />)}</div>}

        {showToday && sections && total === 0 && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-outline-variant bg-surface px-4 py-6">
            <CheckCircle2 size={28} className="shrink-0 text-status-emerald" />
            <div>
              <p className="text-[14px] font-semibold text-on-surface">На сегодня всё спокойно</p>
              <p className="text-[12px] text-on-surface-variant">Просроченного нет, срочных сроков нет, решений ждать не от кого. Все задачи — в «Трекере».</p>
            </div>
          </div>
        )}

        {showToday && sections && total > 0 && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {sections.map((s) => {
              const all = !!open[s.key];
              const shown = all ? s.items : s.items.slice(0, SHOWN);
              return (
                <section key={s.key} className={`surface overflow-hidden border-l-4 ${TONE[s.tone].bar}`}>
                  <header className="flex items-start justify-between gap-2 px-4 pt-3">
                    <div className="min-w-0">
                      <h2 className="text-[14px] font-bold text-on-surface">{s.title}</h2>
                      <p className="text-[11px] text-on-surface-variant">{s.hint}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-bold ${TONE[s.tone].count}`}>{s.items.length}</span>
                  </header>
                  <ul className="mt-2">
                    {shown.map((i) => (
                      <li key={i.id} className="border-t border-outline-variant/50">
                        <Link href={`/tracker?item=${i.id}`} className="row-hover block px-4 py-2">
                          <span className="line-clamp-2 text-[13px] font-medium text-on-surface [overflow-wrap:anywhere]">{i.name}</span>
                          <span className="mt-0.5 block text-[12px] text-on-surface-variant">
                            {i.note}
                            {role !== "HEAD" && i.ownerName ? ` · ${i.ownerName}` : ""}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {s.items.length > SHOWN && (
                    <button onClick={() => setOpen((o) => ({ ...o, [s.key]: !all }))} className="w-full border-t border-outline-variant/50 px-4 py-2 text-left text-[12px] font-semibold text-primary hover:bg-surface-low">
                      {all ? "Свернуть" : `Показать все (${s.items.length})`}
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {showToday && sections && !install.standalone && (install.canInstall || install.ios) && (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-dashed border-outline px-4 py-3">
            <Smartphone size={18} className="mt-0.5 shrink-0 text-on-surface-variant" />
            <div className="min-w-0 flex-1 text-[12px] text-on-surface-variant">
              <p className="font-semibold text-on-surface">Установите как приложение</p>
              {install.canInstall ? <p>Откроется без адресной строки, ярлык — на рабочем столе или экране «Домой».</p> : <p>На iPhone: кнопка «Поделиться» → «На экран “Домой”».</p>}
            </div>
            {install.canInstall && (
              <button onClick={() => void install.install()} className="btn-ghost h-8 shrink-0">
                <Download size={14} /> Установить
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
