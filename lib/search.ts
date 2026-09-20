/**
 * Поиск по таблице: без учёта регистра, «е» и «ё» равны, несколько слов — все должны найтись
 * (в любых полях и в любом порядке). Чистые функции: используются и на сервере, и для подсветки в интерфейсе.
 */
export const MAX_QUERY_LENGTH = 200;
const MAX_TOKENS = 8;

export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\u00a0\u2009\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Слова запроса (без повторов, не больше MAX_TOKENS). Пустой запрос → []. */
export function tokenize(query: string): string[] {
  const n = normalizeText(query.slice(0, MAX_QUERY_LENGTH));
  return n ? [...new Set(n.split(" "))].slice(0, MAX_TOKENS) : [];
}

/** Все слова запроса найдены в тексте (haystack уже нормализован normalizeText). */
export function matchesTokens(haystack: string, tokens: string[]): boolean {
  return tokens.every((t) => haystack.includes(t));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, (ch) => "\\" + ch);
}

/** Регулярное выражение для подсветки найденных слов в исходном тексте (е ↔ ё, любой регистр). */
export function highlightRegex(query: string): RegExp | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  const parts = tokens
    .sort((a, b) => b.length - a.length)
    .map((t) => escapeRegex(t).replace(/е/g, "[её]"));
  return new RegExp(`(${parts.join("|")})`, "giu");
}
