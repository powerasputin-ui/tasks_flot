"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileDown, FileText, Search, Table2, Undo2 } from "lucide-react";
import { Highlight } from "@/components/ui/Highlight";
import { MemoReader } from "@/components/MemoReader";
import { ArchiveTable } from "@/components/ArchiveTable";

export type VersionTab = "memo" | "table";
import type { MemoDoc } from "@/lib/memo";
import type { VersionSource } from "@/lib/memo-archive";

type Row = {
  id: string;
  cycleId?: string;
  cycleNumber: number;
  revision: number;
  revisions: number;
  title: string;
  meetingDate: string | null;
  sentAt: string;
  sentByName: string;
  returned: boolean;
  returnComment: string | null;
  directorate: string | null;
  bullets: number;
  matches: Array<{ section: string; text: string }>;
};

type Detail = {
  id: string;
  cycleNumber: number;
  revision: number;
  title: string;
  meetingDate: string | null;
  sentAt: string;
  sentByName: string;
  note: string | null;
  returnedAt: string | null;
  returnComment: string | null;
  returnedByName: string | null;
  directorate: string | null;
  doc: MemoDoc;
  sources: VersionSource[];
  participation: Array<{ name: string; total: number; sent: number }>;
  canReturn: boolean;
};
type Revision = { id: string; revision: number; sentAt: string; returnedAt: string | null; returnComment: string | null };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU") : "—");
const fmtTime = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Архив отправленных справок: список по датам, поиск по тексту, просмотр версии, скачать PDF/Word.
 * ЗГД видит справки всех дирекций и может вернуть справку директору с комментарием.
 */
export function MemoArchive({
  initialId,
  onOpen,
  view = "memo",
  onView,
}: {
  initialId?: string | null;
  onOpen?: (id: string | null) => void;
  /** Что открыто у справки: сам текст или таблица на дату отправки (живёт в адресе страницы). */
  view?: VersionTab;
  onView?: (v: VersionTab) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialId ?? null);
  // справку открыли снаружи (ссылка из уведомления, «назад» в адресе)
  useEffect(() => setOpenId(initialId ?? null), [initialId]);

  const loadList = useCallback(async () => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const r = await fetch(`/api/memo-archive?${p.toString()}`);
    if (!r.ok) {
      setError("Не удалось загрузить архив.");
      return;
    }
    setError(null);
    setRows((await r.json()).versions);
  }, [q, from, to]);

  // поиск с небольшой задержкой, чтобы не слать запрос на каждую букву
  useEffect(() => {
    const t = setTimeout(() => void loadList(), 300);
    return () => clearTimeout(t);
  }, [loadList]);

  const open = (id: string | null) => {
    setOpenId(id);
    onOpen?.(id);
  };

  if (openId)
    return <VersionView id={openId} query={q} tab={view} onTab={(v) => onView?.(v)} onBack={() => open(null)} onChanged={() => void loadList()} onSwitch={(id) => open(id)} />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти в справках: слово, судно, задача…" className="input w-full pl-9" maxLength={200} />
        </div>
        <label className="flex items-center gap-1.5 text-[13px] text-on-surface-variant">
          с <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input h-9" />
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-on-surface-variant">
          по <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input h-9" />
        </label>
        {(q || from || to) && (
          <button
            onClick={() => {
              setQ("");
              setFrom("");
              setTo("");
            }}
            className="text-[12px] font-semibold text-primary hover:underline"
          >
            Сбросить
          </button>
        )}
      </div>

      {error && <p className="mb-3 text-[13px] text-status-red">{error}</p>}
      {!rows ? (
        <div className="skeleton h-32 rounded-lg" />
      ) : rows.length === 0 ? (
        <p className="surface p-6 text-center text-[13px] text-on-surface-variant">{q || from || to ? "Ничего не найдено." : "Отправленных справок пока нет. Когда директор отправит справку ЗГД, она появится здесь."}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <button onClick={() => open(r.id)} className="surface w-full p-4 text-left transition-colors hover:bg-surface-low">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[14px] font-semibold text-on-surface">Оперативка №{r.cycleNumber}</span>
                  <span className="text-[13px] text-on-surface-variant">к ОС {fmt(r.meetingDate ?? r.sentAt)}</span>
                  {r.revisions > 1 && <span className="rounded-full bg-status-amber/15 px-2 py-0.5 text-[11px] font-semibold text-status-amber">ред. {r.revision}</span>}
                  {r.returned && <span className="rounded-full bg-status-red/10 px-2 py-0.5 text-[11px] font-semibold text-status-red">возвращена</span>}
                  <span className="ml-auto text-[12px] text-on-surface-variant">
                    отправлена {fmt(r.sentAt)} · {r.sentByName}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-on-surface-variant">
                  {r.directorate ? `${r.directorate} · ` : ""}пунктов: {r.bullets}
                </p>
                {r.matches.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-outline-variant/60 pt-2">
                    {r.matches.map((m, i) => (
                      <li key={i} className="text-[12px] leading-snug text-on-surface">
                        <span className="text-on-surface-variant">{m.section}: </span>
                        <Highlight text={m.text.length > 260 ? `${m.text.slice(0, 260)}…` : m.text} query={q} />
                      </li>
                    ))}
                  </ul>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VersionView({
  id,
  query,
  tab,
  onTab,
  onBack,
  onChanged,
  onSwitch,
}: {
  id: string;
  query: string;
  tab: VersionTab;
  onTab: (v: VersionTab) => void;
  onBack: () => void;
  onChanged: () => void;
  onSwitch: (id: string) => void;
}) {
  const [data, setData] = useState<{ version: Detail; revisions: Revision[] } | null>(null);
  // из пункта справки «показать в таблице» — какую строку подсветить
  const [focusItem, setFocusItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/memo-archive/${id}`);
    if (!r.ok) {
      setError("Справка недоступна.");
      return;
    }
    setError(null);
    setData(await r.json());
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function doReturn() {
    setBusy(true);
    const r = await fetch(`/api/memo-archive/${id}/return`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment }) });
    setBusy(false);
    if (r.ok) {
      setReturning(false);
      setComment("");
      await load();
      onChanged();
    } else {
      const d = await r.json().catch(() => null);
      setError(d?.error === "CYCLE_EXISTS" ? "У дирекции уже идёт другая оперативка: вернуть эту справку сейчас нельзя." : d?.message ?? "Не удалось вернуть справку.");
    }
  }

  if (error && !data) return <p className="surface p-6 text-center text-[13px] text-on-surface-variant">{error}</p>;
  if (!data) return <div className="skeleton h-64 rounded-lg" />;
  const v = data.version;
  const missing = v.participation.filter((p) => p.sent === 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="btn-ghost h-8">
          <ArrowLeft size={14} /> Все справки
        </button>
        {data.revisions.length > 1 && (
          <span className="flex items-center gap-1 text-[13px] text-on-surface-variant">
            Ревизия:
            {data.revisions.map((r) => (
              <button key={r.id} onClick={() => onSwitch(r.id)} className={`rounded-md border px-2 py-0.5 text-[12px] font-semibold ${r.id === id ? "border-primary bg-primary-soft text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-high"}`}>
                {r.revision}
              </button>
            ))}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <a href={`/api/memo-archive/${id}/export?format=pdf`} className="btn-ghost h-8" download>
            <FileDown size={14} /> PDF
          </a>
          <a href={`/api/memo-archive/${id}/export?format=docx`} className="btn-ghost h-8" download>
            <FileDown size={14} /> Word
          </a>
          {v.canReturn && (
            <button onClick={() => setReturning((x) => !x)} className="btn-ghost h-8">
              <Undo2 size={14} /> Вернуть директору
            </button>
          )}
        </span>
      </div>

      <p className="mb-3 text-[12px] text-on-surface-variant">
        Оперативка №{v.cycleNumber}, ред. {v.revision} · отправлена {fmtTime(v.sentAt)} · {v.sentByName}
        {v.directorate ? ` · ${v.directorate}` : ""}
      </p>

      {error && <p className="mb-3 text-[13px] text-status-red">{error}</p>}

      {returning && (
        <div className="surface mb-3 p-4">
          <p className="text-[13px] font-semibold text-on-surface">Что нужно исправить?</p>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} className="input mt-2 w-full" placeholder="Комментарий директору" />
          <div className="mt-2 flex gap-2">
            <button onClick={() => void doReturn()} disabled={!comment.trim() || busy} className="btn-primary h-8">
              Вернуть
            </button>
            <button onClick={() => setReturning(false)} className="btn-ghost h-8">
              Отмена
            </button>
          </div>
        </div>
      )}

      {v.returnedAt && (
        <p className="mb-3 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-[13px] text-on-surface">
          <span className="font-semibold">Возвращена {fmt(v.returnedAt)}{v.returnedByName ? ` (${v.returnedByName})` : ""}:</span> {v.returnComment}
        </p>
      )}
      {v.note && <p className="mb-3 rounded-md border border-outline-variant bg-surface-low px-3 py-2 text-[13px] text-on-surface"><span className="font-semibold">От директора: </span>{v.note}</p>}
      {missing.length > 0 && <p className="mb-3 text-[12px] text-on-surface-variant">Не подали к моменту отправки: {missing.map((p) => p.name).join(", ")}.</p>}

      <div className="mb-4 flex overflow-hidden rounded-md border border-outline-variant" role="tablist">
        {(
          [
            { id: "memo", label: "Справка" },
            { id: "table", label: `Таблица на ${fmt(v.sentAt)}` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setFocusItem(null);
              onTab(t.id);
            }}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-[13px] ${tab === t.id ? "bg-primary-soft font-semibold text-primary" : "text-on-surface-variant hover:bg-surface-high"}`}
          >
            {t.id === "memo" ? <FileText size={14} /> : <Table2 size={14} />} {t.label}
          </button>
        ))}
      </div>

      {tab === "table" ? (
        <ArchiveTable key={id} versionId={id} focusItemId={focusItem} />
      ) : (
        <MemoReader
          title={v.title}
          doc={v.doc}
          sources={v.sources}
          query={query}
          onShowInTable={(itemId) => {
            setFocusItem(itemId);
            onTab("table");
          }}
        />
      )}
    </div>
  );
}
