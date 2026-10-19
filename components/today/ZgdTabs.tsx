"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BarList, LineChart, SERIES_COLORS, Sparkline, StackBar } from "@/components/charts/charts";
import { RED_SHARE, SMALL_SAMPLE, STALE_DAYS, YELLOW_SHARE, type DirectorateCard, type OrderSegment, type OrdersView, type Tone } from "@/lib/zgd-analytics";

export type ZgdAnalytics = { weeks: number[]; directorates: DirectorateCard[]; orders: OrdersView };

const ru = (iso: string | number) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const daysAgo = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 864e5));

const TONE: Record<Tone, { label: string; dot: string; pill: string; bar: string }> = {
  green: { label: "В норме", dot: "bg-status-emerald", pill: "bg-status-emerald/10 text-status-emerald", bar: "#059669" },
  yellow: { label: "Внимание", dot: "bg-status-amber", pill: "bg-status-amber/15 text-[#b45309]", bar: "#d97706" },
  red: { label: "Много просрочек", dot: "bg-status-red", pill: "bg-status-red/10 text-status-red", bar: "#dc2626" },
  stale: { label: "Нет актуальных данных", dot: "bg-outline", pill: "bg-surface-high text-on-surface-variant", bar: "#94a3b8" },
  empty: { label: "Нет активных задач", dot: "bg-outline", pill: "bg-surface-high text-on-surface-variant", bar: "#94a3b8" },
};
const RULE = `Цвет — по доле просрочек среди активных задач: до ${YELLOW_SHARE * 100}% — в норме, ${YELLOW_SHARE * 100}–${RED_SHARE * 100}% — внимание, больше ${RED_SHARE * 100}% — много просрочек. Только подтверждённое директором.`;

/** Вкладка «Дирекции»: где ситуация хуже нормы. Каждый цвет объясним числами, карточка ведёт к задачам дирекции в трекере. */
export function DirectoratesTab({ data, now }: { data: ZgdAnalytics; now: number }) {
  const fresh = data.directorates.filter((d) => !d.stale);
  const stale = data.directorates.filter((d) => d.stale);
  const bars = [...fresh]
    .filter((d) => d.active > 0)
    .sort((a, b) => b.overdue / b.active - a.overdue / a.active || b.overdue - a.overdue)
    .map((d) => ({ id: d.id, label: d.name, share: d.overdue / d.active, text: `${d.overdue} из ${d.active} · ${pct(d.overdue, d.active)}%`, color: TONE[d.tone].bar, href: `/tracker?org=${d.id}` }));
  return (
    <div className="space-y-5">
      <p className="text-[12px] text-on-surface-variant">{RULE}</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[...fresh, ...stale].map((d) => {
          const t = TONE[d.tone];
          const known = d.trend.filter((p) => p.overdue !== null);
          const lastTwo = known.slice(-2);
          const delta = lastTwo.length === 2 ? lastTwo[1].overdue! - lastTwo[0].overdue! : 0;
          return (
            <Link key={d.id} href={`/tracker?org=${d.id}`} className="surface block p-4 hover:shadow-md" title="Открыть задачи дирекции в трекере">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-[14px] font-bold text-on-surface">{d.name}</span>
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.pill}`}>
                  <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                  {t.label}
                </span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                {d.active === 0 ? (
                  <div className="text-[13px] text-on-surface-variant">Активных задач нет</div>
                ) : (
                <div title="Активные задачи (не «Выполнено» и не «Не актуально»), у которых подтверждённый срок уже прошёл">
                  <div className="text-[22px] font-bold leading-7 text-on-surface tabular-nums">
                    {d.overdue} <span className="text-[14px] font-semibold text-on-surface-variant">из {d.active}</span>
                  </div>
                  <div className="text-[11px] text-on-surface-variant">
                    просрочено{d.active ? ` · ${pct(d.overdue, d.active)}%` : ""}
                    {d.smallSample && <span className="ml-1 rounded-sm bg-surface-high px-1 py-px" title={`Активных задач меньше ${SMALL_SAMPLE}: доля в процентах неустойчива, смотрите числа`}>малая выборка</span>}
                  </div>
                </div>
                )}
                <div className="text-right">
                  <Sparkline values={d.trend.map((p) => p.overdue)} label={`${d.name}: просрочено по неделям`} color={t.bar} />
                  {lastTwo.length === 2 && delta !== 0 && <div className={`text-[11px] font-semibold ${delta < 0 ? "text-status-emerald" : "text-status-red"}`}>{delta < 0 ? `↓ на ${-delta} — лучше` : `↑ на ${delta} — хуже`}</div>}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                <dt className="text-on-surface-variant" title="Активные задачи, у которых прошёл первый срок: исходный срок поручения, а если его нет — первый срок, подтверждённый для ЗГД. Считается, даже если срок потом переносили.">Сорван первый срок</dt>
                <dd className="text-right tabular-nums text-on-surface">{d.overdueFirst}</dd>
                <dt className="text-on-surface-variant" title="Подтверждённые переносы срока на более поздний за последние 30 дней (просьбы о переносе не считаются)">Переносов за 30 дн.</dt>
                <dd className="text-right tabular-nums text-on-surface">{d.slips30}</dd>
                <dt className="text-on-surface-variant" title="Активные задачи, у которых 14+ дней не менялись подтверждённые статус, срок, ответственный или текст">Без движения 14+ дн.</dt>
                <dd className="text-right tabular-nums text-on-surface">{d.idle14}</dd>
                <dt className="text-on-surface-variant" title="Выполненные за 30 дней, у которых был срок. Дата выполнения — когда «Выполнено» подтверждено для ЗГД. Вовремя — подтверждено не позже срока; с опозданием — при прошлом подтверждении (уже после срока) ещё не было выполнено; иначе вовремя ли — не определить (выполнено между двумя подтверждениями). Задачи без срока сюда не входят.">Выполнено вовремя</dt>
                <dd className="text-right tabular-nums text-on-surface" title={d.done30.total ? `вовремя ${d.done30.onTime}, с опозданием ${d.done30.late}, не определить ${d.done30.unknown}${d.done30.noDeadline ? `, без срока ${d.done30.noDeadline}` : ""}` : undefined}>
                  {d.done30.total ? `${d.done30.onTime} из ${d.done30.total}` : "—"}
                  {d.done30.unknown ? <span className="text-outline"> · не опр. {d.done30.unknown}</span> : null}
                  {d.done30.noDeadline ? <span className="text-outline"> · без срока {d.done30.noDeadline}</span> : null}
                </dd>
              </dl>
              <p className="mt-3 text-[11px] text-outline" title={`Последняя отправленная справка или «Обновить для ЗГД». Старше ${STALE_DAYS} дней — «Нет актуальных данных»: это прозрачность отчётности, а не оценка исполнения.`}>
                {d.lastConfirmedAt ? `Данные на ${ru(d.lastConfirmedAt)} · ${daysAgo(d.lastConfirmedAt, now)} дн. назад` : "Подтверждённых данных ещё нет"}
              </p>
              {d.lastReturnedAt && <p className="mt-1 text-[11px] font-semibold text-[#b45309]" title="Вы вернули последнюю справку; пока дирекция не отправит её заново, здесь и в трекере — данные из возвращённой">Справка от {ru(d.lastReturnedAt)} возвращена — ждём исправленную</p>}
            </Link>
          );
        })}
      </div>
      {bars.length > 0 && (
        <section className="surface p-4">
          <h3 className="text-[13px] font-bold text-on-surface">Доля просрочек — худшие сверху</h3>
          <p className="mb-3 text-[11px] text-on-surface-variant">Только дирекции с актуальными данными; рядом — числа.</p>
          <BarList items={bars} />
          {stale.length > 0 && <p className="mt-3 text-[11px] text-outline">Нет актуальных данных: {stale.map((d) => d.name).join(", ")}.</p>}
        </section>
      )}
    </div>
  );
}

const METRICS = [
  { key: "overdue", label: "Просрочено на момент справки" },
  { key: "done", label: "Выполнено за неделю" },
  { key: "created", label: "Новых задач за неделю" },
] as const;

/** Вкладка «Динамика»: 12 недель по еженедельным справкам; неделя без справки — разрыв, исправленная справка — отмечена. */
export function TrendTab({ data }: { data: ZgdAnalytics }) {
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("overdue");
  const [table, setTable] = useState(false);
  const weeks = data.weeks.map((w) => ru(w));
  const series = useMemo(
    () =>
      data.directorates.map((d, i) => ({
        id: d.id,
        name: d.name,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        values: d.trend.map((p) => p[metric]),
        notes: d.trend.map((p) => (p.corrected ? `исправлено: ревизия ${p.corrected.revision} от ${ru(p.corrected.at)}${p.corrected.by ? `, ${p.corrected.by}` : ""}` : null)),
      })),
    [data, metric],
  );
  const name = METRICS.find((m) => m.key === metric)!.label;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {METRICS.map((m) => (
          <button key={m.key} onClick={() => setMetric(m.key)} aria-pressed={metric === m.key} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${metric === m.key ? "bg-primary text-white" : "bg-surface-high text-on-surface-variant hover:bg-surface-highest"}`}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-on-surface-variant">12 недель · по еженедельным справкам (подтверждено директорами). Неделя без справки — разрыв линии, а не ноль. «Выполнено» и «новых» — изменения с предыдущей справки. Точка с белой серединой — справку возвращали и отправили заново.</p>
      <section className="surface p-4">
        <LineChart weeks={weeks} series={series} valueName={name} />
      </section>
      <button onClick={() => setTable((t) => !t)} className="text-[12px] font-semibold text-primary hover:underline">
        {table ? "Скрыть таблицу" : "Показать таблицей"}
      </button>
      {table && (
        <div className="surface overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-surface-low text-left text-on-surface-variant">
                <th className="px-3 py-2 font-semibold">Неделя с</th>
                {data.directorates.map((d) => (
                  <th key={d.id} className="px-3 py-2 text-right font-semibold">
                    {d.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={w} className="border-t border-outline-variant/50">
                  <td className="px-3 py-1.5 text-on-surface-variant">{w}</td>
                  {data.directorates.map((d) => {
                    const p = d.trend[i];
                    return (
                      <td key={d.id} className="px-3 py-1.5 text-right tabular-nums" title={p.corrected ? `исправлено: ревизия ${p.corrected.revision}` : undefined}>
                        {p[metric] === null ? <span className="text-outline">{p.missing === "pending" ? "неделя идёт" : p.missing === "returned" ? "справку вернули" : p.missing === null ? "история с этой справки" : "справки не было"}</span> : p[metric]}
                        {p.corrected ? <span className="text-outline">*</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const SEG: Record<OrderSegment, { name: string; color: string; chip: string }> = {
  overdue: { name: "сорвано", color: "#dc2626", chip: "bg-status-red/10 text-status-red" },
  soon: { name: "срок ≤ 3 дн.", color: "#d97706", chip: "bg-status-amber/15 text-[#b45309]" },
  ontime: { name: "в срок", color: "#2563eb", chip: "bg-primary-soft text-primary" },
  done: { name: "выполнено", color: "#059669", chip: "bg-status-emerald/10 text-status-emerald" },
  cancelled: { name: "отменено", color: "#94a3b8", chip: "bg-surface-high text-on-surface-variant" },
};
const SEG_ORDER: OrderSegment[] = ["overdue", "soon", "ontime", "done", "cancelled"];

/** Вкладка «Поручения»: мои поручения и «на контроле». Сегменты взаимоисключающие; сорванные сверху. */
export function OrdersTab({ data }: { data: ZgdAnalytics }) {
  const o = data.orders;
  if (o.items.length === 0) return <p className="rounded-lg border border-outline-variant bg-surface px-4 py-6 text-center text-[13px] text-on-surface-variant">Поручений и задач на контроле нет.</p>;
  return (
    <div className="space-y-4">
      <div className="surface flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4">
        <span className="text-[13px] text-on-surface-variant" title="От даты поручения до дня, когда «Выполнено» подтверждено для ЗГД; только ваши поручения, завершённые за 90 дней. Незавершённые не входят.">
          Среднее время исполнения:
        </span>
        <span className="text-[20px] font-bold text-on-surface tabular-nums">{o.avgDays === null ? "—" : `${o.avgDays} дн.`}</span>
        <span className="text-[12px] text-outline">{o.avgN ? `по ${o.avgN} завершённым за 90 дней` : "завершённых поручений за 90 дней нет"}</span>
      </div>
      <section className="surface p-4">
        <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-on-surface-variant">
          {SEG_ORDER.map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEG[k].color }} /> {SEG[k].name}
            </span>
          ))}
        </div>
        <ul className="space-y-2">
          {o.byDir.map((d) => (
            <li key={d.id} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-[12px] max-md:grid-cols-[minmax(0,6.5rem)_1fr_auto]">
              <span className="truncate font-semibold text-on-surface">{d.name}</span>
              <StackBar label={d.name} parts={SEG_ORDER.map((k) => ({ key: k, value: d[k], color: SEG[k].color, name: SEG[k].name }))} />
              <span className="whitespace-nowrap tabular-nums text-on-surface-variant">{d.overdue ? <b className="text-status-red">{d.overdue} сорв.</b> : `${SEG_ORDER.reduce((s, k) => s + d[k], 0)}`}</span>
            </li>
          ))}
        </ul>
      </section>
      <ul className="surface divide-y divide-outline-variant/60">
        {o.items.map((i) => (
          <li key={i.id}>
            <Link href={`/tracker?item=${i.id}`} className="row-hover block px-4 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 text-[13px] font-medium text-on-surface [overflow-wrap:anywhere]">{i.title}</span>
                <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${SEG[i.segment].chip}`} title={i.timing === "unknown" ? "Вовремя ли — не определить: выполнено между двумя подтверждениями, срок — посередине" : undefined}>
                  {SEG[i.segment].name}
                  {i.timing === "late" ? " с опозданием" : i.timing === "ontime" ? " вовремя" : ""}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-on-surface-variant">
                <span>{i.directorateName}</span>
                <span>
                  срок {i.deadline ? ru(i.deadline) : "не назначен"}
                  {i.originalDeadline && i.deadline && i.originalDeadline.slice(0, 10) !== i.deadline.slice(0, 10) ? <span className="text-outline"> (исходный {ru(i.originalDeadline)})</span> : null}
                </span>
                {i.moves > 0 && <span>переносов: {i.moves}</span>}
                {i.daysInWork !== null && <span>в работе {i.daysInWork} дн.</span>}
                {i.statusName && <span>{i.statusName}</span>}
                <span className="text-outline">{i.mine ? "ваше поручение" : "на контроле"}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
