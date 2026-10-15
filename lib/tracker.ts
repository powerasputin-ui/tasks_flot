/**
 * «Трекер» — другие виды той же общей таблицы: доска по колонкам и таймлайн истории задачи.
 * Своих данных у трекера нет: задача = позиция таблицы, колонка = статус (Status.trackerColumn),
 * история = журнал правок (audit_events) + отправленные справки (memo_versions). Чистые функции, без базы.
 */

/** Сигналы задачи (lib/ai-table.ts signals): виды и причины «→ что сделать». */
export type HotInfo = { kinds: Array<"overdue" | "soon" | "blocker" | "review" | "request" | "data" | "report">; reasons: string[] };

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
export function statusForColumn(col: TrackerColumnKey, statuses: Array<{ id: string; trackerColumn?: TrackerColumnKey | null }>): string | null {
  return statuses.find((s) => (s.trackerColumn ?? "TODO") === col)?.id ?? null;
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
export type MemoSent = { at: Date | string; title: string; itemIds: string[] };

const FIELD_LABEL: Record<string, string> = { cost: "оценка", attractivenessId: "внимание", segmentId: "сегмент", trackId: "трек", expectedResult: "ожидаемый результат" };

/** Действия трекера в журнале (fieldName "workflow:<действие>", after — результат / причина / на чём ждём). */
const WORKFLOW_TEXT: Record<string, (t: string | null) => string> = {
  submit: (t) => `сдана на проверку${t ? `: ${t}` : ""}`,
  accept: (t) => `принята директором${t ? ` (${t})` : ""}`,
  return: (t) => `возвращена на доработку${t ? `: ${t}` : ""}`,
  block: (t) => `заблокирована${t ? `: ждём ${t}` : ""}`,
  unblock: () => "блок снят",
  cancel: (t) => `отменена${t ? `: ${t}` : ""}`,
  reopen: (t) => `переоткрыта${t ? `: ${t}` : ""}`,
};
const DAY = 24 * 3600 * 1000;
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
    else if (f === "statusId") out.push({ ...base, kind: "status", text: `статус: ${st(a.before)} → ${st(a.after)}` });
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
  for (const m of memos) for (const id of m.itemIds) out.push({ itemId: id, at: iso(m.at), kind: "memo", who: null, text: `вошла в отправленную справку «${m.title}»` });
  out.sort((x, y) => x.at.localeCompare(y.at));
  // одно сохранение = одно событие на вид (заголовок и комментарий разом → «обновлён текст задачи»)
  const seen = new Set<string>();
  return out.filter((e) => {
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
  const ts = dates.filter((d): d is Date | string => !!d).map((d) => new Date(d).getTime());
  const monday = (t: number) => {
    const d = new Date(t);
    const wd = (d.getUTCDay() + 6) % 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - wd * DAY;
  };
  const min = Math.min(now.getTime(), ...ts);
  const max = Math.max(now.getTime(), ...ts);
  return { from: monday(min), to: monday(max) + 14 * DAY };
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
  const lastCol = [...events].reverse().find((e) => e.kind === "status" || e.kind === "created");
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
