"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, Flame, KanbanSquare, List, Plus, Search, ShieldCheck, Star, Timer } from "lucide-react";
import { ItemPanel, type ItemRow, type Refs } from "@/components/ItemPanel";
import { FilterChip } from "@/components/FilterChips";
import { StatusPill } from "@/components/ui/Badge";
import { askText } from "@/components/ui/Dialog";
import { ASK } from "@/components/WorkflowSection";
import { ACTION_LABEL, type WorkflowAction } from "@/lib/workflow";
import { PersonAvatar } from "@/components/ui/Person";
import { segmentColors } from "@/components/SegmentList";
import { loadBootstrap, type Bootstrap } from "@/lib/client-bootstrap";
import { isDirectorial } from "@/lib/permissions";
import { matchesTokens, normalizeText, tokenize } from "@/lib/search";
import { usePreviewAs } from "@/lib/preview-as";
import { useIsMobile } from "@/lib/use-mobile";
import { SIGNAL_LABEL, type SignalKind } from "@/lib/ai-table";
import { BOARD_COLUMNS, columnOf, ruDay, statusForColumn, summarize, type HotInfo, type TaskSummary, type TrackerColumnKey, type TrackerEvent } from "@/lib/tracker";
import { TrackerTimeline } from "@/components/tracker/TrackerTimeline";
import { AiChat, TRACKER_QUICK } from "@/components/AiChat";
import { Operativshchik } from "@/components/Operativshchik";
import { OrderPanel, ZgdPanel } from "@/components/tracker/ZgdPanel";

/** Строка трекера = строка общей таблицы (как её отдаёт /api/tracker). */
export type TRow = ItemRow & {
  segmentName: string | null;
  trackName: string | null;
  ownerName: string | null;
  statusName: string | null;
  statusColor: string | null;
  updatedAt: string;
  /** Только у ЗГД (трекер по отправленным справкам): дирекция и дата справки, на которую показано состояние. */
  directorateName?: string;
  asOf?: string;
  inMemo?: boolean;
  /** ЗГД: чем подтверждено состояние; решение по последней сдаче; открытый запрос статуса. */
  confirmedBy?: string;
  review?: { result: string; decision: string | null; decidedByName: string | null; comment: string | null } | null;
  openRequest?: boolean;
  /** Директор: когда последний раз подтверждено для ЗГД (позже правили — «не подтверждено»). */
  publishedAt?: string | null;
};
type Status = { id: string; name: string; color: string | null; trackerColumn: TrackerColumnKey | null };
type Data = { rows: TRow[]; statuses: Status[]; events: TrackerEvent[]; hot: Record<string, HotInfo>; since: string | null; mode?: "sent"; directorates?: Array<{ id: string; name: string }> };
type View = "list" | "board" | "timeline";

const VIEWS: Array<{ key: View; label: string; icon: typeof List }> = [
  { key: "list", label: "Список", icon: List },
  { key: "board", label: "Доска", icon: KanbanSquare },
  { key: "timeline", label: "Таймлайн", icon: CalendarClock },
];
const VIEW_KEY = "operativka.tracker.view";

// сигналы: порядок, цвет (красный — исполнение под угрозой, жёлтый — внимание, серый — данные и отчётность), подсказка-определение
const SIGNAL_ORDER: SignalKind[] = ["overdue", "blocker", "request", "review", "soon", "data", "report"];
const RED = { on: "bg-status-red text-white", off: "bg-status-red/10 text-status-red" };
const AMBER = { on: "bg-[#b45309] text-white", off: "bg-status-amber/15 text-[#b45309]" };
const GRAY = { on: "bg-on-surface-variant text-white", off: "bg-surface-high text-on-surface-variant" };
const SIGNAL_TONE: Record<SignalKind, { on: string; off: string }> = { overdue: RED, blocker: RED, request: RED, review: AMBER, soon: AMBER, data: GRAY, report: GRAY };
const SIGNAL_HINT: Record<SignalKind, string> = {
  overdue: "Срок прошёл, задача не выполнена (и исходный срок, если его переносили)",
  blocker: "Отмечено «Заблокировано»: ждём чужого решения / документа (дата ожидания прошла — серьёзнее)",
  request: "ЗГД запросил статус — директор ещё не ответил",
  review: "Сдана на проверку 3+ дня назад — директор не принял и не вернул",
  soon: "До срока 3 дня или меньше",
  data: "Нет срока / ответственного / ожидаемого результата у поручения; или в тексте «ждём», а блокер не отмечен",
  report: "Не подана в справку, а срок в ближайшие 7 дней",
};

/** Просрочено: срок прошёл, а задача не «Выполнено»/«Не показывать». */
export function overdue(r: TRow, col: TrackerColumnKey): boolean {
  return !!r.deadline && col !== "DONE" && col !== "HIDDEN" && new Date(r.deadline).getTime() < Date.now() - 24 * 3600 * 1000;
}

export function TrackerView() {
  const router = useRouter();
  const params = useSearchParams();
  const isMobile = useIsMobile();
  const preview = usePreviewAs();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<View>("list");
  const [mine, setMine] = useState(false);
  // фильтр по виду сигнала (просрочка, блокер, ждёт приёмки…) — вместо одного «горит»
  const [kind, setKind] = useState<SignalKind | null>(null);
  const [slipOnly, setSlipOnly] = useState(false);
  // охват: все / на контроле ЗГД / поручения ЗГД / ждут ответа на запрос ЗГД
  const [scope, setScope] = useState<"all" | "control" | "orders" | "waiting">("all");
  const [ordering, setOrdering] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [segmentIds, setSegmentIds] = useState<string[]>([]);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [editor, setEditor] = useState<TRow | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    loadBootstrap().then(setBoot);
  }, []);
  useEffect(() => {
    const fromUrl = params.get("view") as View | null;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(VIEW_KEY);
    } catch {}
    const v = fromUrl ?? (saved as View | null) ?? (isMobile ? "list" : "board");
    if (VIEWS.some((x) => x.key === v)) setView(v);
  }, [params, isMobile]);
  useEffect(() => {
    let alive = true;
    fetch("/api/tracker")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Data) => alive && (setData(d), setError(null)))
      .catch((s) => alive && setError(s === 403 ? "Трекер доступен тем, кто работает с таблицей позиций." : "Не удалось загрузить трекер. Обновите страницу."));
    return () => {
      alive = false;
    };
  }, [tick]);
  // ссылка «на трекере» из таблицы: ?item=<id> — сразу открыть карточку
  useEffect(() => {
    const id = params.get("item");
    if (id && data) setEditor(data.rows.find((r) => r.id === id) ?? null);
  }, [params, data]);

  function pickView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }

  const me = boot?.user ?? null;
  const directorial = !!me && isDirectorial(me.role);
  // ИИ-помощник — у тех же, что на «Оперативке»: ЗГД, админ, директор
  const aiUser = me?.role === "EXECUTIVE" || me?.role === "ADMIN" || me?.role === "DIRECTOR";
  const canEditRow = useCallback((r: TRow) => directorial || (me?.role === "HEAD" && r.ownerId === me.id), [directorial, me]);

  const colOf = useMemo(() => new Map((data?.statuses ?? []).map((s) => [s.id, s.trackerColumn])), [data]);
  const byItem = useMemo(() => {
    const m = new Map<string, TrackerEvent[]>();
    for (const e of data?.events ?? []) m.set(e.itemId, [...(m.get(e.itemId) ?? []), e]);
    return m;
  }, [data]);
  const summaries = useMemo(() => new Map([...byItem].map(([id, ev]) => [id, summarize(ev)])), [byItem]);
  // ЗГД: только чтение, данные — снимки отправленных справок (несколько дирекций — дирекция в названии группы)
  const sent = data?.mode === "sent";
  const manyDirs = sent && new Set(data?.rows.map((r) => r.directorateName)).size > 1;
  const segRefs = useMemo(() => {
    if (!sent) return (boot?.segments ?? []).map((s) => ({ id: s.id, name: s.name, color: s.color ?? null }));
    const m = new Map<string, string>();
    for (const r of data?.rows ?? []) if (r.segmentId) m.set(r.segmentId, manyDirs ? `${r.directorateName} · ${r.segmentName ?? "Без сегмента"}` : r.segmentName ?? "Без сегмента");
    return [...m].map(([id, name]) => ({ id, name, color: null }));
  }, [sent, manyDirs, boot, data]);
  const ownerOptions = useMemo(
    () => (sent ? [...new Set((data?.rows ?? []).map((r) => r.ownerName).filter((x): x is string => !!x))].sort().map((n) => ({ id: n, name: n })) : (boot?.users ?? []).map((u) => ({ id: u.id, name: u.name }))),
    [sent, data, boot],
  );
  const colors = useMemo(() => segmentColors(segRefs), [segRefs]);

  const rows = useMemo(() => {
    const tokens = tokenize(q);
    return (data?.rows ?? [])
      .map((r) => (manyDirs ? { ...r, segmentName: `${r.directorateName} · ${r.segmentName ?? "Без сегмента"}` } : r))
      .filter((r) => {
      if (columnOf(r.statusId, colOf) === "HIDDEN") return false;
      if (mine && r.ownerId !== me?.id && !(directorial && !r.ownerId && r.createdById === me?.id)) return false;
      if (kind && !data?.hot[r.id]?.kinds.includes(kind)) return false;
      if (slipOnly && !(summaries.get(r.id)?.slips ?? 0)) return false;
      if (scope === "control" && !r.zgdControl) return false;
      if (scope === "orders" && r.origin !== "ZGD") return false;
      if (scope === "waiting" && !(r.openRequest || data?.hot[r.id]?.kinds.includes("request"))) return false;
      if (segmentIds.length && !segmentIds.includes(r.segmentId ?? "none")) return false;
      if (ownerIds.length && !ownerIds.includes(r.ownerId ?? "none")) return false;
      if (tokens.length && !matchesTokens(normalizeText([r.name, r.comment, r.segmentName, r.trackName, r.ownerName, r.statusName].filter(Boolean).join(" ")), tokens)) return false;
      return true;
    });
  }, [data, colOf, mine, kind, slipOnly, scope, summaries, segmentIds, ownerIds, q, me, manyDirs, directorial]);

  const refs: Refs = useMemo(
    () => ({
      segments: boot?.segments ?? [],
      tracks: (boot?.tracks ?? []).map((t) => ({ id: t.id, name: t.name, segmentId: t.segmentId })),
      statuses: boot?.statuses ?? [],
      attractiveness: boot?.attractiveness ?? [],
      users: (boot?.users ?? []).map((u) => ({ id: u.id, name: u.name })),
    }),
    [boot],
  );

  // перенос карточки на доске = смена статуса через обычное сохранение позиции (журнал, справка, права — как в таблице)
  // перенос в «На проверке» / «Выполнено» / обратно — действие трекера с диалогом (результат, замечание, причина)
  async function move(row: TRow, col: TrackerColumnKey) {
    if (!data || columnOf(row.statusId, colOf) === col) return;
    if (preview) return setError("В режиме просмотра менять задачи нельзя.");
    const from = columnOf(row.statusId, colOf);
    const action: WorkflowAction | null =
      col === "REVIEW" ? "submit" : col === "DONE" && from === "REVIEW" ? "accept" : from === "REVIEW" ? "return" : from === "DONE" || from === "HIDDEN" ? "reopen" : null;
    if (col === "DONE" && from !== "REVIEW") return setError("Выполненной задача становится после приёмки: сначала перенесите её в «На проверке» с результатом.");
    if (action) {
      setError(null);
      const ask = ASK[action];
      const text = ask ? await askText({ title: ACTION_LABEL[action], message: `«${row.name.slice(0, 160)}»
${ask.label}`, placeholder: ask.placeholder, multiline: true, required: !ask.optional, maxLength: 2000, okLabel: ACTION_LABEL[action] }) : "";
      if (text === null) return;
      const res = await fetch(`/api/items/${row.id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, version: row.version, ...(ask ? { [ask.field]: text } : {}) }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) setError(d?.message ?? "Не удалось выполнить действие.");
      setTick((t) => t + 1);
      return;
    }
    const statusId = statusForColumn(col, data.statuses);
    if (!statusId) return setError("Для этой колонки не назначен ни один статус (Настройки → Статусы).");
    const prev = data;
    setData({ ...data, rows: data.rows.map((r) => (r.id === row.id ? { ...r, statusId, statusName: data.statuses.find((s) => s.id === statusId)?.name ?? null, statusColor: data.statuses.find((s) => s.id === statusId)?.color ?? null } : r)) });
    const res = await fetch(`/api/items/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: row.version, statusId }) });
    if (res.ok) {
      setError(null);
      setTick((t) => t + 1);
      return;
    }
    setData(prev);
    const body = await res.json().catch(() => null);
    setError(body?.message ?? (body?.error === "CONFLICT" ? "Задачу только что изменил кто-то другой — трекер обновлён." : "Не удалось перенести задачу."));
    if (body?.error === "CONFLICT") setTick((t) => t + 1);
  }

  const counts = useMemo(() => Object.fromEntries(BOARD_COLUMNS.map((c) => [c.key, rows.filter((r) => columnOf(r.statusId, colOf) === c.key).length])), [rows, colOf]);
  // директор: изменённые после прошлого подтверждения (или ни разу не подтверждённые) — ЗГД их ещё не видит
  const unconfirmed = (r: TRow) => !sent && directorial && (!r.publishedAt || new Date(r.updatedAt).getTime() > new Date(r.publishedAt).getTime());
  const unconfirmedCount = (data?.rows ?? []).filter((r) => columnOf(r.statusId, colOf) !== "HIDDEN" && unconfirmed(r)).length;
  async function publishForZgd() {
    setNotice(null);
    const res = await fetch("/api/tracker/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const d = await res.json().catch(() => null);
    if (!res.ok) return setError(d?.message ?? "Не удалось подтвердить для ЗГД.");
    const n = d.published as number;
    const word = n % 10 === 1 && n % 100 !== 11 ? "задача" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "задачи" : "задач";
    setNotice(n ? `Подтверждено для ЗГД: ${n} ${word}.` : "Изменений для ЗГД нет — всё уже подтверждено.");
    setTick((t) => t + 1);
  }
  const kindCounts = useMemo(() => {
    const m = new Map<SignalKind, number>();
    for (const r of data?.rows ?? []) if (columnOf(r.statusId, colOf) !== "HIDDEN") for (const k of data?.hot[r.id]?.kinds ?? []) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, [data, colOf]);
  const slipped = rows.filter((r) => (summaries.get(r.id)?.slips ?? 0) > 0).length;

  return (
    <div className={`min-h-0 flex-1 overflow-auto p-6 max-md:p-3 ${sent ? "pb-28" : ""}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-on-surface">Трекер</h1>
          <p className="mt-0.5 max-w-2xl text-[13px] text-on-surface-variant">
            {sent ? (
              <>
                Только подтверждённое директором: отправленные справки и решения директора (принял, вернул, ответил на запрос, согласовал перенос). У каждой задачи — когда и кем подтверждено.
                {data?.since && <> История известна с {ruDay(data.since)}.</>}
              </>
            ) : (
              <>
                Те же позиции, что в общей таблице, — в виде доски и истории. Заполнять отдельно ничего не нужно.
                {data?.since && <> История ведётся с {ruDay(data.since)}.</>}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sent && (
            <button onClick={() => setOrdering(true)} className="btn-primary">
              <Plus size={15} /> Дать поручение
            </button>
          )}
          {!sent && directorial && !preview && (
            <button onClick={() => void publishForZgd()} className="btn-ghost" title="ЗГД видит только подтверждённое: подтвердите текущее состояние изменённых задач">
              <ShieldCheck size={15} /> Обновить для ЗГД{unconfirmedCount ? ` (${unconfirmedCount})` : ""}
            </button>
          )}
        <div className="flex rounded-md border border-outline-variant bg-surface p-0.5" role="tablist" aria-label="Вид трекера">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={view === v.key}
              onClick={() => pickView(v.key)}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] font-semibold ${view === v.key ? "bg-primary text-white" : "text-on-surface-variant hover:bg-surface-high"}`}
            >
              <v.icon size={15} /> {v.label}
            </button>
          ))}
        </div>
        </div>
      </div>
      {notice && <div className="mb-3 rounded-md border border-status-emerald/30 bg-status-emerald/10 px-3 py-2 text-[13px] text-on-surface">{notice}</div>}

      {/* итоги для решения «в масштабе»: сколько где, что горит, где срок уже сдвигали */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        {BOARD_COLUMNS.map((c) => (
          <span key={c.key} className="rounded-full bg-surface-high px-2.5 py-1 font-semibold text-on-surface-variant">
            {c.label}: <span className="text-on-surface">{counts[c.key] ?? 0}</span>
          </span>
        ))}
        {SIGNAL_ORDER.filter((k) => kindCounts.get(k) || kind === k).map((k) => (
          <button key={k} onClick={() => setKind((v) => (v === k ? null : k))} aria-pressed={kind === k} className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${kind === k ? SIGNAL_TONE[k].on : SIGNAL_TONE[k].off}`} title={SIGNAL_HINT[k]}>
            {k === "overdue" && <Flame size={13} />} {SIGNAL_LABEL[k]}: {kindCounts.get(k) ?? 0}
          </button>
        ))}
        {(slipped > 0 || slipOnly) && (
          <button onClick={() => setSlipOnly((v) => !v)} aria-pressed={slipOnly} className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${slipOnly ? "bg-[#b45309] text-white" : "bg-status-amber/15 text-[#b45309]"}`} title="Задачи, у которых срок переносили позже — нажмите, чтобы показать только их">
            <Timer size={13} /> Срок сдвигали: {slipped}
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!sent && (
        <div className="flex rounded-md border border-outline-variant bg-surface p-0.5 text-[13px]">
          <button onClick={() => setMine(false)} className={`rounded px-3 py-1 font-semibold ${!mine ? "bg-primary-soft text-primary" : "text-on-surface-variant"}`}>Все задачи</button>
          <button onClick={() => setMine(true)} className={`rounded px-3 py-1 font-semibold ${mine ? "bg-primary-soft text-primary" : "text-on-surface-variant"}`}>Мои задачи</button>
        </div>
        )}
        <div className="flex rounded-md border border-outline-variant bg-surface p-0.5 text-[13px]" aria-label="Охват">
          {([
            ["all", "Все"],
            ["control", "На контроле"],
            ["orders", "Поручения ЗГД"],
            ["waiting", sent ? "Ждут ответа" : "Запросы ЗГД"],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setScope(k)} aria-pressed={scope === k} className={`rounded px-3 py-1 font-semibold ${scope === k ? "bg-primary-soft text-primary" : "text-on-surface-variant"}`}>{label}</button>
          ))}
        </div>
        <FilterChip label="Сегмент" value={segmentIds} options={[...segRefs.map((s) => ({ id: s.id, name: s.name })), { id: "none", name: "Без сегмента" }]} onChange={setSegmentIds} />
        <FilterChip label="Ответственный" value={ownerIds} options={[...ownerOptions, { id: "none", name: "Не назначен" }]} onChange={setOwnerIds} />
        <label className="relative ml-auto max-md:ml-0 max-md:w-full">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-outline" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по задачам" className="input w-64 pl-8 max-md:w-full" aria-label="Поиск по задачам" />
        </label>
      </div>

      {error && <div className="mb-3 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-[13px] text-status-red">{error}</div>}
      {!data && !error && <div className="skeleton h-64 w-full rounded-lg" />}
      {data && rows.length === 0 && <div className="surface px-4 py-10 text-center text-[13px] text-on-surface-variant">Задач по этим условиям нет.</div>}

      {data && rows.length > 0 && view === "list" && <TrackerList rows={rows} colOf={colOf} hot={data.hot} summaries={summaries} colors={colors} onOpen={setEditor} unconfirmed={unconfirmed} />}
      {data && rows.length > 0 && view === "board" && <TrackerBoard rows={rows} colOf={colOf} hot={data.hot} summaries={summaries} colors={colors} onOpen={setEditor} unconfirmed={unconfirmed} canMove={(r) => !sent && canEditRow(r) && !preview} canDone={directorial || sent} onMove={move} mainStatus={new Map(BOARD_COLUMNS.map((c) => [c.key, statusForColumn(c.key, data.statuses)]))} />}
      {data && rows.length > 0 && view === "timeline" && <TrackerTimeline rows={rows} colOf={colOf} hot={data.hot} events={byItem} colors={colors} onOpen={setEditor} />}

      {/* тот же чат, что на «Оперативке»: ЗГД, директор, админ; разговор продолжается при переходе */}
      {aiUser && sent && <AiChat versionIds={[]} scopeLabel="трекер и последние справки дирекций" inherit quick={TRACKER_QUICK} />}
      {aiUser && !sent && <Operativshchik scope="трекер, таблица и архив справок" />}
      {editor && sent && <ZgdPanel key={editor.id} row={editor} events={byItem.get(editor.id) ?? []} hot={data?.hot[editor.id]} onClose={() => setEditor(null)} onChanged={() => setTick((t) => t + 1)} />}
      {ordering && sent && (
        <OrderPanel
          directorates={data?.directorates ?? []}
          onClose={() => setOrdering(false)}
          onDone={() => {
            setOrdering(false);
            setNotice("Поручение отправлено директору — он назначит ответственного. Задача на вашем контроле.");
            setTick((t) => t + 1);
          }}
        />
      )}
      {editor && !sent && (
        <ItemPanel
          key={editor.id}
          row={editor}
          prefill={null}
          onRowUpdated={() => setTick((t) => t + 1)}
          refs={refs}
          defaultResponsibleId={me?.id ?? ""}
          lockResponsible={me?.role === "HEAD"}
          canEdit={canEditRow(editor)}
          canDelete={false}
          customColumns={boot?.columns ?? []}
          previewMode={!!preview}
          actor={me ? { id: me.id, role: me.role } : null}
          onClose={() => {
            setEditor(null);
            if (params.get("item")) router.replace("/tracker");
          }}
          onSaved={() => {
            setEditor(null);
            setTick((t) => t + 1);
            if (params.get("item")) router.replace("/tracker");
          }}
        />
      )}
    </div>
  );
}

type Common = { rows: TRow[]; colOf: Map<string, TrackerColumnKey | null>; hot: Record<string, HotInfo>; summaries: Map<string, TaskSummary>; colors: Map<string, string>; onOpen: (r: TRow) => void; unconfirmed?: (r: TRow) => boolean };

/** Сегмент → трек → задачи, в порядке появления. */
function groupRows(rows: TRow[]): Array<{ key: string; segmentId: string | null; segment: string; tracks: Array<{ track: string; rows: TRow[] }> }> {
  const segs = new Map<string, { key: string; segmentId: string | null; segment: string; tracks: Map<string, TRow[]> }>();
  for (const r of rows) {
    const k = r.segmentId ?? "none";
    const s = segs.get(k) ?? { key: k, segmentId: r.segmentId, segment: r.segmentName ?? "Без сегмента", tracks: new Map() };
    const t = r.trackName ?? "Без трека";
    s.tracks.set(t, [...(s.tracks.get(t) ?? []), r]);
    segs.set(k, s);
  }
  return [...segs.values()].map((s) => ({ ...s, tracks: [...s.tracks].map(([track, rows]) => ({ track, rows })) }));
}

/** Метки задачи: горит, срок сдвигали, давно без движения. */
function Marks({ row, hot, summary, done, unconfirmed }: { row: TRow; hot?: HotInfo; summary?: TaskSummary; done?: boolean; unconfirmed?: boolean }) {
  return (
    <>
      {row.origin === "ZGD" && <span className="rounded-sm bg-[#7c3aed]/10 px-1.5 py-px text-[11px] font-semibold text-[#7c3aed]" title={row.assignedByName ? `Поручение: ${row.assignedByName}` : "Поручение ЗГД"}>поручение ЗГД</span>}
      {row.zgdControl && <span className="inline-flex items-center gap-1 rounded-sm bg-status-amber/15 px-1.5 py-px text-[11px] font-semibold text-[#b45309]" title="ЗГД взял на контроль: перенос срока — только с согласия директора"><Star size={10} /> на контроле</span>}
      {unconfirmed && <span className="rounded-sm border border-dashed border-outline px-1.5 py-px text-[11px] text-on-surface-variant" title="Изменена после прошлого подтверждения — ЗГД видит прежнее состояние. «Обновить для ЗГД» или решение по задаче подтвердит.">не подтверждено для ЗГД</span>}
      {/* сигнал = вид + причина и «что сделать» в подсказке */}
      {hot?.kinds.map((k) => (
        <span key={k} className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-[11px] font-semibold ${SIGNAL_TONE[k].off}`} title={hot.reasons.filter((x) => x.startsWith(SIGNAL_LABEL[k])).join("\n")}>
          {k === "overdue" && <Flame size={11} />} {SIGNAL_LABEL[k].toLowerCase()}
        </span>
      ))}
      {summary && summary.slips > 0 && (
        <span className="rounded-sm bg-status-amber/15 px-1.5 py-px text-[11px] font-semibold text-[#b45309]" title="Срок переносили позже">
          срок сдвигали {summary.slips}× (+{summary.slipDays} дн.)
        </span>
      )}
      {!done && summary?.idleDays !== null && summary && summary.idleDays >= 14 && (
        <span className="rounded-sm bg-surface-high px-1.5 py-px text-[11px] font-semibold text-on-surface-variant" title="Последнее изменение задачи">
          без движения {summary.idleDays} дн.
        </span>
      )}
      {row.inMemo !== undefined
        ? row.inMemo && <span className="rounded-sm bg-primary-soft px-1.5 py-px text-[11px] font-semibold text-primary" title="Вошла в последнюю отправленную справку">в справке</span>
        : row.operFlag && <span className="rounded-sm bg-primary-soft px-1.5 py-px text-[11px] font-semibold text-primary">подана в справку</span>}
    </>
  );
}

function Deadline({ row, col }: { row: TRow; col: TrackerColumnKey }) {
  if (!row.deadline) return <span className="text-outline">срока нет</span>;
  return <span className={overdue(row, col) ? "font-semibold text-status-red" : "text-on-surface-variant"}>до {ruDay(row.deadline)}</span>;
}

function TrackerList({ rows, colOf, hot, summaries, colors, onOpen, unconfirmed }: Common) {
  return (
    <div className="space-y-4">
      {groupRows(rows).map((g) => (
        <section key={g.key} className="surface overflow-hidden">
          <h2 className="border-b border-l-4 border-outline-variant bg-surface-low px-4 py-2 text-[13px] font-bold text-on-surface" style={{ borderLeftColor: colors.get(g.segmentId ?? "none") ?? "#94a3b8" }}>
            {g.segment}
          </h2>
          {g.tracks.map((t) => (
            <div key={t.track}>
              <div className="label-caps px-4 pb-1 pt-3">{t.track}</div>
              <ul>
                {t.rows.map((r) => {
                  const col = columnOf(r.statusId, colOf);
                  return (
                    <li key={r.id}>
                      <button onClick={() => onOpen(r)} className="row-hover flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-t border-outline-variant/50 px-4 py-2.5 text-left">
                        <span className="min-w-0 flex-1 basis-72 text-[13px] text-on-surface [overflow-wrap:anywhere]">{r.name}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Marks row={r} hot={hot[r.id]} summary={summaries.get(r.id)} done={col === "DONE"} unconfirmed={unconfirmed?.(r)} />
                        </span>
                        <span className="w-32 shrink-0"><StatusPill name={r.statusName ?? "Без статуса"} color={r.statusColor} /></span>
                        <span className="flex w-40 shrink-0 items-center gap-1.5 truncate text-[12px] text-on-surface-variant">
                          {r.ownerName && <PersonAvatar name={r.ownerName} size={20} />} {r.ownerName ?? "не назначен"}
                        </span>
                        <span className="w-24 shrink-0 text-[12px]"><Deadline row={r} col={col} /></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function TrackerBoard({ rows, colOf, hot, summaries, colors, onOpen, canMove, canDone, onMove, mainStatus, unconfirmed }: Common & { canMove: (r: TRow) => boolean; canDone: boolean; onMove: (r: TRow, col: TrackerColumnKey) => void; mainStatus: Map<TrackerColumnKey, string | null> }) {
  const [drag, setDrag] = useState<TRow | null>(null);
  const [over, setOver] = useState<TrackerColumnKey | null>(null);
  // руководитель: свои задачи до «На проверке»; сданную и выполненную двигает только директор (принять / вернуть / переоткрыть)
  const allowed = (r: TRow, col: TrackerColumnKey) => canDone || (col !== "DONE" && !["DONE", "REVIEW", "HIDDEN"].includes(columnOf(r.statusId, colOf)));
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {BOARD_COLUMNS.map((c) => {
        const items = rows.filter((r) => columnOf(r.statusId, colOf) === c.key);
        const droppable = !!drag && allowed(drag, c.key);
        return (
          <section
            key={c.key}
            aria-label={c.label}
            onDragOver={(e: DragEvent) => {
              if (!droppable) return;
              e.preventDefault();
              setOver(c.key);
            }}
            onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              setOver(null);
              if (drag && droppable) onMove(drag, c.key);
              setDrag(null);
            }}
            className={`flex min-w-64 flex-1 basis-0 flex-col rounded-lg border bg-surface-low p-2 transition-colors ${over === c.key ? "border-primary bg-primary-soft" : "border-outline-variant"} ${drag && !droppable ? "opacity-60" : ""}`}
          >
            <header className="mb-2 flex items-center justify-between px-1">
              <span className="text-[13px] font-bold text-on-surface">{c.label}</span>
              <span className="rounded-full bg-surface-high px-2 text-[11px] font-semibold text-on-surface-variant">{items.length}</span>
            </header>
            {c.key === "DONE" && !canDone && <p className="mb-2 px-1 text-[11px] text-outline">Сюда задачу переносит директор — переведите её в «На проверке».</p>}
            <div className="flex min-h-24 flex-col gap-2">
              {items.map((r) => (
                <article
                  key={r.id}
                  draggable={canMove(r) && allowed(r, "REVIEW")}
                  onDragStart={() => setDrag(r)}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  onClick={() => onOpen(r)}
                  onKeyDown={(e) => e.key === "Enter" && onOpen(r)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Задача: ${r.name}`}
                  className="surface cursor-pointer border-l-4 p-3 outline-none hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary"
                  style={{ borderLeftColor: colors.get(r.segmentId ?? "none") ?? "#94a3b8" }}
                >
                  <div className="truncate text-[11px] text-outline">{[r.segmentName, r.trackName].filter(Boolean).join(" · ") || "Без сегмента"}</div>
                  <div className="mt-0.5 line-clamp-3 text-[13px] font-medium text-on-surface [overflow-wrap:anywhere]">{r.name}</div>
                  {r.statusName && r.statusId !== mainStatus.get(c.key) && (
                    <div className="mt-1.5">
                      <StatusPill name={r.statusName} color={r.statusColor} />
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Marks row={r} hot={hot[r.id]} summary={summaries.get(r.id)} done={c.key === "DONE"} unconfirmed={unconfirmed?.(r)} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-on-surface-variant">
                      {r.ownerName && <PersonAvatar name={r.ownerName} size={20} />} <span className="truncate">{r.ownerName ?? "не назначен"}</span>
                    </span>
                    <Deadline row={r} col={c.key} />
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

