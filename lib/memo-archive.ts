import { matchesTokens, normalizeText, tokenize } from "@/lib/search";
import { visibleSections, type MemoDoc } from "@/lib/memo";

/** Строка-источник в снимке отправленной версии (то, что видел составитель в карточке «источник»). */
export type VersionSource = {
  id: string;
  title: string;
  comment: string | null;
  ownerName: string | null;
  statusName: string | null;
  deadline: string | null;
  trackName: string | null;
  segmentName: string | null;
};

/** Весь текст версии одной нормализованной строкой — для поиска: заголовок, разделы, пункты и названия задач-источников. */
export function memoSearchText(title: string, doc: MemoDoc, sources: VersionSource[]): string {
  const parts = [title];
  for (const s of visibleSections(doc)) {
    parts.push(s.title);
    for (const b of s.bullets) parts.push(b.text);
  }
  const used = new Set(visibleSections(doc).flatMap((s) => s.bullets.flatMap((b) => b.itemIds)));
  for (const src of sources) if (used.has(src.id)) parts.push(src.title);
  return normalizeText(parts.join(" \n "));
}

export type VersionMatch = { section: string; text: string };

/** Пункты версии, в которых встретились слова запроса (все слова — в тексте пункта или названии его задач), для подсветки в результатах поиска. */
export function matchBullets(doc: MemoDoc, sources: VersionSource[], query: string, limit = 5): VersionMatch[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out: VersionMatch[] = [];
  for (const section of visibleSections(doc)) {
    for (const b of section.bullets) {
      const hay = normalizeText([b.text, ...b.itemIds.map((id) => byId.get(id)?.title ?? "")].join(" "));
      if (matchesTokens(hay, tokens)) {
        out.push({ section: section.title, text: b.text });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/** Версия подходит под запрос: все слова найдены где-то в её тексте. */
export function versionMatches(searchText: string, query: string): boolean {
  const tokens = tokenize(query);
  return tokens.length === 0 || matchesTokens(searchText, tokens);
}

/** Дата, по которой оперативку ищут и сортируют: дата совещания, а если её нет — дата отправки. */
export function effectiveDate(v: { meetingDate: Date | string | null; sentAt: Date | string }): Date {
  return new Date(v.meetingDate ?? v.sentAt);
}
