"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loadBootstrap } from "@/lib/client-bootstrap";
import { usePreviewAs } from "@/lib/preview-as";
import { ReportSection } from "@/components/ReportSection";
import { MemoEditor } from "@/components/MemoEditor";
import { MemoArchive, type VersionTab } from "@/components/MemoArchive";
import { ConsolidatedMemo } from "@/components/ConsolidatedMemo";
import { AiChat } from "@/components/AiChat";
import { AiSettingsPanel } from "@/components/AiSettingsPanel";
import { Popover } from "@/components/ui/Popover";
import { isDirectorial } from "@/lib/permissions";
import { DEFAULT_DIRECTORATE } from "@/lib/report-config";
import { AlertTriangle, Bot, ClipboardCheck, Lock, Play } from "lucide-react";

type Cycle = { id: string; number: number; deadline: string; status: "OPEN" | "IN_REVIEW" | "FINAL"; finalizedAt: string | null };
type Person = { id: string; name: string; role: string; total: number; sent: number };
type Final = { id: string; number: number; deadline: string; finalizedAt: string | null; directorate?: string | null; hasMemo?: boolean };
type Tab = "memo" | "finals";

const STATUS_LABEL = { OPEN: "Идёт подача", IN_REVIEW: "Сборка директором", FINAL: "Зафиксирована" } as const;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU") : "—");
const ERRORS: Record<string, string> = {
  CYCLE_EXISTS: "Активный цикл уже есть.",
  BAD_STATE: "Действие недоступно в текущем состоянии цикла.",
  FORBIDDEN: "Недостаточно прав.",
  INVALID_INPUT: "Проверьте введённые данные.",
};

/** «через 3 дн.» / «сегодня» / «просрочен на 2 дн.» */
function deadlineHint(iso: string): { text: string; late: boolean } {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  if (days === 0) return { text: "сегодня", late: false };
  if (days > 0) return { text: `через ${days} дн.`, late: false };
  return { text: `просрочен на ${-days} дн.`, late: true };
}

export function OperativkaView() {
  const [role, setRole] = useState<string | null>(null);
  const [memoEditor, setMemoEditor] = useState(false);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [summary, setSummary] = useState<Person[]>([]);
  const [finals, setFinals] = useState<Final[]>([]);
  const [directorateName, setDirectorateName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deadline, setDeadline] = useState("");
  const [note, setNote] = useState("");
  const [tab, setTabState] = useState<Tab | null>(null);
  const [finalId, setFinalIdState] = useState<string | null>(null);
  // открытая в «Архиве» справка и её вид (текст / таблица на дату) — тоже в адресе, чтобы ссылка открывала ровно это
  const [memoId, setMemoIdState] = useState<string | null>(null);
  const [memoView, setMemoViewState] = useState<VersionTab>("memo");
  // ЗГД: список справок или сводка по дирекциям; в сводке отмеченные справки — контекст для чата
  const [archiveMode, setArchiveMode] = useState<"list" | "summary">("list");
  const [summaryIds, setSummaryIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    const [boot, cur] = await Promise.all([loadBootstrap(), fetch("/api/cycles/current").then((r) => r.json())]);
    setRole(boot?.user?.role ?? null);
    setMemoEditor(!!boot?.user?.memoEditor);
    setCycle(cur.cycle);
    setSummary(cur.summary ?? []);
    setFinals(cur.finals ?? []);
    setDirectorateName(cur.directorate ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => {
      setError("Не удалось загрузить данные цикла.");
      setLoading(false);
    });
  }, [load]);

  // вкладка и выбранный финал живут в адресе (?tab=&final=), чтобы можно было поделиться ссылкой
  // перечитываем при смене адреса: переход по ссылке из уведомления, когда страница уже открыта
  const search = useSearchParams().toString();
  useEffect(() => {
    if (!role) return;
    const q = new URLSearchParams(search);
    const t = q.get("tab");
    // директор и админ открывают «Справку»; остальным (тех. администратору) доступны «Данные»
    const home: Tab = isDirectorial(role) || memoEditor ? "memo" : "finals";
    const wanted: Tab = t === "finals" ? "finals" : t === "memo" ? "memo" : home;
    setTabState(role === "EXECUTIVE" || (wanted === "memo" && !isDirectorial(role) && !memoEditor) ? "finals" : wanted);
    setFinalIdState(q.get("final"));
    setMemoIdState(q.get("memo"));
    setMemoViewState(q.get("view") === "table" ? "table" : "memo");
  }, [role, memoEditor, search]);

  function syncUrl(next: { tab: Tab; final: string | null; memo: string | null; view: VersionTab }) {
    const q = new URLSearchParams();
    q.set("tab", next.tab);
    if (next.tab === "finals" && next.final) q.set("final", next.final);
    if (next.tab === "finals" && next.memo) {
      q.set("memo", next.memo);
      if (next.view === "table") q.set("view", "table");
    }
    const s = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  }
  const url = { tab, final: finalId, memo: memoId, view: memoView };
  const setTab = (t: Tab) => {
    setTabState(t);
    syncUrl({ ...url, tab: t });
  };
  const setFinalId = (id: string) => {
    setFinalIdState(id);
    syncUrl({ ...url, tab: "finals", final: id });
  };
  const setMemoId = (id: string | null) => {
    setMemoIdState(id);
    // другая справка (или список) открывается с текста; при переключении ревизии вид сохраняется
    const view = id && memoId ? memoView : "memo";
    setMemoViewState(view);
    syncUrl({ ...url, tab: "finals", memo: id, view });
  };
  const setMemoView = (v: VersionTab) => {
    setMemoViewState(v);
    syncUrl({ ...url, tab: "finals", view: v });
  };

  async function act(url: string, body?: unknown) {
    setError(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setError(ERRORS[d?.error] ?? "Не удалось выполнить действие.");
    }
    await load();
  }

  // Режим «Посмотреть как»: кнопки управления скрыты (запись отключена)
  const previewUser = usePreviewAs();
  const isCurator = !!role && isDirectorial(role) && !previewUser;
  const isManagement = role === "EXECUTIVE";
  // ИИ-помощник по справкам: ЗГД и админ (у админа — по справкам своей дирекции); сводка из нескольких дирекций — только у ЗГД
  const aiUser = isManagement || role === "ADMIN";
  // справки старого формата (до появления справки): таблица-снимок; новые открываются в «Архиве» как справка
  const legacy = finals.filter((f) => !f.hasMemo);
  const selectedFinal = legacy.find((x) => x.id === finalId) ?? legacy[0];
  const sentTotal = summary.reduce((s, p) => s + p.sent, 0);
  const missing = summary.filter((p) => p.sent === 0);

  if (loading || !tab) return <p className="p-6 text-[13px] text-on-surface-variant">Загрузка…</p>;

  const hint = cycle && cycle.status === "OPEN" ? deadlineHint(cycle.deadline) : null;
  const directorial = (!!role && isDirectorial(role)) || memoEditor;
  const tabs: Array<{ id: Tab; label: string; badge?: string; warn?: boolean }> = isManagement
    ? [{ id: "finals", label: "Архив", badge: String(finals.length) }]
    : [
        ...(directorial ? [{ id: "memo" as const, label: "Справка", badge: missing.length > 0 ? `не подали: ${missing.length}` : undefined, warn: missing.length > 0 }] : []),
        { id: "finals", label: "Архив", badge: String(finals.length) },
      ];

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-20 border-b border-outline-variant bg-surface px-6 pt-4">
        <p className="text-[12px] text-on-surface-variant">{isManagement ? "Итоги дирекций" : directorateName ?? DEFAULT_DIRECTORATE}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-semibold leading-8 text-on-surface">{cycle && !isManagement ? `Оперативка №${cycle.number}` : "Оперативка"}</h1>
          {cycle && !isManagement && (
            <>
              <span className="rounded-full bg-primary-soft px-3 py-1 text-[12px] font-semibold text-primary">{STATUS_LABEL[cycle.status]}</span>
              <span className="text-[13px] text-on-surface-variant">
                Срок подачи: {fmt(cycle.deadline)}
                {hint && <span className={hint.late ? "ml-1 font-semibold text-status-red" : "ml-1"}>({hint.text})</span>}
              </span>
            </>
          )}
          {!isManagement && !cycle && <span className="text-[13px] text-on-surface-variant">Активного цикла нет</span>}

          <div className="ml-auto flex items-center gap-2">
            {aiUser && !previewUser && (
              <Popover
                align="right"
                width={380}
                trigger={({ toggle }) => (
                  <button onClick={toggle} className="btn-ghost" title="Подключить ИИ-помощника: вставьте ключ API">
                    <Bot size={15} /> ИИ-помощник
                  </button>
                )}
              >
                {(close) => <AiSettingsPanel onChanged={() => {}} close={close} />}
              </Popover>
            )}
            {isCurator && !cycle && (
              <Popover
                align="right"
                width={300}
                trigger={({ toggle }) => (
                  <button onClick={toggle} className="btn-primary">
                    <Play size={15} /> Начать оперативку
                  </button>
                )}
              >
                {(close) => (
                  <div className="p-3">
                    <p className="text-[13px] font-semibold text-on-surface">Срок подачи</p>
                    <p className="mt-1 text-[12px] text-on-surface-variant">За 2 дня до срока директору придёт напоминание, кто ничего не подал.</p>
                    <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="input mt-2 w-full" />
                    <button
                      onClick={() => {
                        close();
                        act("/api/cycles", { deadline });
                      }}
                      disabled={!deadline}
                      className="btn-primary mt-3 w-full justify-center"
                    >
                      Начать
                    </button>
                  </div>
                )}
              </Popover>
            )}
            {isCurator && cycle?.status === "OPEN" && (
              <button onClick={() => act(`/api/cycles/${cycle.id}/review`)} className="btn-primary">
                <ClipboardCheck size={15} /> Начать сборку
              </button>
            )}
            {isCurator && cycle?.status === "IN_REVIEW" && (
              <Popover
                align="right"
                width={340}
                trigger={({ toggle }) => (
                  <button onClick={toggle} className="btn-primary">
                    <Lock size={15} /> Отправить ЗГД
                  </button>
                )}
              >
                {(close) => (
                  <div className="p-3">
                    <p className="text-[13px] font-semibold text-on-surface">Отправить справку ЗГД (оперативка №{cycle.number})?</p>
                    <p className="mt-1 text-[12px] text-on-surface-variant">
                      Справка зафиксируется и уйдёт ЗГД, изменить её после этого нельзя (ЗГД может вернуть её вам). Позиции в справке: поданных директору — {sentTotal}. Галки «Опер» сбросятся.
                      {missing.length > 0 && ` Ничего не подали: ${missing.map((p) => p.name).join(", ")}.`}
                    </p>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className="input mt-2 w-full" placeholder="Сопроводительное слово для ЗГД (необязательно)" />
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => {
                          close();
                          act(`/api/cycles/${cycle.id}/finalize`, { note });
                        }}
                        className="btn-primary h-8"
                      >
                        Да, отправить
                      </button>
                      <button onClick={close} className="btn-ghost h-8">Отмена</button>
                    </div>
                  </div>
                )}
              </Popover>
            )}
          </div>
        </div>

        <nav className="scrollbar-none mt-3 flex gap-1 overflow-x-auto" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-[13px] font-semibold transition-colors ${
                tab === t.id ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {t.label}
              {t.badge && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.warn ? "bg-status-red/10 text-status-red" : "bg-surface-high text-on-surface-variant"}`}>{t.badge}</span>}
            </button>
          ))}
        </nav>
      </header>

      <div className={`p-6 ${aiUser && tab === "finals" ? "pb-28" : ""}`}>
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-[13px] text-status-red">
            <AlertTriangle size={15} /> {error}
          </div>
        )}

        {tab === "memo" && directorial &&
          (cycle && cycle.status !== "FINAL" ? (
            <MemoEditor key={cycle.id} cycleId={cycle.id} readOnly={!!previewUser} />
          ) : (
            <p className="surface p-6 text-center text-[13px] text-on-surface-variant">
              {previewUser
                ? "Активной оперативки нет, а в режиме просмотра начать её нельзя. Выйдите из режима (меню под вашим именем → «Выйти из режима просмотра») и нажмите «Начать оперативку»."
                : isCurator
                  ? "Справка появится, когда идёт оперативка. Нажмите «Начать оперативку» справа вверху и укажите срок подачи: справка соберётся из позиций, которые руководители отметят галкой «Опер»."
                  : "Активной оперативки нет."}
            </p>
          ))}

        {tab === "finals" && (
          <div className="space-y-10">
            {isManagement && !memoId && (
              <div className="flex w-fit overflow-hidden rounded-md border border-outline-variant" role="tablist">
                {(
                  [
                    { id: "list", label: "Справки" },
                    { id: "summary", label: "Сводка по дирекциям" },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    role="tab"
                    aria-selected={archiveMode === m.id}
                    onClick={() => setArchiveMode(m.id)}
                    className={`px-4 py-2 text-[13px] ${archiveMode === m.id ? "bg-primary-soft font-semibold text-primary" : "text-on-surface-variant hover:bg-surface-high"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
            {isManagement && archiveMode === "summary" && !memoId ? (
              <ConsolidatedMemo onSelection={setSummaryIds} />
            ) : (
              <MemoArchive initialId={memoId} onOpen={setMemoId} view={memoView} onView={setMemoView} />
            )}
            {/* «Старый формат» — только для оперативок до появления справки; ЗГД он не нужен */}
            {legacy.length > 0 && !isManagement && (
              <section>
                <h3 className="label-caps mb-2">Старый формат (таблица)</h3>
                <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
                  <ul className="scrollbar-none flex gap-2 overflow-x-auto lg:block lg:space-y-1 lg:overflow-visible">
                    {legacy.map((f) => (
                      <li key={f.id} className="shrink-0">
                        <button
                          onClick={() => setFinalId(f.id)}
                          className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${selectedFinal?.id === f.id ? "border-primary bg-primary-soft" : "border-outline-variant bg-surface hover:bg-surface-high"}`}
                        >
                          <span className={`block text-[13px] font-semibold ${selectedFinal?.id === f.id ? "text-primary" : "text-on-surface"}`}>№{f.number}</span>
                          <span className="block text-[12px] text-on-surface-variant">{fmt(f.finalizedAt)}</span>
                          {isManagement && f.directorate && <span className="mt-0.5 block text-[11px] leading-tight text-on-surface-variant">{f.directorate}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {selectedFinal && (
                    <div className="min-w-0">
                      <p className="mb-3 text-[13px] text-on-surface-variant">
                        <span className="font-semibold text-on-surface">Оперативка №{selectedFinal.number}</span>
                        {selectedFinal.directorate ? ` · ${selectedFinal.directorate}` : ""} · зафиксирована {fmt(selectedFinal.finalizedAt)}
                      </p>
                      <ReportSection key={selectedFinal.id} cycleId={selectedFinal.id} simple />
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {aiUser && tab === "finals" && (
        <AiChat
          disabledReason={previewUser ? "В режиме просмотра помощник недоступен — выйдите из режима (меню под вашим именем)." : undefined}
          versionIds={memoId ? [memoId] : isManagement && archiveMode === "summary" ? summaryIds : []}
          scopeLabel={memoId ? "открытая справка" : archiveMode === "summary" ? `справок в сводке: ${summaryIds.length}` : "последние справки дирекций"}
        />
      )}
    </div>
  );
}

