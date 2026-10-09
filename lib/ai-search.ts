import { normalizeText } from "@/lib/search";
import { visibleSections, type MemoDoc } from "@/lib/memo";

/**
 * Поиск для ИИ-помощников (чат ЗГД / директора и «Оперативщик»): тот же поиск, что в таблице и архиве справок
 * (lib/search.ts: регистр, «е/ё»), но по смыслу вопроса, а не по точной фразе:
 *  - из вопроса берутся значимые слова (без «найди», «где», «по», «у нас» …) и их основы — «двигателя» найдёт «двигатель»;
 *  - совпадение не обязано быть по всем словам: находки ранжируются по числу совпавших слов, редкие слова весят больше;
 *  - ищем в общей таблице дирекции (включая удалённые позиции), в отправленных справках (архив) и в текущем черновике.
 * Найденное отдаётся модели отдельным блоком с метками [Т1] (таблица), [С1] (справки), а на процессоре — списком сразу.
 * Права: таблица — только тем, кому она доступна (не ЗГД), справки — по canViewVersion. Чистые функции — здесь,
 * загрузка из базы — lib/ai-search-load.ts.
 */

/** Правило для облачной модели к блоку «НАЙДЕНО ПОИСКОМ» — общее для чата ЗГД/директора и «Оперативщика». */
export const SEARCH_RULE =
  "Если ниже есть блок «НАЙДЕНО ПОИСКОМ» — это результаты поиска по таблице позиций (метки [Т1], [Т2]…, включая удалённые позиции) и по справкам ([С1]…). " +
  "Вопрос про то, что есть в таблице или было в справках, отвечай по этому блоку со ссылками на метки; у позиций называй статус, ответственного и срок, удалённые помечай «удалена». " +
  "Если подходящего ничего нет — так и скажи, не додумывай.";

const STOP = new Set(
  (
    "найди найти поищи поиск поиска покажи покажите скажи подскажи есть ли был была были было где когда кто что чем чей чья чьё какой какая какое какие каких " +
    "сколько почему зачем как там тут это эта этот эти того тому том нам нас наш наша наши мне меня мой моя у в во на по о об обо от до из за для с со к ко " +
    "и а но или ли же бы не ни то так уже еще ещё всё все всех вообще про при под над между через позиция позиции позицию позиций строка строки " +
    "таблица таблице таблицы таблицу справка справке справки справку справках архив архиве удален удалена удалены удаленные удалённые удаленных удалённых " +
    "оперативка оперативке оперативки нужно надо можно сейчас сегодня вчера пожалуйста т/х м/в"
  ).split(" "),
);

/** Основа слова: у длинных отрезаем окончание (русские падежи), короткие — как есть. */
export function stem(word: string): string {
  return word.length > 5 ? word.slice(0, Math.max(5, word.length - 2)) : word;
}

/** Значимые слова вопроса → основы (без повторов). Числа и даты сохраняются целиком. */
export function searchTerms(question: string): string[] {
  const words = normalizeText(question).match(/[а-яa-z0-9][а-яa-z0-9.\-/]*/g) ?? [];
  const out: string[] = [];
  for (const w0 of words) {
    const w = w0.replace(/[.\-/]+$/, "");
    if (w.length < 3 && !/^\d+$/.test(w)) continue;
    if (STOP.has(w)) continue;
    const s = /\d/.test(w) ? w : stem(w);
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, 10);
}

/** Хочет ли человек именно найти что-то в таблице / архиве (а не разобрать открытую справку). */
// только явная просьба найти или вопрос про таблицу / архив / удалённые; «когда…», «что по…» — свободный вопрос
// (он тоже получает находки, но отвечает прежде всего по открытой справке)
const SEARCH_RE = /(найд|найти|поищ|поиск|есть ли|покаж|в таблиц|в архив|в прошл[а-я]* справк|удал[её]н|кто отвечает|статус позици|какие позиции)/;
// разбор открытой справки (быстрые кнопки и вопросы «про всё сразу») — не поиск
const NOT_SEARCH = /(слаб|вмешат|вопрос.*(задать|директор)|зададут|выжимк|одному стил|непонятн|просроч|под угроз|риск|проблем|главн|итог|кратко)/;
export function isSearchQuestion(question: string): boolean {
  const q = normalizeText(question);
  return SEARCH_RE.test(q) && !NOT_SEARCH.test(q);
}

export type SearchItem = {
  id: string;
  name: string;
  comment: string | null;
  trackName: string | null;
  segmentName: string | null;
  ownerName: string | null;
  statusName: string | null;
  deadline: Date | string | null;
  cost?: string | null;
  /** Прикреплённые документы (ссылки на общий диск): название и путь — модель их называет, содержимое не видит. */
  files?: Array<{ name: string; path: string }>;
  archived: boolean;
  haystack: string;
};
export type SearchMemo = { id: string; directorate: string; title: string; date: string; doc: MemoDoc; draft?: boolean };

export type Hit =
  | { kind: "item"; score: number; item: SearchItem }
  | { kind: "memo"; score: number; memo: SearchMemo; section: string; text: string };

/** Вес слова: чем реже встречается во всех текстах, тем важнее совпадение. */
function weights(terms: string[], texts: string[]): Map<string, number> {
  const w = new Map<string, number>();
  for (const t of terms) {
    const df = texts.reduce((n, x) => n + (x.includes(t) ? 1 : 0), 0);
    w.set(t, df === 0 ? 0 : 1 + Math.log((texts.length + 1) / df));
  }
  return w;
}

/**
 * Находки по вопросу: позиции таблицы и пункты справок. Нужна хотя бы половина значимых слов (минимум одно),
 * сортировка — по весу совпавших слов; при равенстве — сначала действующие позиции и свежие справки.
 */
export function searchAll(question: string, items: SearchItem[], memos: SearchMemo[], limit = 12): { terms: string[]; hits: Hit[] } {
  const terms = searchTerms(question);
  if (terms.length === 0) return { terms, hits: [] };
  const bullets = memos.flatMap((memo) => visibleSections(memo.doc).flatMap((s) => s.bullets.filter((b) => b.text.trim()).map((b) => ({ memo, section: s.title || "Прочие направления", text: b.text.trim(), hay: normalizeText(`${s.title} ${b.text}`) }))));
  const w = weights(terms, [...items.map((i) => i.haystack), ...bullets.map((b) => b.hay)]);
  const need = Math.max(1, Math.ceil(terms.filter((t) => (w.get(t) ?? 0) > 0).length / 2));
  const score = (hay: string) => {
    let s = 0;
    let n = 0;
    for (const t of terms)
      if (hay.includes(t)) {
        s += w.get(t) ?? 0;
        n++;
      }
    return n >= need ? s : 0;
  };
  const hits: Hit[] = [];
  for (const item of items) {
    const s = score(item.haystack);
    if (s > 0) hits.push({ kind: "item", score: s + (item.archived ? 0 : 0.01), item });
  }
  memos.forEach((memo, mi) => {
    for (const b of bullets.filter((x) => x.memo === memo)) {
      const s = score(b.hay);
      if (s > 0) hits.push({ kind: "memo", score: s + (memo.draft ? 0.02 : 0) - mi * 0.0001, memo, section: b.section, text: b.text });
    }
  });
  hits.sort((a, b) => b.score - a.score);
  return { terms, hits: hits.slice(0, limit) };
}

const ru = (d: Date | string) => new Date(d).toLocaleDateString("ru-RU", { timeZone: "UTC" });
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);

/** Одна находка строкой: [Т1] позиция с полями / [С1] пункт справки. */
export function hitLine(h: Hit, i: { t: number; s: number }, textLimit = 220): string {
  if (h.kind === "item") {
    const it = h.item;
    const parts = [
      it.trackName ? `трек: ${it.trackName}` : null,
      it.segmentName ? `сегмент: ${it.segmentName}` : null,
      it.ownerName ? `отв.: ${it.ownerName}` : "ответственный не указан",
      it.statusName ? `статус: ${it.statusName}` : null,
      it.deadline ? `срок: ${ru(it.deadline)}` : "срок не указан",
      it.cost ? `оценка: ${it.cost}` : null,
    ].filter(Boolean);
    const files = it.files?.length ? `. Документы: ${it.files.slice(0, 3).map((f) => `«${f.name}» (${cut(f.path, 160)})`).join("; ")}` : "";
    return `[Т${++i.t}] ${it.archived ? "УДАЛЕНА — " : ""}позиция «${cut(it.name, 140)}» — ${parts.join("; ")}${it.comment ? `. Комментарий: ${cut(it.comment, textLimit)}` : ""}${files}`;
  }
  return `[С${++i.s}] ${h.memo.draft ? "черновик текущей справки" : `справка «${cut(h.memo.title, 80)}» от ${h.memo.date}`}${h.memo.directorate ? ` (${h.memo.directorate})` : ""}, раздел «${h.section}»: ${cut(h.text, textLimit)}`;
}

/** Блок найденного для модели (в пределах maxChars). */
export function hitsBlock(found: { terms: string[]; hits: Hit[] }, maxChars: number, scope: string): string {
  if (found.terms.length === 0) return "";
  const head = `НАЙДЕНО ПОИСКОМ по словам «${found.terms.join("», «")}» (${scope}):`;
  if (found.hits.length === 0) return `${head}\nничего не найдено.`;
  const idx = { t: 0, s: 0 };
  const lines = [head];
  let used = head.length;
  for (const h of found.hits) {
    const line = hitLine(h, idx, maxChars < 2500 ? 140 : 260);
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

/** Готовый ответ поиска без модели (локальная модель на процессоре): что нашлось, по порядку важности. */
export function hitsAnswer(found: { terms: string[]; hits: Hit[] }, scope: string): string {
  if (found.terms.length === 0) return "Не понял, что искать: напишите название, судно, трек, ответственного или слово из комментария.";
  if (found.hits.length === 0) return `Ничего не нашлось по словам «${found.terms.join("», «")}» (${scope}). Попробуйте другое слово или короче.`;
  const idx = { t: 0, s: 0 };
  const items = found.hits.filter((h) => h.kind === "item").length;
  const deleted = found.hits.filter((h) => h.kind === "item" && h.item.archived).length;
  const memos = found.hits.length - items;
  const summary = [items ? `позиций: ${items}${deleted ? ` (удалённых: ${deleted})` : ""}` : null, memos ? `пунктов справок: ${memos}` : null].filter(Boolean).join(", ");
  return `Нашёл по словам «${found.terms.join("», «")}» — ${summary}:\n${found.hits.map((h) => hitLine(h, idx, 200)).join("\n")}`;
}
