/**
 * «Трекер» — другие виды той же общей таблицы: доска по колонкам и таймлайн истории задачи.
 * Своих данных у трекера нет: задача = позиция таблицы, колонка = статус (Status.trackerColumn),
 * история = журнал правок (audit_events) + отправленные справки (memo_versions). Чистые функции, без базы.
 */
import { STOP_STATUS } from "@/lib/statuses";

/** Сигналы задачи (lib/ai-table.ts signals): виды и причины «→ что сделать». */
export type HotInfo = { kinds: Array<"overdue" | "slipped" | "deadlineRequest" | "soon" | "blocker" | "review" | "request" | "data" | "report">; reasons: string[] };

/** Настройка (app_settings): false — пункт «Трекер» скрыт у всех. Откат без выкладки. */
export const TRACKER_SETTING = "tracker.enabled";

export type TrackerColumnKey = "TODO" | "DOING" | "REVIEW" | "DONE" | "HIDDEN";

/** Колонки доски по порядку; HIDDEN («Не актуально») на доске не показывается. */
export const BOARD_COLUMNS: Array<{ key: Exclude<TrackerColumnKey, "HIDDEN">; label: string }> = [
  { key: "TODO", label: "Сделать" },
  { key: "DOING", label: "В работе" },
  { key: "REVIEW", label: "На проверке" },
  { key: "DONE", label: "Выполнено" },
];

export const COLUMN_LABEL: Record<TrackerColumnKey, string> = { TODO: "Сделать", DOING: "В работе", REVIEW: "На проверке", DONE: "Выполнено", HIDDEN: "Не показывать" };

/** Колонка задачи: по статусу; без статуса или у статуса без колонки — «Сделать». */
export function columnOf(statusId: string | null | undefined, columns: Map<string, TrackerColumnKey | null>): TrackerColumnKey {
  return (statusId ? columns.get(statusId) : null) ?? "TODO";
}

/** Статус, который ставится при переносе карточки в колонку: первый по порядку статус этой колонки. */
export function statusForColumn(col: TrackerColumnKey, statuses: Array<{ id: string; name?: string; trackerColumn?: TrackerColumnKey | null }>): string | null {
  const inCol = statuses.filter((s) => (s.trackerColumn ?? "TODO") === col);
  // «На стопе» ставится только действием с причиной — перенос в колонку его не выбирает
  return (inCol.find((s) => s.name !== STOP_STATUS) ?? inCol[0])?.id ?? null;
}

export type TrackerEventKind = "created" | "status" | "deadline" | "text" | "submitted" | "unsubmitted" | "owner" | "files" | "edit" | "archived" | "restored" | "memo" | "workflow";

export type TrackerEvent = {
  itemId: string;
  /** ISO-время события. */
  at: string;
  kind: TrackerEventKind;
  who: string | null;
  /** Что произошло, по-человечески: «статус: В работе → На проверке». */
  text: string;
  /** Срок сдвинули позже — главный сигнал для директора. */
  slip?: number;
  /** Было → стало (названия/даты) — для журнала ИИ у ЗГД. */
  before?: string | null;
  after?: string | null;
};

/** Сырая запись журнала (как в audit_events), с именем того, кто правил. */
export type RawAudit = { entityId: string; action: string; fieldName: string | null; before: string | null; after: string | null; timestamp: Date | string; who: string | null };

/** Отправленная справка: когда, как называлась и какие позиции в неё вошли. */
export type MemoSent = { at: Date | string; title: string; itemIds: string[]; /** Редакция справки (после возврата ЗГД — 2, 3…). */ revision?: number };

const FIELD_LABEL: Record<string, string> = { cost: "оценка", attractivenessId: "внимание", segmentId: "сегмент", trackId: "трек", expectedResult: "ожидаемый результат" };

/** Действия трекера в журнале (fieldName "workflow:<действие>", after — результат / причина / на чём ждём). */
const WORKFLOW_TEXT: Record<string, (t: string | null) => string> = {
  submit: (t) => `сдана на проверку${t ? `: ${t}` : ""}`,
  accept: (t) => `принята директором${t ? ` (${t})` : ""}`,
  return: (t) => `возвращена на доработку${t ? `: ${t}` : ""}`,
  block: (t) => `на стопе${t ? `: ждём ${t}` : ""}`,
  unblock: () => "снята со стопа",
  cancel: (t) => `отменена${t ? `: ${t}` : ""}`,
  reopen: (t) => `переоткрыта${t ? `: ${t}` : ""}`,
};
const DAY = 24 * 3600 * 1000;
/** Смена статуса и действие трекера из одной транзакции — не дальше этого друг от друга. */
const PAIR_MS = 5000;
const iso = (d: Date | string) => (typeof d === "string" ? new Date(d) : d).toISOString();
export const ruDay = (d: Date | string) => new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Europe/Moscow" });

/** Сдвиг срока в днях (плюс — позже), если обе даты есть. */
function slipDays(before: string | null, after: string | null): number | undefined {
  if (!before || !after) return undefined;
  const d = Math.round((new Date(after).getTime() - new Date(before).getTime()) / DAY);
  return d || undefined;
}

/**
 * События таймлайна из журнала и отправленных справок, по времени.
 * Правки одного вида одной задачи в одну минуту (одно сохранение) склеиваются в одно событие.
 */
export function buildEvents(audit: RawAudit[], memos: MemoSent[], names: { status: Map<string, string>; user: Map<string, string> }): TrackerEvent[] {
  const out: TrackerEvent[] = [];
  const st = (id: string | null) => (id ? names.status.get(id) ?? "—" : "без статуса");
  const us = (id: string | null) => (id ? names.user.get(id) ?? "—" : "не назначен");
  for (const a of audit) {
    const base = { itemId: a.entityId, at: iso(a.timestamp), who: a.who };
    const f = a.fieldName;
    if (a.action === "CREATE") out.push({ ...base, kind: "created", text: "задача создана" });
    else if (a.action === "ARCHIVE") out.push({ ...base, kind: "archived", text: "удалена из таблицы" });
    else if (a.action === "RESTORE") out.push({ ...base, kind: "restored", text: "возвращена из удалённых" });
    else if (f === "statusId") out.push({ ...base, kind: "status", text: `статус: ${st(a.before)} → ${st(a.after)}`, before: st(a.before), after: st(a.after) });
    else if (f === "deadline") {
      const slip = slipDays(a.before, a.after);
      const text = !a.before ? `назначен срок ${a.after ? ruDay(a.after) : "—"}` : !a.after ? `срок снят (был ${ruDay(a.before)})` : `срок: ${ruDay(a.before)} → ${ruDay(a.after)}${slip ? ` (${slip > 0 ? "+" : ""}${slip} дн.)` : ""}`;
      out.push({ ...base, kind: "deadline", text, ...(slip && slip > 0 ? { slip } : {}) });
    } else if (f === "operFlag") out.push({ ...base, kind: a.after === "true" ? "submitted" : "unsubmitted", text: a.after === "true" ? "подана в справку" : "отозвана из справки" });
    else if (f === "responsibleId") out.push({ ...base, kind: "owner", text: `ответственный: ${us(a.before)} → ${us(a.after)}` });
    else if (f === "title" || f === "comment") out.push({ ...base, kind: "text", text: f === "title" ? "обновлён текст задачи" : "обновлён комментарий" });
    else if (f === "files") out.push({ ...base, kind: "files", text: "изменены документы" });
    else if (f?.startsWith("workflow:")) out.push({ ...base, kind: "workflow", text: (WORKFLOW_TEXT[f.slice(9)] ?? (() => f.slice(9)))(a.after ? a.after.slice(0, 160) : null) });
    else if (f === "deadlineReason") out.push({ ...base, kind: "deadline", text: `причина переноса срока: ${a.after ?? "—"}` });
    else if (f) out.push({ ...base, kind: "edit", text: `изменено: ${FIELD_LABEL[f] ?? (f.startsWith("custom:") ? "своя колонка" : f)}` });
  }
  for (const m of memos) for (const id of m.itemIds) out.push({ itemId: id, at: iso(m.at), kind: "memo", who: null, text: `вошла в отправленную справку «${m.title}»${m.revision && m.revision > 1 ? ` (ред. ${m.revision})` : ""}` });
  out.sort((x, y) => x.at.localeCompare(y.at));
  // одно сохранение = одно событие на вид (заголовок и комментарий разом → «обновлён текст задачи»);
  // смена статуса, сделанная действием трекера (сдал / принял / вернул…), описана самим действием — без повтора
  // (но сама смена — было → стало — переходит в событие действия: по ней считаются дни в колонке и фазы на таймлайне)
  // Пара «действие ↔ смена статуса» — по ближайшему времени (обе записи пишутся одной транзакцией, разница — миллисекунды),
  // каждая смена — только одному действию: сдали и тут же приняли в ту же минуту — у каждого действия своя смена.
  const statuses = out.filter((e) => e.kind === "status");
  const used = new Set<TrackerEvent>();
  const pair = new Map<TrackerEvent, TrackerEvent>();
  for (const w of out) {
    if (w.kind !== "workflow") continue;
    const t = Date.parse(w.at);
    let best: TrackerEvent | null = null;
    for (const s of statuses) {
      if (s.itemId !== w.itemId || used.has(s)) continue;
      const d = Math.abs(Date.parse(s.at) - t);
      if (d <= PAIR_MS && (!best || d < Math.abs(Date.parse(best.at) - t))) best = s;
    }
    if (best) {
      used.add(best);
      pair.set(w, best);
    }
  }
  const seen = new Set<string>();
  return out.map((e) => (pair.has(e) ? { ...e, before: pair.get(e)!.before, after: pair.get(e)!.after } : e)).filter((e) => {
    if (used.has(e)) return false;
    const k = `${e.itemId}|${e.kind}|${e.at.slice(0, 16)}|${e.kind === "status" || e.kind === "deadline" || e.kind === "owner" || e.kind === "memo" || e.kind === "workflow" ? e.text : ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type TaskSummary = {
  /** Сколько раз срок сдвигали позже и на сколько дней в сумме. */
  slips: number;
  slipDays: number;
  /** Дней с последнего движения (любая правка, кроме попадания в справку). */
  idleDays: number | null;
  lastMoveAt: string | null;
};

/** Сводка движения задачи — считает программа (её же пересказывает ИИ, не выдумывая). */
export function summarize(events: TrackerEvent[], now: Date = new Date()): TaskSummary {
  const moves = events.filter((e) => e.kind !== "memo");
  const last = moves.length ? moves[moves.length - 1].at : null;
  const slipped = events.filter((e) => e.slip);
  return {
    slips: slipped.length,
    slipDays: slipped.reduce((s, e) => s + (e.slip ?? 0), 0),
    idleDays: last ? Math.max(0, Math.floor((now.getTime() - new Date(last).getTime()) / DAY)) : null,
    lastMoveAt: last,
  };
}

/** Недели оси таймлайна: от понедельника недели самого раннего события до недели после max(срок, сегодня). */
export function timelineRange(dates: Array<Date | string | null | undefined>, now: Date = new Date()): { from: number; to: number } {
  // шкала строится по разумному окну (3 года в обе стороны): одна ошибочная дата не должна растянуть её на тысячи дней
  const lo = now.getTime() - 3 * 365 * DAY;
  const hi = now.getTime() + 3 * 365 * DAY;
  const ts = dates.filter((d): d is Date | string => !!d).map((d) => new Date(d).getTime()).filter((t) => Number.isFinite(t) && t >= lo && t <= hi);
  const monday = (t: number) => {
    const d = new Date(t);
    const wd = (d.getUTCDay() + 6) % 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - wd * DAY;
  };
  const min = Math.min(now.getTime(), ...ts);
  const max = Math.max(now.getTime(), ...ts);
  return { from: monday(min), to: monday(max) + 14 * DAY };
}

/** Смена статуса: отдельная правка или действие трекера, которое сменило статус (сдал, принял, на стоп…). */
export const isStatusChange = (e: TrackerEvent) => (e.kind === "status" || e.kind === "workflow") && !!e.after;

/** Отрезок жизни задачи на таймлайне: в каком статусе (колонке) была с from по to (мс). */
export type Phase = { from: number; to: number; status: string | null; column: TrackerColumnKey; stop: boolean };

/**
 * Фазы задачи по сменам статуса: с первого известного события до сегодня (у закрытой — до дня закрытия).
 * Статус до первой смены — «было» этой смены, иначе текущий. Только что было известно из истории — раньше неё ничего не рисуем.
 */
export function phasesOf(events: TrackerEvent[], current: { status: string | null; column: TrackerColumnKey }, columnOfName: (name: string | null) => TrackerColumnKey, now: number = Date.now()): { phases: Phase[]; closedAt: number | null } {
  if (!events.length) return { phases: [], closedAt: null };
  const changes = events.filter(isStatusChange);
  const closed = current.column === "DONE" || current.column === "HIDDEN";
  const out: Phase[] = [];
  let status: string | null = changes[0]?.before ?? current.status;
  let t = new Date(events[0].at).getTime();
  const push = (to: number) => {
    if (to > t) out.push({ from: t, to, status, column: columnOfName(status), stop: status === STOP_STATUS });
  };
  for (const c of changes) {
    const at = new Date(c.at).getTime();
    push(at);
    status = c.after ?? status;
    t = Math.max(t, at);
  }
  // история могла не знать последней смены — хвост рисуем текущим статусом
  const knownClose = closed && changes.length > 0 && columnOfName(status) === current.column;
  if (status !== current.status) status = current.status;
  // день закрытия известен, только если в истории есть сама смена на «Выполнено» / «Не актуально»
  if (closed) return { phases: out, closedAt: knownClose ? t : null };
  push(Math.max(now, t));
  return { phases: out, closedAt: null };
}

/** Движение задачи для ИИ и списков: колонка и сколько дней в ней, переносы срока, простой, короткая история. */
export type Motion = {
  column: TrackerColumnKey;
  /** Дней в текущей колонке (с последней смены статуса или с появления задачи); null — неизвестно. */
  inColumnDays: number | null;
  slips: number;
  slipDays: number;
  idleDays: number | null;
  /** Последние события: «03.10.26 — статус: В работе → На проверке (Майков Т.Г.)». */
  history: string[];
};

export function motionOf(events: TrackerEvent[], column: TrackerColumnKey, now: Date = new Date(), historyMax = 8): Motion {
  const s = summarize(events, now);
  const lastCol = [...events].reverse().find((e) => isStatusChange(e) || e.kind === "created");
  return {
    column,
    inColumnDays: lastCol ? Math.max(0, Math.floor((now.getTime() - new Date(lastCol.at).getTime()) / DAY)) : null,
    slips: s.slips,
    slipDays: s.slipDays,
    idleDays: s.idleDays,
    history: events.slice(-historyMax).map((e) => `${ruDay(e.at)} — ${e.text}${e.who ? ` (${e.who})` : ""}`),
  };
}

/** «3 дн.», а 0 — «меньше дня» (а не «0 дн.»). */
export const daysText = (d: number) => (d === 0 ? "меньше дня" : `${d} дн.`);

/** Строка «трекер: …» в карточке позиции для модели. */
export function motionText(m: Motion): string {
  return [
    `колонка «${COLUMN_LABEL[m.column]}»${m.inColumnDays !== null ? ` ${daysText(m.inColumnDays)}` : ""}`,
    m.slips ? `срок переносили позже ${m.slips}× (+${m.slipDays} дн.)` : "срок не переносили",
    m.idleDays !== null ? (m.idleDays === 0 ? "последнее движение сегодня" : `последнее движение ${m.idleDays} дн. назад`) : null,
  ]
    .filter(Boolean)
    .join("; ");
}

// ---------- доска: допустимые переходы, окно «Выполнено», фильтры в адресе

import type { WorkflowAction } from "@/lib/workflow";

/**
 * В какие колонки можно перенести карточку из этой колонки (перетаскивание и меню). Руководитель двигает свои задачи
 * только «Сделать ↔ В работе» и «на проверку»; приёмка, возврат, отмена, переоткрытие — директор (как в lib/workflow.ts).
 * Остальное недопустимо, а не «как-нибудь»: например «На проверке» → «Сделать» раньше выполняло «вернуть» и задача
 * оказывалась в «В работе», а не там, куда бросили.
 */
export function dropTargets(from: TrackerColumnKey, director: boolean): TrackerColumnKey[] {
  switch (from) {
    case "TODO":
      return director ? ["DOING", "REVIEW", "HIDDEN"] : ["DOING", "REVIEW"];
    case "DOING":
      return director ? ["TODO", "REVIEW", "HIDDEN"] : ["TODO", "REVIEW"];
    case "REVIEW":
      return director ? ["DOING", "DONE", "HIDDEN"] : [];
    case "DONE":
    case "HIDDEN":
      return director ? ["DOING"] : [];
  }
}

/** Действие трекера, которое выполняет перенос «из → в»; null — обычная смена статуса (Сделать ↔ В работе). */
export function dropAction(from: TrackerColumnKey, to: TrackerColumnKey): WorkflowAction | null {
  if (to === "REVIEW") return "submit";
  if (to === "DONE") return "accept";
  if (to === "HIDDEN") return "cancel";
  if (to === "DOING" && from === "REVIEW") return "return";
  if (to === "DOING" && (from === "DONE" || from === "HIDDEN")) return "reopen";
  return null;
}

/** Приёмка директором: «принята директором…» в журнале дирекции, «принял(а) задачу» в подтверждениях у ЗГД. */
const ACCEPTED = /^(принят|принял)/;

/**
 * Как и когда задачу закрыли: последняя приёмка директором — «принята»; последняя смена статуса (закрыли статусом в таблице,
 * без приёмки) — «выполнена»; ни того ни другого в журнале (закрыли раньше, чем он ведётся) — по последней правке, «выполнена».
 */
export function closedOf(events: TrackerEvent[], fallback: string | Date): { at: number; accepted: boolean } {
  const last = [...events].reverse().find((e) => (e.kind === "workflow" && ACCEPTED.test(e.text)) || e.kind === "status");
  return { at: new Date(last?.at ?? fallback).getTime(), accepted: last?.kind === "workflow" };
}
export const closedAtOf = (events: TrackerEvent[], fallback: string | Date): number => closedOf(events, fallback).at;

/** Выполненное в окне последних дней — на доске и в списке по умолчанию видно только оно (остальное — «показать все»). */
export const DONE_WINDOW_DAYS = 14;
export function isRecentlyDone(events: TrackerEvent[], updatedAt: string | Date, now: number = Date.now(), days = DONE_WINDOW_DAYS): boolean {
  return now - closedAtOf(events, updatedAt) <= days * DAY;
}

/** Фильтры трекера — то, что попадает в адрес, чтобы вид можно было переслать ссылкой и он переживал перезагрузку. */
export type TrackerFilters = {
  kind: string | null;
  scope: string;
  mine: boolean;
  slip: boolean;
  col: TrackerColumnKey | null;
  cancelled: boolean;
  doneAll: boolean;
  seg: string[];
  owner: string[];
  /** ЗГД: одна дирекция (переход из «Моего дня» по карточке дирекции). */
  dir: string | null;
  q: string;
};
export const EMPTY_FILTERS: TrackerFilters = { kind: null, scope: "all", mine: false, slip: false, col: null, cancelled: false, doneAll: false, seg: [], owner: [], dir: null, q: "" };

const COLS: TrackerColumnKey[] = ["TODO", "DOING", "REVIEW", "DONE", "HIDDEN"];

/** Только отличия от «ничего не выбрано» — короткий адрес. */
export function filtersToParams(f: TrackerFilters): Record<string, string> {
  const o: Record<string, string> = {};
  if (f.kind) o.kind = f.kind;
  if (f.scope !== "all") o.scope = f.scope;
  if (f.mine) o.mine = "1";
  if (f.slip) o.slip = "1";
  if (f.col) o.col = f.col;
  if (f.cancelled) o.cancelled = "1";
  if (f.doneAll) o.done = "all";
  if (f.seg.length) o.seg = f.seg.join(",");
  // «org», а не «dir»: ?dir= в адресе — переключатель рабочей дирекции админа (AppShell)
  if (f.dir) o.org = f.dir;
  if (f.owner.length) o.owner = f.owner.join(",");
  if (f.q.trim()) o.q = f.q.trim().slice(0, 200);
  return o;
}

/** Разбор адреса: неизвестные значения игнорируются (ссылку могли испортить). */
export function filtersFromParams(get: (k: string) => string | null, kinds: readonly string[], scopes: readonly string[]): TrackerFilters {
  const list = (k: string) => (get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 50);
  const kind = get("kind");
  const scope = get("scope");
  const col = get("col") as TrackerColumnKey | null;
  return {
    kind: kind && kinds.includes(kind) ? kind : null,
    scope: scope && scopes.includes(scope) ? scope : "all",
    mine: get("mine") === "1",
    slip: get("slip") === "1",
    col: col && COLS.includes(col) ? col : null,
    cancelled: get("cancelled") === "1",
    doneAll: get("done") === "all",
    seg: list("seg"),
    owner: list("owner"),
    dir: (get("org") ?? "").slice(0, 60) || null,
    q: (get("q") ?? "").slice(0, 200),
  };
}

/** Есть ли что-то, что можно «сбросить» (кроме «Отменённых» и «Выполнено: все» — это режимы показа, а не отбор). */
export const hasActiveFilters = (f: TrackerFilters) => !!(f.kind || f.scope !== "all" || f.mine || f.slip || f.col || f.seg.length || f.owner.length || f.dir || f.q.trim());

// ---------- доска: срок-чип, причина запрета переноса, отбор плашек

export type DeadlineChip = { text: string; tone: "red" | "amber" | "grey" | "green" | "none"; title: string };
const dayStart = (d: string | Date) => {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
};

/**
 * Срок как чип: «просрочено на N дн.» (красный), «сегодня» / «через N дн.» (≤ 3 дн, янтарный), далее серый «до дд.мм.гг»;
 * у выполненных — зелёный «принято дд.мм.гг» (директор принял) или «выполнено дд.мм.гг» (закрыли статусом, без приёмки).
 * today — полночь UTC сегодняшнего дня по Москве (mskToday); overdue — общее правило lib/overdue.ts (в сам день срока ещё не просрочка, закрытые — нет).
 */
export function deadlineChip(deadline: string | Date | null | undefined, today: number, o: { overdue: boolean; column: TrackerColumnKey; closedAt?: string | Date | null; accepted?: boolean }): DeadlineChip {
  if (o.column === "DONE" && o.closedAt) {
    const was = deadline ? `срок был до ${ruDay(deadline)}` : "срока не было";
    return o.accepted === false ? { text: `выполнено ${ruDay(o.closedAt)}`, tone: "green", title: `Закрыта без приёмки директором (статусом в таблице); ${was}` } : { text: `принято ${ruDay(o.closedAt)}`, tone: "green", title: `Принята директором; ${was}` };
  }
  if (!deadline) return { text: "срока нет", tone: "none", title: "Срок не назначен" };
  const diff = Math.round((dayStart(deadline) - today) / DAY);
  const plain: DeadlineChip = { text: `до ${ruDay(deadline)}`, tone: o.column === "DONE" ? "green" : "grey", title: `Срок: ${ruDay(deadline)}` };
  if (o.column === "DONE" || o.column === "HIDDEN") return plain;
  if (o.overdue && diff < 0) return { text: `просрочено на ${-diff} дн.`, tone: "red", title: `Срок был ${ruDay(deadline)}` };
  if (diff === 0) return { text: "сегодня", tone: "amber", title: `Срок: ${ruDay(deadline)}` };
  if (diff > 0 && diff <= 3) return { text: `через ${diff} дн.`, tone: "amber", title: `Срок: ${ruDay(deadline)}` };
  return plain;
}

/** Почему карточку нельзя перенести «из → в» (подсказка в запрещённой колонке); null — можно (то же, что dropTargets). */
export function dropBlockReason(from: TrackerColumnKey, to: TrackerColumnKey, director: boolean): string | null {
  if (from === to || dropTargets(from, director).includes(to)) return null;
  if (!director && (from === "REVIEW" || from === "DONE" || from === "HIDDEN")) return from === "REVIEW" ? "Задачу на проверке двигает директор: принять или вернуть на доработку" : "Переоткрыть задачу может только директор";
  if (to === "DONE") return !director ? "Принять задачу может только директор" : "В «Выполнено» — только через «На проверке»";
  if (to === "HIDDEN") return !director ? "Отменить («Не актуально») может только директор" : "Закрытую задачу не отменяют — сначала переоткройте";
  if (from === "REVIEW" && to === "TODO") return "Из «На проверке» — только «Вернуть на доработку» (в «В работе»)";
  if ((from === "DONE" || from === "HIDDEN") && to !== "DOING") return "Закрытую задачу можно только переоткрыть — в «В работе»";
  return "Такой перенос недоступен";
}

/** Не больше max самых важных элементов (меньший rank — важнее, порядок при равенстве сохраняется); остальные — в «+N». */
export function pickTop<T extends { rank: number }>(items: T[], max: number): { shown: T[]; hidden: T[] } {
  const sorted = items.map((x, i) => ({ x, i })).sort((a, b) => a.x.rank - b.x.rank || a.i - b.i).map((s) => s.x);
  return { shown: sorted.slice(0, max), hidden: sorted.slice(max) };
}

/** Полночь UTC сегодняшнего дня по Москве (сроки хранятся датой без времени) — для чипов срока на доске. */
export const mskDay = (now: number): number => {
  const m = new Date(now + 3 * 3600 * 1000);
  return Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate());
};
