"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileDown, Loader2, Sparkles } from "lucide-react";
import { MemoReader } from "@/components/MemoReader";
import { consolidatedToDoc, type Consolidated } from "@/lib/ai-shared";

type Row = { id: string; cycleNumber: number; title: string; meetingDate: string | null; sentAt: string; directorate: string | null; bullets: number };

const day = (r: Row) => (r.meetingDate ?? r.sentAt).slice(0, 10);
const fmt = (iso: string) => new Date(iso).toLocaleDateString("ru-RU");

/**
 * Сводная справка: ЗГД выбирает совещание и справки дирекций, ИИ собирает из них одну по темам (без ИИ — склейка по дирекциям).
 * Ничего не сохраняется в архив: это документ для чтения и скачивания.
 */
export function ConsolidatedMemo({ onSelection }: { onSelection: (ids: string[]) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [date, setDate] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Consolidated | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/memo-archive")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { versions: Row[] }) => {
        setRows(d.versions);
        const newest = d.versions.map(day).sort().pop() ?? "";
        setDate(newest);
        setPicked(new Set(d.versions.filter((v) => day(v) === newest).map((v) => v.id)));
      })
      .catch(() => setError("Не удалось загрузить справки."));
  }, []);

  const dates = useMemo(() => [...new Set((rows ?? []).map(day))].sort().reverse(), [rows]);
  const ofDate = (rows ?? []).filter((r) => day(r) === date);

  // чат внизу отвечает по тем справкам, что отмечены
  useEffect(() => {
    onSelection([...picked]);
  }, [picked, onSelection]);

  function changeDate(d: string) {
    setDate(d);
    setPicked(new Set((rows ?? []).filter((r) => day(r) === d).map((r) => r.id)));
    setResult(null);
  }

  function toggle(id: string) {
    setResult(null);
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function build() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/ai/consolidate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionIds: [...picked] }) });
      const d = await r.json();
      if (!r.ok) setError(d.message ?? "Не удалось собрать сводку.");
      else setResult(d);
    } catch {
      setError("Не удалось собрать сводку.");
    } finally {
      setBusy(false);
    }
  }

  async function download(format: "pdf" | "docx") {
    if (!result) return;
    const r = await fetch(`/api/ai/consolidate/export?format=${format}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
    if (!r.ok) return setError("Не удалось скачать файл.");
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `svodnaya-spravka.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error && !rows) return <p className="surface p-6 text-center text-[13px] text-on-surface-variant">{error}</p>;
  if (!rows) return <div className="skeleton h-40 rounded-lg" />;
  if (rows.length === 0) return <p className="surface p-6 text-center text-[13px] text-on-surface-variant">Пока нет отправленных справок — собирать сводку не из чего.</p>;

  return (
    <div>
      <div className="surface mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] text-on-surface-variant">
            Совещание
            <select value={date} onChange={(e) => changeDate(e.target.value)} className="select h-9">
              {dates.map((d) => (
                <option key={d} value={d}>
                  {fmt(d)}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => void build()} disabled={picked.size === 0 || busy} className="btn-primary ml-auto h-9">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Собрать сводную справку
          </button>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {ofDate.map((r) => (
            <li key={r.id}>
              <label className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 ${picked.has(r.id) ? "border-primary bg-primary-soft" : "border-outline-variant hover:bg-surface-low"}`}>
                <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="mt-1" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-on-surface">{r.directorate ?? "Дирекция"}</span>
                  <span className="block text-[12px] text-on-surface-variant">
                    Оперативка №{r.cycleNumber} · пунктов: {r.bullets}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {error && <p className="mb-3 text-[13px] text-status-red">{error}</p>}

      {result && (
        <div>
          {result.warning && (
            <p className="mb-3 flex items-start gap-2 rounded-md border border-status-amber/40 bg-status-amber/10 px-3 py-2 text-[13px] text-on-surface">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-status-amber" /> {result.warning}
            </p>
          )}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {result.aiUsed && <span className="text-[12px] text-on-surface-variant">Сформировано ИИ — проверьте по источникам.</span>}
            <span className="ml-auto flex items-center gap-2">
              <button onClick={() => void download("pdf")} className="btn-ghost h-8">
                <FileDown size={14} /> PDF
              </button>
              <button onClick={() => void download("docx")} className="btn-ghost h-8">
                <FileDown size={14} /> Word
              </button>
            </span>
          </div>
          <MemoReader title={result.title} doc={consolidatedToDoc(result)} sources={[]} />
        </div>
      )}
    </div>
  );
}
