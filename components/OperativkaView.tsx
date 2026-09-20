"use client";

import { useCallback, useEffect, useState } from "react";
import { ExportMenu } from "@/components/ExportMenu";
import { loadBootstrap } from "@/lib/client-bootstrap";
import { ExpandableText } from "@/components/ui/ExpandableText";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Lock, Play, Send } from "lucide-react";

type Cycle = { id: string; number: number; deadline: string; status: "OPEN" | "IN_REVIEW" | "FINAL"; finalizedAt: string | null };
type Person = { id: string; name: string; role: string; total: number; sent: number };
type Final = { id: string; number: number; deadline: string; finalizedAt: string | null };
type SnapRow = {
  id: string;
  segmentName: string | null;
  trackName: string | null;
  name: string;
  cost: string | null;
  attractivenessName: string | null;
  ownerName: string | null;
  deadline: string | null;
  statusName: string | null;
  comment: string | null;
  customFields?: Array<{ name: string; type: string; value: string | null }>;
};

const STATUS_LABEL = { OPEN: "Сбор", IN_REVIEW: "Сборка куратором", FINAL: "Финал" } as const;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU") : "—");
const ERRORS: Record<string, string> = {
  CYCLE_EXISTS: "Активный цикл уже есть.",
  BAD_STATE: "Действие недоступно в текущем состоянии цикла.",
  FORBIDDEN: "Недостаточно прав.",
  INVALID_INPUT: "Проверьте введённые данные.",
};

export function OperativkaView() {
  const [role, setRole] = useState<string | null>(null);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [summary, setSummary] = useState<Person[]>([]);
  const [finals, setFinals] = useState<Final[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deadline, setDeadline] = useState("");
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [view, setView] = useState<{ cycle: Final; rows: SnapRow[] } | null>(null);

  const load = useCallback(async () => {
    const [boot, cur] = await Promise.all([loadBootstrap(), fetch("/api/cycles/current").then((r) => r.json())]);
    setRole(boot?.user?.role ?? null);
    setCycle(cur.cycle);
    setSummary(cur.summary ?? []);
    setFinals(cur.finals ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => {
      setError("Не удалось загрузить данные цикла.");
      setLoading(false);
    });
  }, [load]);

  async function act(url: string, body?: unknown) {
    setError(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setError(ERRORS[d?.error] ?? "Не удалось выполнить действие.");
    }
    setConfirmFinal(false);
    await load();
  }

  async function openFinal(f: Final) {
    const res = await fetch(`/api/cycles/${f.id}`);
    if (!res.ok) return setError("Не удалось открыть оперативку.");
    const d = await res.json();
    setView({ cycle: f, rows: (d.cycle.snapshot ?? []) as SnapRow[] });
  }

  const isCurator = role === "CURATOR";
  const sentTotal = summary.reduce((s, p) => s + p.sent, 0);
  const missing = summary.filter((p) => p.sent === 0);

  if (loading) return <p className="p-6 text-[13px] text-on-surface-variant">Загрузка…</p>;

  return (
    <div className="h-full overflow-y-auto p-6">
      <p className="label-caps">Оперативка</p>
      <h1 className="text-2xl font-semibold leading-8 text-on-surface">{cycle ? `Оперативка №${cycle.number}` : role === "MANAGEMENT" ? "Финальные оперативки" : "Цикл оперативки"}</h1>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-[13px] text-status-red">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {role !== "MANAGEMENT" && !cycle && (
        <div className="surface mt-5 max-w-xl p-5">
          <p className="text-[14px] font-semibold text-on-surface">Активного цикла нет</p>
          {isCurator ? (
            <>
              <p className="mt-1 text-[13px] text-on-surface-variant">Укажите срок подачи. За 2 дня до него куратору придёт напоминание, кто ничего не подал.</p>
              <div className="mt-3 flex items-center gap-2">
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="input" />
                <button onClick={() => act("/api/cycles", { deadline })} disabled={!deadline} className="btn-primary">
                  <Play size={15} /> Начать оперативку
                </button>
              </div>
            </>
          ) : (
            <p className="mt-1 text-[13px] text-on-surface-variant">Куратор ещё не начал новую оперативку.</p>
          )}
        </div>
      )}

      {cycle && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-primary-soft px-3 py-1 text-[12px] font-semibold text-primary">{STATUS_LABEL[cycle.status]}</span>
            <span className="text-[13px] text-on-surface-variant">Срок подачи: {fmt(cycle.deadline)}</span>
            {isCurator && cycle.status === "OPEN" && (
              <button onClick={() => act(`/api/cycles/${cycle.id}/review`)} className="btn-primary ml-auto">
                <ClipboardCheck size={15} /> Начать сборку
              </button>
            )}
            {isCurator && cycle.status === "IN_REVIEW" && !confirmFinal && (
              <button onClick={() => setConfirmFinal(true)} className="btn-primary ml-auto">
                <Lock size={15} /> Финализировать
              </button>
            )}
          </div>

          {confirmFinal && (
            <div className="surface mt-3 max-w-xl border-status-amber/40 p-4">
              <p className="text-[13px] font-semibold text-on-surface">Зафиксировать оперативку №{cycle.number}?</p>
              <p className="mt-1 text-[12px] text-on-surface-variant">
                В снимок войдут отправленные позиции ({sentTotal}). После этого снимок нельзя изменить, галки «Опер» сбросятся.
                {missing.length > 0 && ` Ничего не подали: ${missing.map((p) => p.name).join(", ")}.`}
              </p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => act(`/api/cycles/${cycle.id}/finalize`)} className="btn-primary h-8">Да, финализировать</button>
                <button onClick={() => setConfirmFinal(false)} className="btn-ghost h-8">Отмена</button>
              </div>
            </div>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Kpi icon={<Send size={18} />} label="Отправлено куратору" value={sentTotal} />
            <Kpi icon={<CheckCircle2 size={18} />} label="Подали" value={summary.length - missing.length} />
            <Kpi icon={<AlertTriangle size={18} />} label="Ничего не подали" value={missing.length} warn={missing.length > 0} />
          </div>

          <div className="surface mt-5 overflow-hidden">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-surface-high">
                <tr>
                  <th className="label-caps px-4 py-3 text-left">Сотрудник</th>
                  <th className="label-caps px-4 py-3 text-center">Позиций</th>
                  <th className="label-caps px-4 py-3 text-center">Отправлено</th>
                  <th className="label-caps px-4 py-3 text-left">Статус</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((p) => (
                  <tr key={p.id} className="border-t border-outline-variant/50">
                    <td className="px-4 py-3">
                      {p.name}
                      {p.role === "CURATOR" && <span title="Куратор" className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded-sm bg-primary text-[10px] font-bold text-white">К</span>}
                    </td>
                    <td className="px-4 py-3 text-center">{p.total}</td>
                    <td className="px-4 py-3 text-center">{p.sent}</td>
                    <td className="px-4 py-3">
                      {p.sent > 0 ? <span className="font-semibold text-status-emerald">подал</span> : <span className="font-semibold text-status-red">не подал</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {finals.length > 0 && (
        <div className="mt-8">
          <h2 className="label-caps mb-3">Финальные оперативки</h2>
          <div className="flex flex-wrap gap-2">
            {finals.map((f) => (
              <button key={f.id} onClick={() => openFinal(f)} className={`btn-ghost ${view?.cycle.id === f.id ? "border-primary bg-primary-soft text-primary" : ""}`}>
                №{f.number} · {fmt(f.finalizedAt)}
              </button>
            ))}
          </div>
        </div>
      )}

      {view && (
        <div className="surface mt-4 overflow-x-auto">
          <div className="flex items-center justify-between gap-3 border-b border-outline-variant px-4 py-3">
            <p className="text-[13px] font-semibold">
              Оперативка №{view.cycle.number} — зафиксирована {fmt(view.cycle.finalizedAt)}, позиций: {view.rows.length}
            </p>
            <ExportMenu endpoint={`/api/cycles/${view.cycle.id}/export`} withPptx />
          </div>
          <table className="w-full min-w-[900px] border-collapse text-[13px]">
            <thead className="bg-surface-high">
              <tr>
                {["Сегмент", "Трек", "Задача", "Оценка $", "Привлекательность", "Ответственный", "Дедлайн", "Статус", "Комментарии", ...(view.rows[0]?.customFields?.map((f) => f.name) ?? [])].map((h) => (
                  <th key={h} className="label-caps px-3 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.id} className="border-t border-outline-variant/50 align-top">
                  <td className="px-3 py-2.5">{r.segmentName ?? "—"}</td>
                  <td className="px-3 py-2.5">{r.trackName ?? "—"}</td>
                  <td className="min-w-56 px-3 py-2.5"><ExpandableText text={r.name} lines={2} /></td>
                  <td className="px-3 py-2.5">{r.cost ?? "—"}</td>
                  <td className="px-3 py-2.5">{r.attractivenessName ?? "—"}</td>
                  <td className="px-3 py-2.5">{r.ownerName ?? "—"}</td>
                  <td className="px-3 py-2.5">{fmt(r.deadline)}</td>
                  <td className="px-3 py-2.5">{r.statusName ?? "—"}</td>
                  <td className="min-w-64 px-3 py-2.5 text-on-surface-variant">{r.comment ? <ExpandableText text={r.comment} lines={3} /> : "—"}</td>
                  {r.customFields?.map((f, i) => (
                    <td key={i} className="px-3 py-2.5">{f.value ? (f.type === "DATE" ? fmt(f.value) : f.value) : "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {role === "MANAGEMENT" && finals.length === 0 && <p className="mt-4 text-[13px] text-on-surface-variant">Финальных оперативок пока нет.</p>}
    </div>
  );
}

function Kpi({ icon, label, value, warn }: { icon: React.ReactNode; label: string; value: number; warn?: boolean }) {
  return (
    <div className="surface p-5">
      <span className={`flex h-9 w-9 items-center justify-center rounded-md ${warn ? "bg-status-red/10 text-status-red" : "bg-primary-soft text-primary"}`}>{icon}</span>
      <p className="mt-3 text-[12px] text-on-surface-variant">{label}</p>
      <p className={`text-[48px] font-bold leading-[1.1] tracking-tight ${warn ? "text-status-red" : "text-on-surface"}`}>{value}</p>
    </div>
  );
}
