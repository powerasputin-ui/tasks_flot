"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isOverdueRow } from "@/lib/overdue";
import { CalendarClock, Check, Flame, KanbanSquare, List, MoreHorizontal, Plus, RotateCcw, Search, ShieldCheck, Star, Timer, Trash2, X } from "lucide-react";
import Link from "next/link";
import { ItemPanel, type ItemRow, type Refs } from "@/components/ItemPanel";
import { FilterChip } from "@/components/FilterChips";
import { StatusPill } from "@/components/ui/Badge";
import { askConfirm, askText } from "@/components/ui/Dialog";
import { ASK } from "@/components/WorkflowSection";
import { ACTION_LABEL, availableActions, type WorkflowAction } from "@/lib/workflow";
import { STOP_STATUS } from "@/lib/statuses";
import { PersonAvatar } from "@/components/ui/Person";
import { segmentColors } from "@/components/SegmentList";
import { loadBootstrap, type Bootstrap } from "@/lib/client-bootstrap";
import { canCreateItem, canDeleteItem, canPurgeItem, isDirectorial } from "@/lib/permissions";
import { matchesTokens, normalizeText, tokenize } from "@/lib/search";
import { usePreviewAs } from "@/lib/preview-as";
import { useIsMobile } from "@/lib/use-mobile";
import { SIGNAL_LABEL, type SignalKind } from "@/lib/ai-table";
import { BOARD_COLUMNS, closedAtOf, columnOf, deadlineChip, DONE_WINDOW_DAYS, dropAction, dropTargets, EMPTY_FILTERS, filtersFromParams, filtersToParams, hasActiveFilters, isRecentlyDone, mskDay, pickTop, ruDay, statusForColumn, summarize, type HotInfo, type TaskSummary, type TrackerColumnKey, type TrackerEvent, type TrackerFilters } from "@/lib/tracker";
import { TrackerTimeline } from "@/components/tracker/TrackerTimeline";
import { TrackerBoard } from "@/components/tracker/TrackerBoard";
import { AiChat, TRACKER_QUICK } from "@/components/AiChat";
import { Operativshchik } from "@/components/Operativshchik";
import { OrderPanel, ZgdPanel } from "@/components/tracker/ZgdPanel";
import { PublishPanel } from "@/components/tracker/PublishPanel";

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
  /** ЗГД: кто дал поручение (фильтр «Мои поручения»). */
  assignedById?: string | null;
};
type Status = { id: string; name: string; color: string | null; trackerColumn: TrackerColumnKey | null };
type Data = { rows: TRow[]; statuses: Status[]; events: TrackerEvent[]; hot: Record<string, HotInfo>; since: string | null; mode?: "sent"; directorates?: Array<{ id: string; name: string }>; people?: Array<{ id: string; name: string; directorateId: string; role: string }> };
type View = "list" | "board" | "timeline";

const VIEWS: Array<{ key: View; label: string; icon: typeof List }> = [
  { key: "list", label: "Список", icon: List },
  { key: "board", label: "Доска", icon: KanbanSquare },
  { key: "timeline", label: "Таймлайн", icon: CalendarClock },
];
const VIEW_KEY = "operativka.tracker.view";
const SCOPES = ["all", "control", "orders", "mine", "waiting"] as const;
/** Параметры адреса, которыми управляют фильтры (остальные — view, deleted, item — не трогаем). */
const FILTER_KEYS = ["kind", "scope", "mine", "slip", "col", "cancelled", "done", "seg", "owner", "q"];

// сигналы: порядок, цвет (красный — исполнение под угрозой, жёлтый — внимание, серый — данные и отчётность), подсказка-определение
const SIGNAL_ORDER: SignalKind[] = ["overdue", "slipped", "deadlineRequest", "blocker", "request", "review", "soon", "data", "report"];
const RED = { on: "bg-status-red text-white", off: "bg-status-red/10 text-status-red" };
const AMBER = { on: "bg-[#b45309] text-white", off: "bg-status-amber/15 text-[#b45309]" };
const GRAY = { on: "bg-on-surface-variant text-white", off: "bg-surface-high text-on-surface-variant" };
const SIGNAL_TONE: Record<SignalKind, { on: string; off: string }> = { overdue: RED, slipped: AMBER, deadlineRequest: AMBER, blocker: RED, request: RED, review: AMBER, soon: AMBER, data: GRAY, report: GRAY };
const SIGNAL_HINT: Record<SignalKind, string> = {
  overdue: "Срок прошёл, задача не выполнена (и исходный срок, если его переносили)",
  slipped: "Исходный срок прошёл, задачу перенесли — текущий срок ещё не наступил",
  deadlineRequest: "Ответственный попросил перенести срок — директор ещё не решил",
  blocker: "Задача «На стопе»: ждём чужого решения / документа (дата ожидания прошла — серьёзнее)",
  request: "ЗГД запросил статус — директор ещё не ответил",
  review: "Сдана на проверку 3+ дня назад — директор не принял и не вернул",
  soon: "До срока 3 дня или меньше",
  data: "Нет срока / ответственного / ожидаемого результата у поручения; или в тексте «ждём», а задача не на стопе",
  report: "Не подана в справку, а срок в ближайшие 7 дней",
};

/** Просрочено: срок прошёл, а задача не «Выполнено»/«Не показывать». */
/** Просрочено — общее правило (lib/overdue.ts): в сам день срока ещё нет, закрытая по колонке — нет. */
export function overdue(r: TRow, col: TrackerColumnKey): boolean {
  return isOverdueRow({ deadline: r.deadline, statusName: r.statusName, statusColumn: col, archived: r.archived });
}

export function TrackerView() {
  const router = useRouter();
  const params = useSearchParams();
  // «Удалённые» трекера: те же задачи, что в «Удалённых» таблицы (/tracker?deleted=1)
  const deletedParam = params.get("deleted") === "1";
  const [missing, setMissing] = useState(false);
  const isMobile = useIsMobile();
  const preview = usePreviewAs();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<View>("list");
  // Фильтры живут в адресе (?kind=&scope=&mine=&col=&seg=&owner=&q=…): вид можно переслать ссылкой, он переживает перезагрузку
  // и ссылки из сводок и уведомлений (?kind=review, ?scope=mine)
  const [filters, setFilters] = useState<TrackerFilters>(() => filtersFromParams((k) => params.get(k), SIGNAL_ORDER, SCOPES));
  const patch = (p: Partial<TrackerFilters>) => setFilters((f) => ({ ...f, ...p }));
  const { mine, slip: slipOnly, seg: segmentIds, owner: ownerIds, q } = filters;
  const kind = filters.kind as SignalKind | null;
  const scopeRaw = filters.scope as "all" | "control" | "orders" | "mine" | "waiting";
  const [ordering, setOrdering] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<TRow | null>(null);
  // с таймлайна задача открывается сразу на «Истории» — видно событие, на которое нажали
  const [editorTab, setEditorTab] = useState<"details" | "history">("details");
  const openRow = (r: TRow, tab: "details" | "history" = "details") => {
    setEditorTab(tab);
    setEditor(r);
  };
  useEffect(() => {
    if (!editor) setEditorTab("details");
  }, [editor]);
  const [tick, setTick] = useState(0);
  // «сегодня» по Москве — для чипов срока; обновляется при смене вида/данных, не в рендере (react-hooks/purity)
  const [today, setToday] = useState(() => mskDay(Date.now()));
  useEffect(() => setToday(mskDay(Date.now())), [tick]);
  useEffect(() => {
    // фильтры → адрес (поиск — с задержкой, чтобы не писать в историю каждую букву)
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      for (const k of FILTER_KEYS) next.delete(k);
      for (const [k, v] of Object.entries(filtersToParams(filters))) next.set(k, v);
      const s = next.toString();
      if (s !== params.toString()) router.replace(s ? `/tracker?${s}` : "/tracker", { scroll: false });
    }, 250);
    return () => clearTimeout(t);
    // params читаем в момент записи: зависеть от него нельзя — запись адреса меняет params и зациклила бы эффект
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

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
    setData(null); // переключение «рабочие ↔ удалённые» не должно показывать чужие строки, пока грузится свой список
  }, [deletedParam]);
  useEffect(() => {
    let alive = true;
    fetch(deletedParam ? "/api/tracker?archive=archived" : "/api/tracker")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Data) => alive && (setData(d), setError(null)))
      .catch((s) => alive && setError(s === 403 ? "Трекер доступен тем, кто работает с таблицей позиций." : "Не удалось загрузить трекер. Обновите страницу."));
    return () => {
      alive = false;
    };
  }, [tick, deletedParam]);
  // ссылка «на трекере» из таблицы: ?item=<id> — сразу открыть карточку
  useEffect(() => {
    const id = params.get("item");
    if (id && data) {
      const r = data.rows.find((x) => x.id === id) ?? null;
      setEditor(r);
      // ссылки из уведомлений на удалённую задачу не должны вести в пустоту
      setMissing(!r && !deletedParam && data.mode !== "sent");
    } else setMissing(false);
  }, [params, data, deletedParam]);

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
  const deleted = deletedParam && !sent;
  const scope = deleted ? "all" : scopeRaw; // охват (контроль, поручения…) к удалённым не относится
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

  // без фильтра по колонке: от него считаются плашки-счётчики (иначе при выбранной колонке остальные обнулились бы)
  const baseRows = useMemo(() => {
    const tokens = tokenize(q);
    return (data?.rows ?? [])
      .map((r) => (manyDirs ? { ...r, segmentName: `${r.directorateName} · ${r.segmentName ?? "Без сегмента"}` } : r))
      .filter((r) => {
      const col = columnOf(r.statusId, colOf);
      // «Не актуально» (отменённые) — только по переключателю: иначе их не найти и «Переоткрыть» недостижим
      if (!deleted && col === "HIDDEN" && !filters.cancelled) return false;
      // «Выполнено»: по умолчанию за последние 14 дней (как в Jira и Linear), остальное — «показать все»
      if (!deleted && col === "DONE" && !filters.doneAll && !isRecentlyDone(byItem.get(r.id) ?? [], r.updatedAt)) return false;
      if (mine && r.ownerId !== me?.id && !(directorial && !r.ownerId && r.createdById === me?.id)) return false;
      if (kind && !data?.hot[r.id]?.kinds.includes(kind)) return false;
      if (slipOnly && !(summaries.get(r.id)?.slips ?? 0)) return false;
      if (scope === "control" && !r.zgdControl) return false;
      if (scope === "orders" && !r.origin) return false;
      if (scope === "mine" && !(r.origin === "ZGD" && r.assignedById === me?.id)) return false;
      if (scope === "waiting" && !(r.openRequest || data?.hot[r.id]?.kinds.includes("request"))) return false;
      if (segmentIds.length && !segmentIds.includes(r.segmentId ?? "none")) return false;
      if (ownerIds.length && !ownerIds.includes(r.ownerId ?? "none")) return false;
      if (tokens.length && !matchesTokens(normalizeText([r.name, r.comment, r.expectedResult, r.blockedBy, r.segmentName, r.trackName, r.ownerName, r.statusName].filter(Boolean).join(" ")), tokens)) return false;
      return true;
    });
  }, [data, colOf, mine, kind, slipOnly, scope, summaries, segmentIds, ownerIds, q, me, manyDirs, directorial, deleted, filters.cancelled, filters.doneAll, byItem]);
  const rows = useMemo(() => (filters.col ? baseRows.filter((r) => columnOf(r.statusId, colOf) === filters.col) : baseRows), [baseRows, colOf, filters.col]);

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

  // «+ Задача» на доске: только название, остальное (срок, исполнитель) доводят в карточке; ответ — текст ошибки или null
  async function quickAdd(title: string): Promise<string | null> {
    const res = await fetch("/api/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    if (res.ok) {
      setTick((t) => t + 1);
      return null;
    }
    const body = await res.json().catch(() => null);
    return body?.message ?? (res.status === 400 ? "Проверьте название: до 300 символов." : res.status === 403 ? "Нет прав создавать задачи." : "Не удалось создать задачу — попробуйте ещё раз.");
  }

  // действие трекера с диалогом (результат, замечание, причина, на чём ждём): перетаскивание, меню и кнопки — один путь
  async function runAction(row: TRow, action: WorkflowAction) {
    setCtx(null);
    if (preview) return setError("В режиме просмотра менять задачи нельзя.");
    setError(null);
    const ask = ASK[action];
    const text = ask ? await askText({ title: ACTION_LABEL[action], message: `«${row.name.slice(0, 160)}»\n${ask.label}`, placeholder: ask.placeholder, multiline: true, required: !ask.optional, maxLength: 2000, okLabel: ACTION_LABEL[action] }) : "";
    if (text === null) return;
    const res = await fetch(`/api/items/${row.id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, version: row.version, ...(ask ? { [ask.field]: text } : {}) }) });
    const d = await res.json().catch(() => null);
    if (!res.ok) setError(d?.message ?? "Не удалось выполнить действие.");
    setTick((t) => t + 1);
  }


  // перенос карточки на доске = смена статуса через обычное сохранение позиции (журнал, справка, права — как в таблице)
  // перенос в «На проверке» / «Выполнено» / обратно — действие трекера с диалогом (результат, замечание, причина)
  async function move(row: TRow, col: TrackerColumnKey) {
    if (!data || columnOf(row.statusId, colOf) === col) return;
    if (preview) return setError("В режиме просмотра менять задачи нельзя.");
    const from = columnOf(row.statusId, colOf);
    if (!dropTargets(from, directorial).includes(col)) return setError("Так задачу перенести нельзя: сдать на проверку, принять, вернуть, отменить и переоткрыть можно только по порядку (меню «⋯» подскажет доступное).");
    const action = dropAction(from, col);
    if (action) return runAction(row, action);
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

  // Меню задачи (список, доска, таймлайн): правая кнопка и «⋯» — открыть, перевести, сдать / принять / вернуть…, удалить / вернуть
  const [ctx, setCtx] = useState<{ x: number; y: number; row: TRow } | null>(null);
  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    // прокрутка закрывает меню, но не та, что сам браузер делает при нажатии (на телефоне доска подтягивает колонку к краю)
    let armed = false;
    const arm = setTimeout(() => (armed = true), 400);
    const scrolled = () => armed && close();
    window.addEventListener("click", close);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", close);
      clearTimeout(arm);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
    };
  }, [ctx]);
  const openMenu = (row: TRow, e: { clientX: number; clientY: number; preventDefault: () => void }) => {
    if (sent) return; // у ЗГД своё меню действий в карточке
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, row });
  };
  const canDeleteRow = (r: TRow) => !!me && !preview && canDeleteItem({ id: me.id, role: me.role as never }, { responsibleId: r.ownerId, createdById: r.createdById, origin: r.origin });
  async function removeRow(row: TRow) {
    setCtx(null);
    const ok = await askConfirm({ title: "Удалить задачу?", message: `«${row.name.slice(0, 120)}» уйдёт в «Удалённые» — оттуда её можно вернуть.`, okLabel: "Удалить", danger: true });
    if (!ok) return;
    const res = await fetch(`/api/items/${row.id}`, { method: "DELETE" });
    if (res.ok) {
      setError(null);
      setNotice(`«${row.name.slice(0, 80)}» удалена. Найти её можно в «Удалённых».`);
      setTick((t) => t + 1);
    } else setError((await res.json().catch(() => null))?.message ?? "Не удалось удалить задачу: удалять может только тот, кто её ведёт.");
  }

  // Пункты меню задачи по роли и состоянию — те же правила, что у кнопок в карточке (lib/workflow.ts availableActions)
  const menuItems = (row: TRow) => {
    const items: Array<{ key: string; label: string; danger?: boolean; run: () => void }> = [{ key: "open", label: "Открыть", run: () => (setCtx(null), openRow(row)) }];
    if (deleted) {
      if (canEditRow(row)) items.push({ key: "restore", label: "Вернуть", run: () => (setCtx(null), void restore(row)) });
      if (canPurgeRow(row)) items.push({ key: "purge", label: "Удалить навсегда", danger: true, run: () => void purgeRow(row) });
      return items;
    }
    if (preview) return items;
    const col = columnOf(row.statusId, colOf);
    if (canEditRow(row)) {
      if (col === "TODO") items.push({ key: "start", label: "Взять в работу", run: () => (setCtx(null), void move(row, "DOING")) });
      if (col === "DOING") items.push({ key: "todo", label: "Вернуть в «Сделать»", run: () => (setCtx(null), void move(row, "TODO")) });
      const acts = me ? availableActions({ id: me.id, role: me.role as never }, { column: col, responsibleId: row.ownerId, createdById: row.createdById, blocked: !!row.blockedBy || row.statusName === STOP_STATUS, archived: false }) : [];
      for (const a of acts) items.push({ key: a, label: ACTION_LABEL[a], danger: a === "cancel", run: () => void runAction(row, a) });
    }
    if (canDeleteRow(row)) items.push({ key: "delete", label: "Удалить", danger: true, run: () => void removeRow(row) });
    return items;
  };

  // вернуть удалённую задачу: сразу видна и в таблице, и в рабочем трекере (это одна и та же позиция)
  // «Удалить навсегда» — как в «Удалённых» таблицы: те же права (lib/permissions.ts canPurgeItem) и тот же маршрут; без возврата
  const canPurgeRow = (r: TRow) => !!me && !preview && canPurgeItem({ id: me.id, role: me.role as never }, { responsibleId: r.ownerId, createdById: r.createdById, origin: r.origin });
  async function purgeRow(row: TRow) {
    setCtx(null);
    const ok = await askConfirm({ title: "Удалить задачу навсегда?", message: `«${row.name.slice(0, 120)}» будет удалена из базы. Восстановить будет нельзя; директор и ответственный получат уведомление.`, okLabel: "Удалить навсегда", danger: true });
    if (!ok) return;
    const res = await fetch(`/api/items/${row.id}/purge`, { method: "POST" });
    if (res.ok) {
      setError(null);
      setNotice(`«${row.name.slice(0, 80)}» удалена навсегда.`);
      setTick((t) => t + 1);
    } else setError((await res.json().catch(() => null))?.message ?? "Не удалось удалить задачу навсегда.");
  }
  async function restore(row: TRow) {
    const res = await fetch(`/api/items/${row.id}/restore`, { method: "POST" });
    if (res.ok) {
      setError(null);
      setNotice(`«${row.name.slice(0, 80)}» возвращена: она снова в таблице и в трекере.`);
      setTick((t) => t + 1);
    } else setError((await res.json().catch(() => null))?.message ?? "Не удалось вернуть задачу.");
  }
  // кто и когда удалил — из журнала («удалена из таблицы»)
  const deletedInfo = (r: TRow) => {
    if (!deleted) return undefined;
    const e = [...(byItem.get(r.id) ?? [])].reverse().find((x) => x.kind === "archived");
    return e ? `удалена ${ruDay(e.at)}${e.who ? ` · ${e.who}` : ""}` : "удалена";
  };

  // колонки доски: «Отменённые» — пятая, когда включены (или в удалённых есть отменённые)
  const cancelledCount = (data?.rows ?? []).filter((r) => columnOf(r.statusId, colOf) === "HIDDEN").length;
  const oldDoneCount = deleted ? 0 : (data?.rows ?? []).filter((r) => columnOf(r.statusId, colOf) === "DONE" && !isRecentlyDone(byItem.get(r.id) ?? [], r.updatedAt)).length;
  const showCancelledCol = filters.cancelled || (deleted && cancelledCount > 0);
  const boardColumns: Array<{ key: TrackerColumnKey; label: string }> = [...BOARD_COLUMNS, ...(showCancelledCol ? [{ key: "HIDDEN" as const, label: "Отменённые" }] : [])];
  const counts = useMemo(() => Object.fromEntries([...BOARD_COLUMNS, { key: "HIDDEN", label: "" }].map((c) => [c.key, baseRows.filter((r) => columnOf(r.statusId, colOf) === c.key).length])), [baseRows, colOf]);
  // директор: изменённые после прошлого подтверждения (или ни разу не подтверждённые) — ЗГД их ещё не видит
  const unconfirmed = (r: TRow) => !sent && !deleted && directorial && (!r.publishedAt || new Date(r.updatedAt).getTime() > new Date(r.publishedAt).getTime());
  const unconfirmedCount = (data?.rows ?? []).filter((r) => columnOf(r.statusId, colOf) !== "HIDDEN" && unconfirmed(r)).length;
  const [publishing, setPublishing] = useState(false);
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
          <h1 className="text-xl font-bold text-on-surface">{deleted ? "Трекер · Удалённые" : "Трекер"}</h1>
          <p className="mt-0.5 max-w-2xl text-[13px] text-on-surface-variant">
            {deleted ? (
              <>Удалённые задачи — те же, что в «Удалённых» таблицы. Верните задачу — и она снова появится и в таблице, и в трекере.</>
            ) : sent ? (
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
          {!deleted && (sent || (directorial && !preview)) && (
            <button onClick={() => setOrdering(true)} className="btn-primary">
              <Plus size={15} /> Дать поручение
            </button>
          )}
          {!sent && !deleted && directorial && !preview && (
            <button onClick={() => (setNotice(null), setPublishing(true))} className="btn-ghost" title="ЗГД видит только подтверждённое вами: посмотрите, что изменилось, и выберите, что показать">
              <ShieldCheck size={15} /> Обновить для ЗГД{unconfirmedCount ? ` (${unconfirmedCount})` : ""}
            </button>
          )}
          {!sent && (
            <Link href={deleted ? "/tracker" : "/tracker?deleted=1"} className="btn-ghost">
              {deleted ? "← К трекеру" : <><Trash2 size={15} /> Удалённые</>}
            </Link>
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
      {missing && (
        <div className="mb-3 rounded-md border border-status-amber/40 bg-status-amber/10 px-3 py-2 text-[13px] text-on-surface">
          Этой задачи нет среди рабочих — возможно, её удалили.{" "}
          <Link href="/tracker?deleted=1" className="font-semibold text-primary hover:underline">
            Посмотреть в «Удалённых»
          </Link>
        </div>
      )}

      {/* итоги для решения «в масштабе»: сколько где (нажатие — фильтр по колонке), что горит, где срок уже сдвигали */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        {boardColumns.map((c) => (
          <button
            key={c.key}
            onClick={() => patch({ col: filters.col === c.key ? null : c.key })}
            aria-pressed={filters.col === c.key}
            title={filters.col === c.key ? "Показать все колонки" : `Показать только «${c.label}»`}
            className={`rounded-full px-2.5 py-1 font-semibold ${filters.col === c.key ? "bg-primary text-white" : "bg-surface-high text-on-surface-variant hover:bg-surface-highest"}`}
          >
            {c.label}: <span className={filters.col === c.key ? "text-white" : "text-on-surface"}>{counts[c.key] ?? 0}</span>
          </button>
        ))}
        {SIGNAL_ORDER.filter((k) => kindCounts.get(k) || kind === k).map((k) => (
          <button key={k} onClick={() => patch({ kind: kind === k ? null : k })} aria-pressed={kind === k} className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${kind === k ? SIGNAL_TONE[k].on : SIGNAL_TONE[k].off}`} title={SIGNAL_HINT[k]}>
            {k === "overdue" && <Flame size={13} />} {SIGNAL_LABEL[k]}: {kindCounts.get(k) ?? 0}
          </button>
        ))}
        {!deleted && (slipped > 0 || slipOnly) && (
          <button onClick={() => patch({ slip: !slipOnly })} aria-pressed={slipOnly} className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${slipOnly ? "bg-[#b45309] text-white" : "bg-status-amber/15 text-[#b45309]"}`} title="Задачи, у которых срок переносили позже — нажмите, чтобы показать только их">
            <Timer size={13} /> Срок сдвигали: {slipped}
          </button>
        )}
        {/* режимы показа: по умолчанию выполненное — за 14 дней, отменённое скрыто (иначе вид зарастает архивом) */}
        {!deleted && !sent && (oldDoneCount > 0 || filters.doneAll) && (
          <button onClick={() => patch({ doneAll: !filters.doneAll })} aria-pressed={filters.doneAll} className="rounded-full border border-dashed border-outline px-2.5 py-1 font-semibold text-on-surface-variant hover:bg-surface-high" title="По умолчанию выполненные задачи видны за последние 14 дней">
            {filters.doneAll ? "Выполненные: все — скрыть старые" : `Скрыто выполненных старше ${DONE_WINDOW_DAYS} дн.: ${oldDoneCount} — показать`}
          </button>
        )}
        {!deleted && !sent && (cancelledCount > 0 || filters.cancelled) && (
          <button onClick={() => patch({ cancelled: !filters.cancelled })} aria-pressed={filters.cancelled} className="rounded-full border border-dashed border-outline px-2.5 py-1 font-semibold text-on-surface-variant hover:bg-surface-high" title="Отменённые («Не актуально») скрыты — нажмите, чтобы увидеть и при необходимости переоткрыть">
            {filters.cancelled ? "Отменённые: показаны — скрыть" : `Отменённые: ${cancelledCount} — показать`}
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!sent && (
        <div className="flex rounded-md border border-outline-variant bg-surface p-0.5 text-[13px]">
          <button onClick={() => patch({ mine: false })} className={`rounded px-3 py-1 font-semibold ${!mine ? "bg-primary-soft text-primary" : "text-on-surface-variant"}`}>Все задачи</button>
          <button onClick={() => patch({ mine: true })} className={`rounded px-3 py-1 font-semibold ${mine ? "bg-primary-soft text-primary" : "text-on-surface-variant"}`}>Мои задачи</button>
        </div>
        )}
        {!deleted && (
        <div className="flex rounded-md border border-outline-variant bg-surface p-0.5 text-[13px]" aria-label="Охват">
          {([
            ["all", "Все"],
            ["control", "На контроле"],
            ["orders", "Поручения"],
            ...(sent ? ([["mine", "Мои поручения"]] as const) : []),
            ["waiting", sent ? "Ждут ответа" : "Запросы ЗГД"],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => patch({ scope: k })} aria-pressed={scope === k} className={`rounded px-3 py-1 font-semibold ${scope === k ? "bg-primary-soft text-primary" : "text-on-surface-variant"}`}>{label}</button>
          ))}
        </div>
        )}
        <FilterChip label="Сегмент" value={segmentIds} options={[...segRefs.map((s) => ({ id: s.id, name: s.name })), { id: "none", name: "Без сегмента" }]} onChange={(v) => patch({ seg: v })} />
        <FilterChip label="Ответственный" value={ownerIds} options={[...ownerOptions, { id: "none", name: "Не назначен" }]} onChange={(v) => patch({ owner: v })} />
        {hasActiveFilters(filters) && (
          <button onClick={() => setFilters({ ...EMPTY_FILTERS, cancelled: filters.cancelled, doneAll: filters.doneAll })} className="btn-ghost h-8 text-[12px]" title="Снять все фильтры и поиск">
            <X size={14} /> Сбросить фильтры
          </button>
        )}
        <label className="relative ml-auto max-md:ml-0 max-md:w-full">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-outline" />
          <input value={q} onChange={(e) => patch({ q: e.target.value })} placeholder="Поиск по задачам" className="input w-64 pl-8 max-md:w-full" aria-label="Поиск по задачам" />
        </label>
      </div>

      {error && <div className="mb-3 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-[13px] text-status-red">{error}</div>}
      {!data && !error && (view === "board" ? (
        <div className="flex gap-3">
          {[0, 1, 2, 3].map((c) => (
            <div key={c} className="min-w-64 flex-1 space-y-2 rounded-lg border border-outline-variant bg-surface-low p-2">
              <div className="skeleton h-5 w-24 rounded" />
              {[0, 1, 2].slice(0, 3 - (c % 2)).map((k) => <div key={k} className="skeleton h-24 w-full rounded-lg" />)}
            </div>
          ))}
        </div>
      ) : <div className="skeleton h-64 w-full rounded-lg" />)}
      {data && rows.length === 0 && (
        <div className="surface px-4 py-10 text-center text-[13px] text-on-surface-variant">
          <p>{hasActiveFilters(filters) ? "Задач по этим условиям нет." : deleted ? "Удалённых задач нет." : "Задач пока нет."}</p>
          {hasActiveFilters(filters) && (
            <button onClick={() => setFilters({ ...EMPTY_FILTERS, cancelled: filters.cancelled, doneAll: filters.doneAll })} className="btn-ghost mt-3 h-8">
              Сбросить фильтры
            </button>
          )}
        </div>
      )}

      {data && rows.length > 0 && view === "list" && <TrackerList today={today} rows={rows} colOf={colOf} hot={data.hot} summaries={summaries} colors={colors} onOpen={openRow} onMenu={sent ? undefined : openMenu} unconfirmed={unconfirmed} deletedInfo={deletedInfo} onRestore={restore} canRestore={canEditRow} />}
      {data && rows.length > 0 && view === "board" && (
        <TrackerBoard rows={rows} colOf={colOf} hot={data.hot} summaries={summaries} colors={colors} onOpen={openRow} onMenu={sent ? undefined : openMenu} unconfirmed={unconfirmed} deletedInfo={deletedInfo} columns={filters.col ? boardColumns.filter((c) => c.key === filters.col) : boardColumns} canMove={(r) => !sent && !deleted && canEditRow(r) && !preview} director={directorial} onMove={move} mainStatus={new Map(BOARD_COLUMNS.map((c) => [c.key, statusForColumn(c.key, data.statuses)]))} today={today} doneAt={(r) => new Date(closedAtOf(byItem.get(r.id) ?? [], r.updatedAt)).toISOString()} onQuickAdd={!sent && !deleted && !preview && me && canCreateItem(me.role as never) ? quickAdd : undefined} />
      )}
      {data && rows.length > 0 && view === "timeline" && <TrackerTimeline rows={rows} colOf={colOf} statusColumns={new Map(data.statuses.map((s) => [s.name, s.trackerColumn]))} hot={data.hot} events={byItem} colors={colors} onOpen={openRow} onMenu={sent ? undefined : openMenu} />}

      {/* тот же чат, что на «Оперативке»: ЗГД, директор, админ; разговор продолжается при переходе */}
      {aiUser && sent && <AiChat versionIds={[]} scopeLabel="трекер и последние справки дирекций" inherit quick={TRACKER_QUICK} />}
      {aiUser && !sent && <Operativshchik scope="трекер, таблица и архив справок" />}
      {editor && sent && <ZgdPanel key={editor.id} row={editor} events={byItem.get(editor.id) ?? []} hot={data?.hot[editor.id]} onClose={() => setEditor(null)} onChanged={() => setTick((t) => t + 1)} />}
      {publishing && !sent && (
        <PublishPanel
          onClose={() => setPublishing(false)}
          onOpen={(id) => {
            setPublishing(false);
            setEditor(data?.rows.find((r) => r.id === id) ?? null);
          }}
          onDone={(n) => {
            setPublishing(false);
            const word = n % 10 === 1 && n % 100 !== 11 ? "задача" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "задачи" : "задач";
            setNotice(`ЗГД увидит актуальное состояние: ${n} ${word}.`);
            setTick((t) => t + 1);
          }}
        />
      )}
      {ordering && !sent && (
        <OrderPanel
          mode="director"
          // исполнители — кто ведёт позиции: руководители, директор, админ «подаёт как руководитель» (то же правило на сервере)
          people={(boot?.users ?? []).filter((u) => u.role === "HEAD" || u.role === "DIRECTOR" || (u.role === "ADMIN" && !!u.submits))}
          segments={(boot?.segments ?? []).map((x) => ({ id: x.id, name: x.name }))}
          onClose={() => setOrdering(false)}
          onDone={() => {
            setOrdering(false);
            setNotice("Поручение отправлено исполнителю. Примете работу вы — после сдачи на проверку.");
            setTick((x) => x + 1);
          }}
        />
      )}
      {ordering && sent && (
        <OrderPanel
          people={data?.people ?? []}
          directorates={data?.directorates ?? []}
          onClose={() => setOrdering(false)}
          onDone={() => {
            setOrdering(false);
            setNotice("Поручение отправлено: директор в курсе, исполнитель (если выбран) получил уведомление. Задача на вашем контроле.");
            setTick((t) => t + 1);
          }}
        />
      )}
      {ctx && (
        <div
          role="menu"
          className="fixed z-50 w-60 overflow-hidden rounded-md border border-outline-variant bg-surface py-1 shadow-lg"
          style={{ left: Math.max(8, Math.min(ctx.x, window.innerWidth - 248)), top: Math.max(8, Math.min(ctx.y, window.innerHeight - 40 - menuItems(ctx.row).length * 36)) }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menuItems(ctx.row).map((it) => (
            <button key={it.key} role="menuitem" onClick={it.run} className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] ${it.danger ? "text-status-red hover:bg-status-red/10" : "text-on-surface hover:bg-primary-soft"}`}>
              {it.key === "restore" && <RotateCcw size={14} className="text-outline" />}
              {it.key === "delete" && <Trash2 size={14} />}
              {it.label}
            </button>
          ))}
          {!deleted && !canDeleteRow(ctx.row) && <p className="px-3.5 py-2 text-[11px] text-outline">{ctx.row.origin ? "Поручение удаляет директор." : "Удалять может только тот, кто ведёт задачу."}</p>}
        </div>
      )}
      {editor && !sent && (
        <ItemPanel
          key={editor.id}
          row={editor}
          initialTab={editorTab}
          prefill={null}
          onRowUpdated={() => setTick((t) => t + 1)}
          refs={refs}
          defaultResponsibleId={me?.id ?? ""}
          lockResponsible={me?.role === "HEAD"}
          canEdit={canEditRow(editor)}
          canDelete={!!me && !preview && canDeleteItem({ id: me.id, role: me.role as never }, { responsibleId: editor.ownerId, createdById: editor.createdById, origin: editor.origin })}
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

export type MenuHandler = (r: TRow, e: { clientX: number; clientY: number; preventDefault: () => void }) => void;
export type Common = { today: number; rows: TRow[]; colOf: Map<string, TrackerColumnKey | null>; hot: Record<string, HotInfo>; summaries: Map<string, TaskSummary>; colors: Map<string, string>; onOpen: (r: TRow) => void; unconfirmed?: (r: TRow) => boolean; /** Удалённые: подпись «удалена …» (нет — рабочая задача). */ deletedInfo?: (r: TRow) => string | undefined; onRestore?: (r: TRow) => void; canRestore?: (r: TRow) => boolean; /** Меню действий: правая кнопка и кнопка «⋯» (для телефона и клавиатуры). */ onMenu?: MenuHandler };

/** Кнопка «⋯» — то же меню действий, что по правой кнопке: на телефоне и с клавиатуры других путей к нему нет. */
export function MenuButton({ row, onMenu, className = "" }: { row: TRow; onMenu?: MenuHandler; className?: string }) {
  if (!onMenu) return null;
  return (
    <button
      type="button"
      aria-label={`Действия: ${row.name}`}
      title="Действия с задачей"
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onMenu(row, { clientX: r.right - 8, clientY: r.bottom, preventDefault: () => {} });
      }}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-outline hover:bg-surface-high hover:text-on-surface max-md:opacity-100 md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100 ${className}`}
    >
      <MoreHorizontal size={16} />
    </button>
  );
}

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

/** Важность плашки на доске: меньше — важнее (просрочка → стоп → запрос ЗГД → срок сдвигали → поручение → контроль → подтверждение). */
const SIGNAL_RANK: Record<SignalKind, number> = { overdue: 1, blocker: 2, request: 3, deadlineRequest: 4, slipped: 4, review: 5, soon: 6, data: 9, report: 9 };

/** Метки задачи: горит, срок сдвигали, давно без движения. max — сколько показать (доска: 3 важнейших и «+N»), без max — все (список). */
export function Marks({ row, hot, summary, done, unconfirmed, deletedInfo, cancelled, max }: { row: TRow; hot?: HotInfo; summary?: TaskSummary; done?: boolean; unconfirmed?: boolean; deletedInfo?: string; cancelled?: boolean; max?: number }) {
  // удалённая задача — только кто и когда удалил: сигналы и «не подтверждено» к архиву не относятся
  if (deletedInfo)
    return (
      <>
        {row.origin && <span className="rounded-sm bg-[#7c3aed]/10 px-1.5 py-px text-[11px] font-semibold text-[#7c3aed]">{row.origin === "ZGD" ? "поручение ЗГД" : "поручение директора"}</span>}
        <span className="rounded-sm bg-surface-high px-1.5 py-px text-[11px] font-semibold text-on-surface-variant">{deletedInfo}</span>
      </>
    );
  const items: Array<{ rank: number; label: string; node: React.ReactNode }> = [];
  const add = (rank: number, label: string, node: React.ReactNode) => items.push({ rank, label, node });
  if (cancelled) add(0, `отменена${row.cancelReason ? `: ${row.cancelReason}` : ""}`, <span className="rounded-sm bg-surface-high px-1.5 py-px text-[11px] font-semibold text-on-surface-variant">отменена{row.cancelReason ? `: ${row.cancelReason.slice(0, 60)}` : ""}</span>);
  if (row.origin) add(7, row.origin === "ZGD" ? "поручение ЗГД" : "поручение директора", <span className="rounded-sm bg-[#7c3aed]/10 px-1.5 py-px text-[11px] font-semibold text-[#7c3aed]" title={row.assignedByName ? `Поручение: ${row.assignedByName}` : undefined}>{row.origin === "ZGD" ? "поручение ЗГД" : "поручение директора"}</span>);
  if (row.zgdControl) add(8, "на контроле у ЗГД", <span className="inline-flex items-center gap-1 rounded-sm bg-status-amber/15 px-1.5 py-px text-[11px] font-semibold text-[#b45309]" title="ЗГД взял на контроль: перенос срока — только с согласия директора"><Star size={10} /> на контроле</span>);
  if (unconfirmed) add(9, "не подтверждено для ЗГД", <span className="rounded-sm border border-dashed border-outline px-1.5 py-px text-[11px] text-on-surface-variant" title="Изменена после прошлого подтверждения — ЗГД видит прежнее состояние. «Обновить для ЗГД» или решение по задаче подтвердит.">не подтверждено для ЗГД</span>);
  // сигнал = вид + причина и «что сделать» в подсказке; на доске «срок близко» и «просрочка» не дублируем: их показывает чип срока
  for (const k of hot?.kinds ?? []) {
    if (max !== undefined && (k === "soon" || k === "overdue")) continue;
    add(SIGNAL_RANK[k], SIGNAL_LABEL[k].toLowerCase(), (
      <span className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-[11px] font-semibold ${SIGNAL_TONE[k].off}`} title={hot?.reasons.filter((x) => x.startsWith(SIGNAL_LABEL[k])).join("\n")}>
        {k === "overdue" && <Flame size={11} />} {SIGNAL_LABEL[k].toLowerCase()}
      </span>
    ));
  }
  if (summary && summary.slips > 0)
    add(4, `срок сдвигали ${summary.slips}×`, <span className="rounded-sm bg-status-amber/15 px-1.5 py-px text-[11px] font-semibold text-[#b45309]" title="Срок переносили позже">срок сдвигали {summary.slips}× (+{summary.slipDays} дн.)</span>);
  if (!done && !cancelled && summary?.idleDays !== null && summary && summary.idleDays >= 14)
    add(9, `без движения ${summary.idleDays} дн.`, <span className="rounded-sm bg-surface-high px-1.5 py-px text-[11px] font-semibold text-on-surface-variant" title="Последнее изменение задачи">без движения {summary.idleDays} дн.</span>);
  if (row.inMemo !== undefined) {
    if (row.inMemo) add(10, "в справке", <span className="rounded-sm bg-primary-soft px-1.5 py-px text-[11px] font-semibold text-primary" title="Вошла в последнюю отправленную справку">в справке</span>);
  } else if (row.operFlag) add(10, "подана в справку", <span className="rounded-sm bg-primary-soft px-1.5 py-px text-[11px] font-semibold text-primary">подана в справку</span>);
  // список — по порядку важности тоже, но целиком; доска — max важнейших и «+N» с перечнем
  const { shown, hidden } = max === undefined ? { shown: items.sort((a, b) => a.rank - b.rank), hidden: [] } : pickTop(items, max);
  return (
    <>
      {shown.map((m, i) => <Fragment key={i}>{m.node}</Fragment>)}
      {hidden.length > 0 && <span className="rounded-sm bg-surface-high px-1.5 py-px text-[11px] font-semibold text-on-surface-variant" title={hidden.map((h) => h.label).join("\n")}>+{hidden.length}</span>}
    </>
  );
}

/** Срок: чип по близости (красный — просрочено, янтарный — ≤ 3 дн.) или «принято дд.мм» у выполненных. */
export function Deadline({ row, col, today, closedAt, chip = false }: { row: TRow; col: TrackerColumnKey; today: number; closedAt?: string | null; chip?: boolean }) {
  const c = deadlineChip(row.deadline, today, { overdue: overdue(row, col), column: col, closedAt });
  if (!chip) return <span className={c.tone === "red" ? "font-semibold text-status-red" : c.tone === "none" ? "text-outline" : "text-on-surface-variant"} title={c.tone === "red" ? c.text : c.title}>{row.deadline ? `до ${ruDay(row.deadline)}` : c.text}</span>;
  const tone = { red: "bg-status-red/10 text-status-red", amber: "bg-status-amber/15 text-[#b45309]", green: "bg-status-emerald/10 text-status-emerald", grey: "bg-surface-high text-on-surface-variant", none: "text-outline" }[c.tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${tone}`} title={c.title}>{c.tone === "red" && <Flame size={11} />}{c.tone === "green" && <Check size={11} />}{c.text}</span>;
}

function TrackerList({ today, rows, colOf, hot, summaries, colors, onOpen, onMenu, unconfirmed, deletedInfo, onRestore, canRestore }: Common) {
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
                  const dim = !!deletedInfo?.(r) || col === "HIDDEN";
                  return (
                    <li key={r.id} className={`group flex items-center border-t border-outline-variant/50 ${dim ? "opacity-70" : ""}`}>
                      <button onClick={() => onOpen(r)} onContextMenu={(e) => onMenu?.(r, e)} className="row-hover flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left">
                        <span className="min-w-0 flex-1 basis-72 text-[13px] text-on-surface [overflow-wrap:anywhere]">{r.name}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Marks row={r} hot={hot[r.id]} summary={summaries.get(r.id)} done={col === "DONE"} cancelled={col === "HIDDEN"} unconfirmed={unconfirmed?.(r)} deletedInfo={deletedInfo?.(r)} />
                        </span>
                        <span className="w-32 shrink-0"><StatusPill name={r.statusName ?? "Без статуса"} color={r.statusColor} /></span>
                        <span className="flex w-40 shrink-0 items-center gap-1.5 truncate text-[12px] text-on-surface-variant">
                          {r.ownerName && <PersonAvatar name={r.ownerName} size={20} />} {r.ownerName ?? "не назначен"}
                        </span>
                        <span className="w-24 shrink-0 text-[12px]"><Deadline row={r} col={col} today={today} /></span>
                      </button>
                      {deletedInfo?.(r) && canRestore?.(r) && (
                        <button onClick={() => onRestore?.(r)} className="btn-ghost m-1.5 h-8 shrink-0 self-center">
                          <RotateCcw size={14} /> Вернуть
                        </button>
                      )}
                      <MenuButton row={r} onMenu={onMenu} className="mr-2" />
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
