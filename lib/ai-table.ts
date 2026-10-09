import { normalizeText } from "@/lib/search";
import { PROTECTED_STATUSES } from "@/lib/statuses";

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
const closed = (i: FactItem) => !!i.status && PROTECTED_STATUSES.includes(i.status);
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

export function cardLine(i: FactItem, label: string, today: number, titleLimit = 260): string {
  const deadline = i.deadline
    ? `${ru(i.deadline)}${isOverdue(i, today) ? ` — просрочен на ${Math.round((today - dayOf(i.deadline)) / DAY)} дн.` : isSoon(i, today) ? ` — через ${Math.round((dayOf(i.deadline) - today) / DAY)} дн.` : ""}`
    : "не указан";
  const parts = [
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

const ACTION: Record<string, (e: FactEvent) => string> = {
  CREATE: () => "создал позицию",
  ARCHIVE: () => "удалил позицию",
  RESTORE: () => "вернул позицию из удалённых",
  OPER_FLAG_CHANGE: (e) => (e.after === "true" ? "подал в справку" : "отозвал из справки"),
  STATUS_CHANGE: (e) => `сменил статус: ${e.before ?? "—"} → ${e.after ?? "—"}`,
  DEADLINE_CHANGE: (e) => `сменил срок: ${e.before ? e.before.slice(0, 10) : "—"} → ${e.after ? e.after.slice(0, 10) : "—"}`,
  OWNER_CHANGE: (e) => `сменил ответственного: ${e.before ?? "—"} → ${e.after ?? "—"}`,
  ATTRACTIVENESS_CHANGE: (e) => `сменил «внимание»: ${e.before ?? "—"} → ${e.after ?? "—"}`,
  UPDATE: (e) => (e.field === "title" ? "изменил текст задачи" : e.field === "comment" ? "изменил комментарий" : e.field === "files" ? `изменил документы (${e.after ?? "—"})` : `изменил поле ${e.field ?? ""}`),
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
  const order = [...matched, ...opts.items.filter((i) => opts.memoItemIds.includes(i.id)), ...opts.items];
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
  const text = [parts[0], ...(parts[1] ? [parts[1]] : []), "", head, ...cards, ...(journal ? ["", journal] : [])].join("\n");
  return { text, labels, query, matched, shown };
}

// ---------- прямые ответы программы ----------
// Экзамен: даже с полными данными модель путает метки и теряет людей в журнале. Вопросы «какие / у кого / сколько /
// есть ли» и «кто подавал / что изменилось» — это точный фильтр, отвечает программа (100 % верно); модель — там, где
// нужно думать (что горит, формулировки, сравнение).

/** Вопрос-список: «какие…», «что у…/в…/по…», «у каких», «у кого», «сколько», «есть ли», «покажи», «кто отвечает». */
export function isListQuestion(question: string): boolean {
  return /^(какие|какая|какой|каких|что (у|в|по|просроч|не подан|сейчас|ещ)|у как|у кого|сколько|есть ли|покажи|перечисли|список|кто (отвечает|ответствен))/.test(n(question).replace(/^(а|и|скажи|подскажи|пожалуйста)[ ,]+/, ""));
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
  const people = [...new Set([...opts.dict.owners, ...opts.items.map((i) => i.author).filter((x): x is string => !!x), ...opts.events.map((e) => e.who).filter((x): x is string => !!x)])];
  const jq = parseJournalQuestion(opts.question, people, opts.now);
  if (jq && (jq.actions || /(что|какие)\s.*(изменил|изменен)/.test(n(opts.question)))) return journalAnswer(opts.events, opts.items, labels, jq);
  const query = parseTableQuestion(opts.question, opts.dict);
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
export type AiItemRef = { l: string; i: string; t: string };
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
  "Каждую позицию в ответе называй словами, а метку ставь рядом: «[Т7] расчёты БКК по консолидации — Майков, В работе, срок 09.10». Одни метки без названий не пиши: человек их не расшифрует. Удалённые помечай «удалена».",
].join("\n");
