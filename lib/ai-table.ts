import { normalizeText } from "@/lib/search";
import { PROTECTED_STATUSES } from "@/lib/statuses";
import { COLUMN_LABEL, daysText, motionText, type Motion } from "@/lib/tracker";

/**
 * Движок фактов таблицы для ИИ-помощников. Экзамен (e2e/ai-exam) показал: модель, видя только тексты пунктов справки,
 * выдумывает статусы и ответственных, не видит сроков, подачи, удалённых и журнала правок. Поэтому:
 *  - модель получает карточку КАЖДОЙ позиции дирекции со всеми полями (пока таблица помещается в окно);
 *  - списки и числа считает программа: «ИТОГИ» по всей таблице и «ВЫБОРКА ПО ВОПРОСУ» — точный фильтр по полям
 *    (ответственный, сегмент, трек, статус, срок, подача, удалённые…), а не поиск похожих слов, поэтому выборка полная;
 *  - «кто / когда / что менял» — из журнала правок.
 * Чистые функции; загрузка из базы — lib/ai-table-load.ts.
 */

export type FactItem = {
  id: string;
  title: string;
  comment: string | null;
  segment: string | null;
  track: string | null;
  owner: string | null;
  author: string | null;
  editor: string | null;
  status: string | null;
  attention: string | null;
  cost: string | null;
  deadline: Date | null;
  submitted: boolean;
  archived: boolean;
  files: Array<{ name: string; path: string }>;
  createdAt: Date;
  updatedAt: Date;
  /** Движение по «Трекеру» (колонка, переносы срока, простой, история) — считает программа (lib/tracker.ts). */
  motion?: Motion;
  /** Дирекция — у ЗГД, который видит все дирекции. */
  directorate?: string | null;
  /** Поручение (трекер): блокер, ожидаемый результат, исходный срок, источник ЗГД, контроль ЗГД. */
  blockedBy?: string | null;
  blockedUntil?: Date | null;
  expectedResult?: string | null;
  originalDeadline?: Date | null;
  origin?: string | null;
  zgdControl?: boolean;
  /** У ЗГД: когда и чем подтверждено состояние (справка или решение директора). */
  confirmed?: string;
  /** Просьба о переносе срока ждёт решения директора. */
  pendingDeadline?: { newDeadline: Date; reason: string } | null;
  /** Открытые запросы ЗГД: сколько и самый ранний срок ответа. */
  openRequests?: { count: number; dueAt: Date | null };
};

export type FactEvent = { itemId: string; at: Date; who: string | null; action: string; field: string | null; before: string | null; after: string | null };

export type TableQuery = {
  owner?: string;
  segment?: string;
  track?: string;
  status?: string;
  statusNone?: boolean;
  overdue?: boolean;
  soon?: boolean;
  noDeadline?: boolean;
  notSubmitted?: boolean;
  submitted?: boolean;
  archived?: boolean;
  noOwner?: boolean;
  hasFiles?: boolean;
};

const DAY = 86400000;
const n = (s: string) => normalizeText(s);
const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const ru = (d: Date) => new Date(dayOf(d)).toLocaleDateString("ru-RU", { timeZone: "UTC" });
const ruMsk = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" });
const closed = (i: FactItem) => (!!i.status && PROTECTED_STATUSES.includes(i.status)) || i.motion?.column === "DONE" || i.motion?.column === "HIDDEN";
/** «Сегодня» по Москве — полночь UTC (сроки хранятся датой без времени). */
export function todayMsk(now = new Date()): number {
  const m = new Date(now.getTime() + 3 * 3600 * 1000);
  return Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate());
}

const isOverdue = (i: FactItem, today: number) => !i.archived && !!i.deadline && dayOf(i.deadline) < today && !closed(i);
const isSoon = (i: FactItem, today: number) => !i.archived && !!i.deadline && dayOf(i.deadline) >= today && dayOf(i.deadline) - today <= 7 * DAY && !closed(i);

// ---------- что спросили ----------

const stem = (w: string) => w.slice(0, Math.max(4, Math.min(6, w.length - 1)));
const words = (s: string) => (n(s).match(/[а-яa-z0-9]+/g) ?? []).filter((w) => w.length >= 3);

/** Название из словаря упомянуто в вопросе: все его значимые слова (по основам) есть в вопросе. */
function mentions(question: string, name: string): boolean {
  const q = words(question).map(stem);
  const ws = words(name).filter((w) => w.length >= 4);
  if (ws.length === 0) return n(question).includes(n(name));
  return ws.every((w) => q.includes(stem(w)));
}

/** Фамилия человека в вопросе («у Майкова», «Сухов», «Козлову»). */
function mentionsPerson(question: string, fullName: string): boolean {
  const surname = words(fullName)[0];
  if (!surname || surname.length < 4) return false;
  const s = surname.slice(0, Math.max(4, surname.length - 1));
  return words(question).some((w) => w.startsWith(s));
}

/**
 * Условия выборки из вопроса — по словарям этой дирекции (люди, сегменты, треки, статусы) и признакам.
 * Человек в вопросе — ответственный (решение пользователя); автор и «кто менял» — отдельные поля карточки.
 */
export function parseTableQuestion(question: string, dict: { owners: string[]; segments: string[]; tracks: string[]; statuses: string[] }): TableQuery {
  const q = n(question);
  const out: TableQuery = {};
  const owner = dict.owners.find((o) => mentionsPerson(question, o));
  if (owner) out.owner = owner;
  // трек точнее сегмента: «Консолидация деятельности Газпром флот» ≠ сегмент «Газпром флот»
  const track = [...dict.tracks].sort((a, b) => b.length - a.length).find((t) => mentions(question, t));
  if (track) out.track = track;
  const segment = [...dict.segments].sort((a, b) => b.length - a.length).find((s) => mentions(question, s) && !(track && n(track).includes(n(s))));
  if (segment) out.segment = segment;
  if (/(без статуса|статус не указан|не указан статус|нет статуса)/.test(q)) out.statusNone = true;
  else {
    const status = dict.statuses.find((s) => mentions(question, s));
    if (status) out.status = status;
  }
  if (/просроч/.test(q)) out.overdue = true;
  if (/(ближайш|на этой неделе|на неделе|7 дней|семь дней|скоро срок)/.test(q)) out.soon = true;
  if (/(без срока|срок не указан|не указан срок|нет срока)/.test(q)) out.noDeadline = true;
  if (/(не подан|не отправлен|не поданы|еще не подан|ещё не подан)/.test(q)) out.notSubmitted = true;
  else if (/(подан[аоы]? в справк|поданы|отправлен[аоы]? директор)/.test(q)) out.submitted = true;
  if (/(удален|удалён|в корзин|удалили)/.test(q)) out.archived = true;
  if (/(без ответственн|ответственный не указан|нет ответственн)/.test(q)) out.noOwner = true;
  if (/(документ|файл|презентац|вложен|приложен)/.test(q) && /(с документ|есть документ|у каких|какие позиции)/.test(q)) out.hasFiles = true;
  return out;
}

export const hasConditions = (q: TableQuery) => Object.keys(q).length > 0;

/** Точная выборка по условиям — по всем строкам таблицы. Удалённые — только если о них спросили. */
export function applyQuery(items: FactItem[], q: TableQuery, today: number): FactItem[] {
  return items.filter((i) => {
    if (q.archived) {
      if (!i.archived) return false;
    } else if (i.archived) return false;
    if (q.owner && i.owner !== q.owner) return false;
    if (q.segment && i.segment !== q.segment) return false;
    if (q.track && i.track !== q.track) return false;
    if (q.status && i.status !== q.status) return false;
    if (q.statusNone && i.status) return false;
    if (q.overdue && !isOverdue(i, today)) return false;
    if (q.soon && !isSoon(i, today)) return false;
    if (q.noDeadline && i.deadline) return false;
    if (q.notSubmitted && i.submitted) return false;
    if (q.submitted && !i.submitted) return false;
    if (q.noOwner && i.owner) return false;
    if (q.hasFiles && i.files.length === 0) return false;
    return true;
  });
}

export function describeQuery(q: TableQuery): string {
  const p: string[] = [];
  if (q.owner) p.push(`ответственный ${q.owner}`);
  if (q.segment) p.push(`сегмент «${q.segment}»`);
  if (q.track) p.push(`трек «${q.track}»`);
  if (q.status) p.push(`статус «${q.status}»`);
  if (q.statusNone) p.push("без статуса");
  if (q.overdue) p.push("просрочено (срок прошёл, статус не закрыт)");
  if (q.soon) p.push("срок в ближайшие 7 дней");
  if (q.noDeadline) p.push("без срока");
  if (q.notSubmitted) p.push("не поданы в справку");
  if (q.submitted) p.push("поданы в справку");
  if (q.archived) p.push("удалённые");
  if (q.noOwner) p.push("без ответственного");
  if (q.hasFiles) p.push("с документами");
  return p.join("; ");
}

// ---------- карточки, итоги, журнал ----------

/** Метки позиций: [Т1]… по порядку создания — одинаковые во всех блоках одного ответа. */
export function labelItems(items: FactItem[]): Map<string, string> {
  return new Map([...items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((i, k) => [i.id, `Т${k + 1}`]));
}

const notable = (m: Motion) => m.slips > 0 || (m.column !== "DONE" && ((m.idleDays ?? 0) >= 14 || (m.inColumnDays ?? 0) >= 21)) || m.column === "REVIEW";

export function cardLine(i: FactItem, label: string, today: number, titleLimit = 260): string {
  const deadline = i.deadline
    ? `${ru(i.deadline)}${isOverdue(i, today) ? ` — просрочен на ${Math.round((today - dayOf(i.deadline)) / DAY)} дн.` : isSoon(i, today) ? ` — через ${Math.round((dayOf(i.deadline) - today) / DAY)} дн.` : ""}`
    : "не указан";
  const parts = [
    i.directorate ? `дирекция: ${i.directorate}` : null,
    `сегмент: ${i.segment ?? "не указан"}`,
    `трек: ${i.track ?? "не указан"}`,
    `ответственный: ${i.owner ?? "не указан"}`,
    `статус: ${i.status ?? "не указан"}`,
    `срок: ${deadline}`,
    `подана в справку: ${i.submitted ? "да" : "нет"}`,
    `создал: ${i.author ?? "?"} ${ruMsk(i.createdAt)}`,
    `последним менял: ${i.editor ?? i.author ?? "?"} ${ruMsk(i.updatedAt)}`,
    i.attention ? `внимание: ${i.attention}` : null,
    i.cost ? `оценка: ${i.cost}` : null,
    i.files.length ? `документы: ${i.files.map((f) => `«${f.name}»`).join(", ")}` : null,
    i.comment ? `комментарий: ${i.comment.length > 200 ? `${i.comment.slice(0, 200)}…` : i.comment}` : null,
    // «трекер:» — только если есть что сказать (переносы, простой, ждёт приёмки, давно в колонке): окно модели не резиновое
    i.motion && notable(i.motion) ? `трекер: ${motionText(i.motion)}` : null,
    i.expectedResult ? `ожидаемый результат: ${i.expectedResult.slice(0, 160)}` : null,
    i.blockedBy ? `на стопе: ждём ${i.blockedBy}${i.blockedUntil ? ` (ожидаем к ${ru(i.blockedUntil)})` : ""}` : null,
    i.originalDeadline && i.deadline && dayOf(i.originalDeadline) !== dayOf(i.deadline) ? `исходный срок: ${ru(i.originalDeadline)}` : null,
    i.origin === "ZGD" ? "поручение ЗГД" : i.origin === "DIRECTOR" ? "поручение директора" : null,
    i.confirmed ? `подтверждено: ${i.confirmed}` : null,
    i.zgdControl ? "на контроле ЗГД" : null,
    i.openRequests?.count ? `запрос ЗГД без ответа${i.openRequests.dueAt ? ` (ответ к ${ru(i.openRequests.dueAt)})` : ""}` : null,
  ].filter(Boolean);
  // сокращение помечаем явно: иначе модель решает, что текст в таблице «обрезан» (экзамен, вопрос R1)
  const title = i.title.length > titleLimit ? `${i.title.slice(0, titleLimit)}… [в карточке сокращено, в таблице текст полный]` : i.title;
  return `[${label}] ${i.archived ? "УДАЛЕНА — " : ""}задача «${title}» | ${parts.join(" | ")}`;
}

const refs = (list: FactItem[], labels: Map<string, string>) => (list.length ? list.map((i) => `[${labels.get(i.id)}]`).join(", ") : "нет");
function countBy(list: FactItem[], key: (i: FactItem) => string | null): string {
  const m = new Map<string, number>();
  for (const i of list) {
    const k = key(i) ?? "не указан";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} — ${v}`).join("; ");
}

/** Итоги по всей таблице — числа и списки, которые модель должна брать готовыми. */
// ---------- «что горит»: сигналы по правилу (считает программа) ----------
// Правило по умолчанию (пользователь может поменять): 1) просрочено; 2) срок через 3 дня и меньше; 3) ждём чужого
// решения/результата, а срок прошёл или его нет; 4) нет ни срока, ни статуса; 5) не подана, а срок в ближайшие 7 дней.

const WAITING = /(ожида|жд[её]м|ждут|подрядчик|верф|финансир|бюджет|тендер|согласовани|разрешени|экспертиз|решени[ея] (гд|пао|руковод))/;
const HOT_Q = /(горит|горящ|вмешат|риск|проблем|узк|срочн|эскал|тревож|под угроз|красн|на что обратить)/;
export const wantsSignals = (question: string) => HOT_Q.test(n(question));

/**
 * Сигналы — раздельно (разбор GPT: одно «горит» смешивало просрочку, качество данных и отчётность). У каждого — причина
 * и следующее действие. Вид: просрочка, скоро срок, блокер, ждёт приёмки, запрос ЗГД без ответа, нет данных, отчётность.
 */
export type SignalKind = "overdue" | "slipped" | "deadlineRequest" | "soon" | "blocker" | "review" | "request" | "data" | "report";
export const SIGNAL_LABEL: Record<SignalKind, string> = { overdue: "Просрочка", slipped: "Исходный срок нарушен", deadlineRequest: "Перенос ждёт решения", soon: "Скоро срок", blocker: "На стопе", review: "Ждёт приёмки", request: "Запрос ЗГД", data: "Нет данных", report: "Отчётность" };
export type Signal = { item: FactItem; reasons: string[]; weight: number; kinds: SignalKind[] };

export function signals(items: FactItem[], today: number): Signal[] {
  const out: Signal[] = [];
  for (const i of items) {
    if (i.archived || closed(i)) continue;
    const reasons: string[] = [];
    const kinds: SignalKind[] = [];
    let weight = 0;
    const add = (kind: SignalKind, reason: string, action: string, w: number) => {
      reasons.push(`${SIGNAL_LABEL[kind]}: ${reason} → ${action}`);
      if (!kinds.includes(kind)) kinds.push(kind);
      weight += w;
    };
    const days = i.deadline ? Math.round((dayOf(i.deadline) - today) / DAY) : null;
    const review = i.motion?.column === "REVIEW";
    // исходный срок сорван, даже если текущий перенесли
    const origMissed = i.originalDeadline && i.deadline && dayOf(i.originalDeadline) < dayOf(i.deadline) && dayOf(i.originalDeadline) < today ? ` (исходный срок ${ru(i.originalDeadline)} сорван)` : "";
    const pend = i.pendingDeadline;
    if (days !== null && days < 0) add("overdue", `просрочено на ${-days} дн.${origMissed}${pend ? `; запрошен перенос на ${ru(pend.newDeadline)}` : ""}`, review ? "директору принять или вернуть" : pend ? "директору решить по переносу" : "согласовать новый срок с причиной или закрыть", 4 + Math.min(3, Math.floor(-days / 7)));
    // исходное обязательство сорвано, хотя текущий срок ещё не прошёл (его перенесли)
    else if (i.originalDeadline && dayOf(i.originalDeadline) < today && i.deadline && dayOf(i.deadline) > dayOf(i.originalDeadline)) add("slipped", `исходный срок ${ru(i.originalDeadline)} нарушен, текущий — ${ru(i.deadline)}`, "держать на контроле: второй перенос — повод вмешаться", 2);
    if (pend) add("deadlineRequest", `просят перенести на ${ru(pend.newDeadline)}: ${pend.reason.slice(0, 120)}`, "директору согласовать или отклонить", 2);
    else if (days !== null && days <= 3 && !review) add("soon", days === 0 ? "срок сегодня" : `срок через ${days} дн.${origMissed}`, "проверить готовность у ответственного", 3);
    if (i.blockedBy) {
      const late = i.blockedUntil && dayOf(i.blockedUntil) < today;
      add("blocker", `ждём ${i.blockedBy}${i.blockedUntil ? `${late ? ", ожидали к " : " до "}${ru(i.blockedUntil)}` : ", дата не указана"}`, late || !i.blockedUntil ? "поднять вопрос выше / уточнить дату" : "следить за датой", late ? 3 : 2);
    }
    if (review && (i.motion?.inColumnDays ?? 0) >= 3) add("review", `на проверке ${i.motion!.inColumnDays} дн.`, "директору принять или вернуть с замечанием", 2);
    if (i.openRequests?.count) {
      const late = i.openRequests.dueAt && dayOf(i.openRequests.dueAt) < today;
      add("request", `запрос ЗГД без ответа${i.openRequests.dueAt ? ` (ответ ${late ? "ждали" : "нужен"} к ${ru(i.openRequests.dueAt)})` : ""}`, "директору ответить ЗГД", late ? 4 : 2);
    }
    // без структурного блокера — подсказка из текста, но как качество данных, а не «горит»
    const wait = !i.blockedBy ? WAITING.exec(n(`${i.title} ${i.comment ?? ""}`)) : null;
    const waitWord = wait ? (n(`${i.title} ${i.comment ?? ""}`).match(new RegExp(`[а-яё]*${wait[0]}[а-яё]*`))?.[0] ?? wait[0]) : "";
    const missing = [!i.deadline ? "срока" : "", !i.owner ? "ответственного" : "", i.origin && !i.expectedResult ? "ожидаемого результата" : ""].filter(Boolean);
    if (missing.length) add("data", `нет ${missing.join(", ")}`, "заполнить в карточке", 1);
    if (wait && (days === null || days < 0)) add("data", `в тексте «${waitWord}», а задача не на стопе`, "если ждём — «Поставить на стоп» с датой", 1);
    if (!i.submitted && days !== null && days >= 0 && days <= 7) add("report", "не подана в справку, а срок близко", "ответственному подать строку", 1);
    if (reasons.length) out.push({ item: i, reasons, weight, kinds });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

export function signalsBlock(sig: Signal[], labels: Map<string, string>): string {
  if (!sig.length) return "СИГНАЛЫ «ГОРИТ» (по правилу программы): нет — просрочек, сроков на носу, зависших ожиданий и позиций без срока и статуса нет.";
  return [
    "СИГНАЛЫ «ГОРИТ» (посчитано программой; у каждого — вид, причина и «→ что сделать»; виды: Просрочка, Исходный срок нарушен, Перенос ждёт решения, Скоро срок, Блокер, Ждёт приёмки, Запрос ЗГД, Нет данных, Отчётность), сначала самое серьёзное:",
    ...sig.map((s) => `[${labels.get(s.item.id)}] ${s.reasons.join("; ")} — ответственный: ${s.item.owner ?? "не указан"}`),
  ].join("\n");
}

export function summaryBlock(items: FactItem[], labels: Map<string, string>, today: number): string {
  const act = items.filter((i) => !i.archived);
  const del = items.filter((i) => i.archived);
  return [
    `ИТОГИ ПО ТАБЛИЦЕ (посчитано программой, полные; сегодня ${new Date(today).toLocaleDateString("ru-RU", { timeZone: "UTC" })}):`,
    `Действующих позиций: ${act.length}; удалённых: ${del.length} (${refs(del, labels)}).`,
    `По статусам: ${countBy(act, (i) => i.status)}.`,
    `По ответственным: ${countBy(act, (i) => i.owner)}.`,
    `По сегментам: ${countBy(act, (i) => i.segment)}.`,
    `По трекам: ${countBy(act, (i) => i.track)}.`,
    `Просрочено (срок прошёл, статус не «Завершено»/«Не актуально»): ${refs(act.filter((i) => isOverdue(i, today)), labels)}.`,
    `Срок в ближайшие 7 дней: ${refs(act.filter((i) => isSoon(i, today)), labels)}.`,
    `Без срока: ${refs(act.filter((i) => !i.deadline), labels)}.`,
    `Без ответственного: ${refs(act.filter((i) => !i.owner), labels)}.`,
    `Не поданы в справку: ${refs(act.filter((i) => !i.submitted), labels)}.`,
    `С документами: ${refs(act.filter((i) => i.files.length), labels)}.`,
  ].join("\n");
}

const WF_JOURNAL: Record<string, string> = { submit: "сдал на проверку", accept: "принял", return: "вернул на доработку", block: "поставил на стоп", unblock: "снял со стопа", cancel: "отменил задачу", reopen: "переоткрыл" };

const ACTION: Record<string, (e: FactEvent) => string> = {
  CREATE: () => "создал позицию",
  // у ЗГД журнал — разница между отправленными справками: событие уже описано словами (lib/tracker-sent.ts)
  NOTE: (e) => e.field ?? "изменение",
  ARCHIVE: () => "удалил позицию",
  RESTORE: () => "вернул позицию из удалённых",
  OPER_FLAG_CHANGE: (e) => (e.after === "true" ? "подал в справку" : "отозвал из справки"),
  STATUS_CHANGE: (e) => `сменил статус: ${e.before ?? "—"} → ${e.after ?? "—"}`,
  DEADLINE_CHANGE: (e) => `сменил срок: ${e.before ? e.before.slice(0, 10) : "—"} → ${e.after ? e.after.slice(0, 10) : "—"}`,
  OWNER_CHANGE: (e) => `сменил ответственного: ${e.before ?? "—"} → ${e.after ?? "—"}`,
  ATTRACTIVENESS_CHANGE: (e) => `сменил «внимание»: ${e.before ?? "—"} → ${e.after ?? "—"}`,
  UPDATE: (e) => (e.field?.startsWith("workflow:") ? `${WF_JOURNAL[e.field.slice(9)] ?? e.field.slice(9)}${e.after ? `: ${e.after.slice(0, 120)}` : ""}` : e.field === "deadlineReason" ? `указал причину переноса срока: ${e.after ?? "—"}` : e.field === "expectedResult" ? "изменил ожидаемый результат" : e.field === "title" ? "изменил текст задачи" : e.field === "comment" ? "изменил комментарий" : e.field === "files" ? `изменил документы (${e.after ?? "—"})` : `изменил поле ${e.field ?? ""}`),
};

/** Журнал правок за период — «кто, когда, что». Новые сверху. */
export function journalBlock(events: FactEvent[], labels: Map<string, string>, maxLines = 60): string {
  if (!events.length) return "ЖУРНАЛ ПРАВОК за 14 дней: изменений нет.";
  const lines = [...events].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, maxLines).map((e) => {
    const when = e.at.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `${when} ${e.who ?? "?"} — ${(ACTION[e.action] ?? (() => e.action))(e)} [${labels.get(e.itemId) ?? "?"}]`;
  });
  return [`ЖУРНАЛ ПРАВОК за 14 дней (новые сверху; всего событий ${events.length}${events.length > maxLines ? `, показаны последние ${maxLines}` : ""}):`, ...lines].join("\n");
}

// «правк» / «правил» — отдельным словом: «справку» их тоже содержит
const JOURNAL_Q = /(изменил|изменен|изменён|поменял|менял|(?<![а-я])правил|(?<![а-я])правк|создал|кто добавил|кто завел|кто завёл|подавал|подал|отозвал|удалил|журнал|истори|за недел|за последн|сегодня|вчера)/;
export const wantsJournal = (question: string) => JOURNAL_Q.test(n(question));

/**
 * Блок «ТАБЛИЦА ДИРЕКЦИИ» для модели в пределах budget знаков: итоги, выборка по вопросу, карточки (сначала
 * выборка и позиции справки, потом остальные — пока влезают), журнал — если о нём спросили.
 */
export function tableContext(opts: { items: FactItem[]; events: FactEvent[]; question: string; dict: Parameters<typeof parseTableQuestion>[1]; memoItemIds: string[]; budget: number; today?: number }): { text: string; labels: Map<string, string>; query: TableQuery; matched: FactItem[]; shown: FactItem[] } {
  const today = opts.today ?? todayMsk();
  const labels = labelItems(opts.items);
  const query = parseTableQuestion(opts.question, opts.dict);
  const matched = hasConditions(query) ? applyQuery(opts.items, query, today) : [];
  const parts: string[] = [summaryBlock(opts.items, labels, today)];
  if (hasConditions(query)) parts.push(`ВЫБОРКА ПО ВОПРОСУ (точный фильтр программы по всей таблице; условия: ${describeQuery(query)}): найдено ${matched.length} — ${refs(matched, labels)}.`);
  const journal = wantsJournal(opts.question) ? journalBlock(opts.events, labels) : "";
  const sig = signals(opts.items, today);
  parts.push(signalsBlock(sig, labels));
  const tb = wantsTracker(opts.question) || wantsSignals(opts.question) ? trackerBlock(opts.items, labels) : "";
  if (tb) parts.push(tb);
  // «как двигалась задача …» — история задач, о которых спросили
  const asked = wantsTracker(opts.question) ? [...new Set([...matched, ...bySubject(opts.question, opts.items)])].filter((i) => i.motion?.history.length).slice(0, 6) : [];
  if (asked.length) parts.push(historyBlock(asked, labels));
  // на «что горит» карточки сигнальных позиций — первыми (чтобы не отрезало окном)
  const hot = wantsSignals(opts.question) ? sig.map((s) => s.item) : [];
  const order = [...matched, ...hot, ...opts.items.filter((i) => opts.memoItemIds.includes(i.id)), ...opts.items];
  const seen = new Set<string>();
  const cards: string[] = [];
  const shown: FactItem[] = [];
  let used = parts.join("\n").length + journal.length + 200;
  let skipped = 0;
  for (const i of order) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    const line = cardLine(i, labels.get(i.id)!, today);
    if (used + line.length > opts.budget) {
      skipped++;
      continue;
    }
    cards.push(line);
    shown.push(i);
    used += line.length + 1;
  }
  const head = `ТАБЛИЦА ДИРЕКЦИИ — карточки позиций (задач), включая удалённые${skipped ? `; не показаны ${skipped} позиций — они учтены в ИТОГАХ` : ""}:`;
  const text = [...parts, "", head, ...cards, ...(journal ? ["", journal] : [])].join("\n");
  return { text, labels, query, matched, shown };
}

// ---------- прямые ответы программы ----------
// Экзамен: даже с полными данными модель путает метки и теряет людей в журнале. Вопросы «какие / у кого / сколько /
// есть ли» и «кто подавал / что изменилось» — это точный фильтр, отвечает программа (100 % верно); модель — там, где
// нужно думать (что горит, формулировки, сравнение).

/** Вопрос-список: «какие…», «что у…/в…/по…», «у каких», «у кого», «сколько», «есть ли», «покажи», «кто отвечает». */
export function isListQuestion(question: string): boolean {
  const q = n(question).replace(/^(а|и|скажи|подскажи|пожалуйста)[ ,]+/, "");
  // «сколько стоит», «почему», «как …» — не список: такое программа не считает, отвечает модель (экзамен, N1)
  if (/(сколько сто|стоимост|цена|цену|сумм|бюджет|почему|зачем|как (так|быть|лучше|сделать))/.test(q)) return false;
  return /^(какие|какая|какой|каких|что (у|в|по|просроч|не подан|сейчас|ещ)|у как|у кого|сколько|есть ли|покажи|перечисли|список|кто (отвечает|ответствен))/.test(q);
}

const STOP_WHO = new Set(["кто", "отвечает", "ответственный", "ответственная", "ответственен", "позицию", "позиция", "позиции", "задачу", "задача", "задаче", "судну", "судно", "судна", "по", "за", "про", "у", "нас", "в", "на", "и"]);

/**
 * «Кто отвечает за …» без точных условий: позиции, в названии которых есть предмет вопроса (основы слов),
 * лучшие по числу совпадений, — с ответственным и автором. null — не такой вопрос или ничего не нашлось.
 */
export function whoAnswer(question: string, items: FactItem[], labels: Map<string, string>): string | null {
  const q = n(question);
  if (!/^кто (отвечает|ответствен|ведет|ведёт|занимается)/.test(q)) return null;
  const subj = words(question).filter((w) => !STOP_WHO.has(w)).map(stem);
  if (!subj.length) return null;
  const scored = items
    .filter((i) => !i.archived)
    .map((i) => {
      const ws = words(i.title).map(stem);
      return { i, s: subj.filter((w) => ws.includes(w)).length, first: n(i.title).indexOf(subj[0]) };
    })
    .filter((x) => x.s > 0);
  if (!scored.length) return null;
  const best = Math.max(...scored.map((x) => x.s));
  // сначала позиции, где предмет — в начале названия («По судну Hai Qiang 18…»), а не упомянут попутно
  const top = scored.filter((x) => x.s === best).sort((a, b) => (a.first < 0 ? 1e9 : a.first) - (b.first < 0 ? 1e9 : b.first));
  const lines = top.map(({ i }) => `[${labels.get(i.id)}] «${short(i.title)}» — ответственный: ${i.owner ?? "не указан"}${i.author && i.author !== i.owner ? `; создал: ${i.author}` : ""}; ${i.status ?? "статус не указан"}; ${i.deadline ? `срок ${ru(i.deadline)}` : "срок не указан"}`);
  return top.length === 1 ? `Ответственный — ${top[0].i.owner ?? "не указан"}.\n${lines[0]}` : `Позиции, где упоминается предмет вопроса (${top.length}):\n${lines.join("\n")}`;
}

export type JournalQuery = { from: number; label: string; actions?: string[]; who?: string };

/** Период, действие и человек в вопросе про журнал. null — вопрос не про журнал. */
export function parseJournalQuestion(question: string, people: string[], now = new Date()): JournalQuery | null {
  if (!wantsJournal(question)) return null;
  const q = n(question);
  const today = todayMsk(now) - 3 * 3600 * 1000; // полночь по Москве в UTC
  let from = now.getTime() - 14 * DAY;
  let label = "за 14 дней";
  if (/сегодня/.test(q)) [from, label] = [today, "сегодня"];
  else if (/вчера/.test(q)) [from, label] = [today - DAY, "со вчерашнего дня"];
  else if (/(недел|7 дней|семь дней)/.test(q)) [from, label] = [now.getTime() - 7 * DAY, "за 7 дней"];
  let actions: string[] | undefined;
  if (/(подавал|подал|подан|отправлял|отправил)/.test(q)) actions = ["OPER_FLAG_CHANGE:true"];
  else if (/отозвал/.test(q)) actions = ["OPER_FLAG_CHANGE:false"];
  else if (/(создал|добавил|завел|завёл)/.test(q)) actions = ["CREATE"];
  else if (/удалил/.test(q)) actions = ["ARCHIVE"];
  else if (/статус/.test(q)) actions = ["STATUS_CHANGE"];
  else if (/срок/.test(q)) actions = ["DEADLINE_CHANGE"];
  const who = people.find((p) => mentionsPerson(question, p));
  return { from, label, actions, who };
}

const evKey = (e: FactEvent) => (e.action === "OPER_FLAG_CHANGE" ? `OPER_FLAG_CHANGE:${e.after}` : e.action);
const short = (t: string, len = 110) => (t.length > len ? `${t.slice(0, len)}…` : t);

/** Ответ по журналу: по людям, кто что сделал за период (позиции без повторов). */
export function journalAnswer(events: FactEvent[], items: FactItem[], labels: Map<string, string>, jq: JournalQuery): string {
  const byId = new Map(items.map((i) => [i.id, i]));
  const list = events.filter((e) => e.at.getTime() >= jq.from && (!jq.actions || jq.actions.includes(evKey(e))) && (!jq.who || e.who === jq.who));
  const what = jq.actions ? (ACTION[jq.actions[0].split(":")[0]] ?? (() => "изменения"))({ action: jq.actions[0].split(":")[0], after: jq.actions[0].split(":")[1] ?? null } as FactEvent) : "изменения";
  if (!list.length) return `По журналу правок ${jq.label}${jq.who ? ` у ${jq.who}` : ""}: ${jq.actions ? `никто не ${what.replace(/^(\S+)/, "$1")}` : "изменений нет"}.`;
  const people = new Map<string, FactEvent[]>();
  for (const e of list) people.set(e.who ?? "?", [...(people.get(e.who ?? "?") ?? []), e]);
  const out = [`По журналу правок ${jq.label}${jq.actions ? ` (${what})` : ""}:`];
  for (const [who, evs] of [...people.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const groups = new Map<string, Set<string>>();
    for (const e of evs) {
      const act = (ACTION[e.action] ?? (() => e.action))(e).replace(/:.*$/, "");
      groups.set(act, (groups.get(act) ?? new Set()).add(e.itemId));
    }
    out.push(`${who}:`);
    for (const [act, ids] of groups) out.push(`  ${act} — ${ids.size}: ${[...ids].map((id) => `[${labels.get(id) ?? "?"}] «${short(byId.get(id)?.title ?? "?", 70)}»`).join("; ")}`);
  }
  return out.join("\n");
}

/** Строка позиции для человека: название, ответственный, статус, срок, подача, пункт справки. */
function personLine(i: FactItem, label: string, today: number, memoNo?: number[]): string {
  const dl = i.deadline ? `срок ${ru(i.deadline)}${isOverdue(i, today) ? ` (просрочен на ${Math.round((today - dayOf(i.deadline)) / DAY)} дн.)` : ""}` : "срок не указан";
  return `[${label}] ${i.archived ? "УДАЛЕНА — " : ""}«${short(i.title)}» — ${i.owner ?? "ответственный не указан"}; ${i.status ?? "статус не указан"}; ${dl}; ${i.submitted ? "подана" : "не подана"}${memoNo?.length ? `; в справке: пункт ${memoNo.map((x) => `[${x}]`).join(", ")}` : ""}`;
}

/**
 * Прямой ответ программы — для облака и локальной модели. Вопрос-выборка с точными условиями → точный список;
 * вопрос про журнал → кто что сделал. null — вопрос «на подумать», отвечает модель.
 */
export function directAnswer(opts: Parameters<typeof tableContext>[0] & { memoBullets?: Map<string, number[]>; now?: Date }): string | null {
  const today = opts.today ?? todayMsk(opts.now);
  const labels = labelItems(opts.items);
  const tracked = trackerAnswer(opts.question, opts.items, labels);
  if (tracked) return tracked;
  const people = [...new Set([...opts.dict.owners, ...opts.items.map((i) => i.author).filter((x): x is string => !!x), ...opts.events.map((e) => e.who).filter((x): x is string => !!x)])];
  const jq = parseJournalQuestion(opts.question, people, opts.now);
  if (jq && (jq.actions || /(что|какие)\s.*(изменил|изменен)/.test(n(opts.question)))) return journalAnswer(opts.events, opts.items, labels, jq);
  const query = parseTableQuestion(opts.question, opts.dict);
  // «кто отвечает за …» — без условий по полям, ищем предмет в названиях (экзамен, W2: модель ответила «не указан»)
  const onlyOwner = Object.keys(query).every((k) => k === "owner");
  if (onlyOwner && !query.owner) {
    const who = whoAnswer(opts.question, opts.items, labels);
    if (who) return who;
  }
  if (!hasConditions(query) || !isListQuestion(opts.question)) return null;
  const matched = applyQuery(opts.items, query, today);
  const active = opts.items.filter((i) => !i.archived).length;
  const out = [`Точная выборка по таблице (${describeQuery(query)}): ${matched.length ? `${matched.length} из ${active} действующих позиций` : "таких позиций нет"}${query.archived ? "" : ""}.`];
  out.push(...matched.map((i, k) => `${k + 1}. ${personLine(i, labels.get(i.id)!, today, opts.memoBullets?.get(i.id))}`));
  if (matched.length > 1 && /(ответствен|у кого|кто)/.test(n(opts.question))) out.push(`По ответственным: ${countBy(matched, (i) => i.owner)}.`);
  return out.join("\n");
}

/** Прямой ответ программы в том же виде, что ответ модели (текст потоком + метки [Т…] для ссылок). */
export function directResponse(text: string, refs: AiItemRef[]): Response {
  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-AI-Model": encodeURIComponent("Точный ответ по таблице (без ИИ)"), ...itemsHeader(refs) },
  });
}

/** Ответ без модели для локальной модели на процессоре: прямой ответ, а если вопрос общий — выборка/журнал, если есть. */
export function tableAnswer(opts: Parameters<typeof directAnswer>[0]): string | null {
  const direct = directAnswer(opts);
  if (direct) return direct;
  const today = opts.today ?? todayMsk(opts.now);
  const labels = labelItems(opts.items);
  const query = parseTableQuestion(opts.question, opts.dict);
  if (!hasConditions(query) && !wantsJournal(opts.question)) return null;
  const out: string[] = [];
  if (hasConditions(query)) {
    const matched = applyQuery(opts.items, query, today);
    out.push(matched.length ? `По таблице (${describeQuery(query)}) — ${matched.length}:` : `По таблице (${describeQuery(query)}) — таких позиций нет.`);
    out.push(...matched.map((i) => personLine(i, labels.get(i.id)!, today, opts.memoBullets?.get(i.id))));
  }
  if (wantsJournal(opts.question)) out.push("", journalBlock(opts.events, labels, 30));
  return out.join("\n").trim();
}

/** Метки [Т7] → позиции, для ссылок в чате (заголовок X-AI-Items): только показанные модели, коротко. */
/** h: "t" — ссылка ведёт в «Трекер» (у ЗГД нет таблицы). */
export type AiItemRef = { l: string; i: string; t: string; h?: "t" };
export function itemRefs(opts: Omit<Parameters<typeof tableContext>[0], "budget">, max = 40): AiItemRef[] {
  // тот же порядок, что у карточек: выборка по вопросу, позиции справки, остальные — первые max (заголовок не раздуваем)
  const { shown, labels } = tableContext({ ...opts, budget: Number.MAX_SAFE_INTEGER });
  return shown.slice(0, max).map((i) => ({ l: labels.get(i.id)!, i: i.id, t: i.title.slice(0, 24) }));
}
export const itemsHeader = (refs: AiItemRef[]): Record<string, string> => (refs.length ? { "X-AI-Items": encodeURIComponent(JSON.stringify(refs)) } : {});

/** Правило для модели к блокам таблицы (облако и локальная модель). */
export const TABLE_RULE = [
  "ТАБЛИЦА ДИРЕКЦИИ — рабочие позиции (задачи) дирекции: сегмент → трек → задача; справка собирается из поданных позиций. Позиция [Т…] — не то же, что пункт справки [n]; связь показана стрелкой «← [Т…]» у пункта.",
  "Ответственный, статус, срок, подана ли, кто создал и кто менял, удалена ли — бери ТОЛЬКО из карточек таблицы. Статус не выводи из слов в тексте («подписан», «ведётся»): только поле «статус».",
  "Списки и числа (сколько, какие, у кого, что просрочено, что не подано) — ТОЛЬКО из «ИТОГОВ» и «ВЫБОРКИ ПО ВОПРОСУ»: они посчитаны программой по всей таблице и полные. Сам не пересчитывай и ничего не добавляй.",
  "Человек в вопросе («что у Майкова») — ответственный за позицию. «Кто создал», «кто менял», «кто подавал», «что изменилось» — из полей «создал»/«последним менял» и «ЖУРНАЛА ПРАВОК».",
  "Если нужного поля нет или оно «не указано» — так и скажи. Никогда не утверждай того, чего нет в данных.",
  "«Что горит», «где вмешаться», «риски» — назови ВСЕ позиции из «СИГНАЛОВ «ГОРИТ»» в их порядке, с причиной и ответственным, и для каждой — что сделать (запросить новый срок, поторопить, принять решение, уточнить статус). Свои дополнительные наблюдения по тексту давай отдельно, с пометкой «Вывод:».",
  "Пометка у пункта справки «строка в таблице изменилась после сборки» — расхождение справки и таблицы: на вопрос о расхождениях назови такие пункты и в чём разница.",
  "Если у карточки есть «подтверждено: …» — это данные для ЗГД: состояние на дату подтверждения директором; в ответе называй эту дату.",
  "ТРЕКЕР — те же позиции в виде доски. Вопросы о движении задач (как двигалась, что застряло, где переносили сроки, что ждёт приёмки, сколько в работе) — ТОЛЬКО по блоку «ТРЕКЕР», строке «трекер:» в карточке и «ИСТОРИИ ЗАДАЧ». Событий, которых там нет, не придумывай; до первой записи история неизвестна — так и скажи. Выводы о динамике (затягивается, буксует, ждёт решения) давай с пометкой «Вывод:».",
  "Каждую позицию в ответе называй словами, а метку ставь рядом: «[Т7] расчёты БКК по консолидации — Майков, В работе, срок 09.10». Одни метки без названий не пиши: человек их не расшифрует. Удалённые помечай «удалена».",
].join("\n");

// ---------- «Трекер»: движение задач (считает программа) ----------
// Доска «Сделать → В работе → На проверке → Выполнено» — те же позиции; движение — из журнала правок (у ЗГД — из
// разницы между отправленными справками). Модель не выдумывает историю: колонки, переносы срока и простой — готовые.

const TRACK_Q = /(двигал|движени|застрял|завис|стоит на месте|перенос|сдвига|сдвинул|приемк|приёмк|трекер|доск|таймлайн|динамик|как шл|как продвига|сколько раз|без движени|колонк|этап)/;
export const wantsTracker = (question: string) => TRACK_Q.test(n(question));

const STOP_SUBJ = new Set([...STOP_WHO, "как", "двигалась", "двигался", "двигалось", "шла", "шло", "история", "историю", "задачи", "что", "было", "происходило", "менялось", "трекер", "трекеру", "движение"]);

/** Позиции, о которых спрашивают по предмету («как двигалась задача по Hai Qiang»): лучшие по совпадению основ слов. */
function bySubject(question: string, items: FactItem[]): FactItem[] {
  const subj = words(question).filter((w) => !STOP_SUBJ.has(w)).map(stem);
  if (!subj.length) return [];
  const scored = items
    .filter((i) => !i.archived)
    .map((i) => ({ i, s: subj.filter((w) => words(`${i.title} ${i.comment ?? ""}`).map(stem).includes(w)).length }))
    .filter((x) => x.s > 0);
  if (!scored.length) return [];
  const best = Math.max(...scored.map((x) => x.s));
  return scored.filter((x) => x.s === best).map((x) => x.i);
}

/** Блок «ТРЕКЕР» для модели: колонки, ждут приёмки, переносы срока, простой, дольше всех в одной колонке. */
export function trackerBlock(items: FactItem[], labels: Map<string, string>): string {
  const act = items.filter((i) => !i.archived && i.motion && i.motion.column !== "HIDDEN");
  if (!act.length) return "";
  const m = (i: FactItem) => i.motion!;
  const lab = (i: FactItem) => `[${labels.get(i.id)}]`;
  const col = (c: string) => act.filter((i) => m(i).column === c);
  const review = col("REVIEW");
  const slipped = act.filter((i) => m(i).slips > 0).sort((a, b) => m(b).slipDays - m(a).slipDays);
  const idle = act.filter((i) => m(i).column !== "DONE" && (m(i).idleDays ?? 0) >= 14).sort((a, b) => (m(b).idleDays ?? 0) - (m(a).idleDays ?? 0));
  const long = act.filter((i) => m(i).column !== "DONE" && (m(i).inColumnDays ?? 0) >= 21).sort((a, b) => (m(b).inColumnDays ?? 0) - (m(a).inColumnDays ?? 0));
  const list = (xs: FactItem[], f: (i: FactItem) => string) => (xs.length ? xs.map((i) => `${lab(i)} ${f(i)}`).join("; ") : "нет");
  return [
    "ТРЕКЕР (доска «Сделать → В работе → На проверке → Выполнено», те же позиции; посчитано программой, полные):",
    `Колонки: ${(["TODO", "DOING", "REVIEW", "DONE"] as const).map((c) => `${COLUMN_LABEL[c]} — ${col(c).length}${col(c).length ? ` (${col(c).map(lab).join(", ")})` : ""}`).join("; ")}.`,
    `Ждут приёмки директором («На проверке»): ${list(review, (i) => (m(i).inColumnDays === null ? "?" : daysText(m(i).inColumnDays!)))}.`,
    `Срок переносили позже: ${list(slipped, (i) => `${m(i).slips}× (+${m(i).slipDays} дн.)`)}.`,
    `Без движения 14+ дней (не выполнены): ${list(idle, (i) => `${m(i).idleDays} дн.`)}.`,
    `Дольше 3 недель в одной колонке: ${list(long, (i) => `«${COLUMN_LABEL[m(i).column]}» ${m(i).inColumnDays} дн.`)}.`,
  ].join("\n");
}

/** История выбранных задач — события по порядку. */
export function historyBlock(list: FactItem[], labels: Map<string, string>): string {
  return [
    "ИСТОРИЯ ЗАДАЧ (по журналу правок и справкам; раньше первой записи история неизвестна):",
    ...list.map((i) => `[${labels.get(i.id)}] «${short(i.title, 90)}»:\n  ${i.motion!.history.join("\n  ")}`),
  ].join("\n");
}

/**
 * Прямые ответы по трекеру (без модели): «где переносили срок», «что застряло / без движения», «что ждёт приёмки»,
 * «как двигалась задача …». null — не такой вопрос или трекера нет.
 */
export function trackerAnswer(question: string, items: FactItem[], labels: Map<string, string>): string | null {
  if (!wantsTracker(question) || !items.some((i) => i.motion)) return null;
  const q = n(question);
  const act = items.filter((i) => !i.archived && i.motion && i.motion.column !== "HIDDEN");
  const m = (i: FactItem) => i.motion!;
  const line = (i: FactItem, extra: string) => `[${labels.get(i.id)}] «${short(i.title)}» — ${i.owner ?? "ответственный не указан"}; ${extra}`;
  if (/(перенос|сдвига|сдвинул|сколько раз)/.test(q) && /срок/.test(q)) {
    const xs = act.filter((i) => m(i).slips > 0).sort((a, b) => m(b).slipDays - m(a).slipDays);
    return xs.length
      ? [`Срок переносили позже у ${xs.length} ${xs.length % 10 === 1 && xs.length % 100 !== 11 ? "задачи" : "задач"}:`, ...xs.map((i) => line(i, `${m(i).slips}× (+${m(i).slipDays} дн.), сейчас ${i.deadline ? `срок ${ru(i.deadline)}` : "срока нет"}`))].join("\n")
      : "По истории трекера срок позже ни у одной задачи не переносили.";
  }
  if (/(застрял|завис|стоит на месте|без движени)/.test(q)) {
    const xs = act.filter((i) => m(i).column !== "DONE" && (m(i).idleDays ?? 0) >= 14).sort((a, b) => (m(b).idleDays ?? 0) - (m(a).idleDays ?? 0));
    return xs.length
      ? [`Без движения 14 дней и больше (не выполнены) — ${xs.length}:`, ...xs.map((i) => line(i, `«${COLUMN_LABEL[m(i).column]}», последнее движение ${m(i).idleDays} дн. назад`))].join("\n")
      : "Задач без движения 14 дней и больше нет: все невыполненные задачи менялись за последние две недели.";
  }
  if (/(приемк|приёмк)/.test(q)) {
    const xs = act.filter((i) => m(i).column === "REVIEW");
    return xs.length ? [`Ждут приёмки директором («На проверке») — ${xs.length}:`, ...xs.map((i) => line(i, `на проверке ${m(i).inColumnDays === null ? "?" : daysText(m(i).inColumnDays!)}`))].join("\n") : "На проверке (ждут приёмки директором) задач нет.";
  }
  if (/(двигал|движени|как шл|как продвига)/.test(q)) {
    const xs = bySubject(question, items).filter((i) => i.motion?.history.length).slice(0, 3);
    if (!xs.length) return null;
    return xs.map((i) => [`[${labels.get(i.id)}] «${short(i.title)}» — сейчас ${motionText(m(i))}:`, ...m(i).history.map((h) => `  ${h}`)].join("\n")).join("\n\n");
  }
  return null;
}
