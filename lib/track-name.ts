import { normalizeText } from "@/lib/search";

/** Ограничения названия трека (одни и те же на сервере и в форме). */
export const TRACK_NAME_MIN = 2;
export const TRACK_NAME_MAX = 80;

/** Ключ для сравнения: без регистра, е = ё, без пробелов, дефисов, кавычек и прочей пунктуации («Нефть-газ» = «нефть газ»). */
export function trackKey(name: string): string {
  return normalizeText(name).replace(/[^\p{L}\p{N}]+/gu, "");
}

export type TrackNameCheck = { ok: true; name: string } | { ok: false; error: string };

/** Приводит ввод к аккуратному виду и ловит явный мусор. Первая буква — заглавная, лишние пробелы убираются. */
export function checkTrackName(raw: string): TrackNameCheck {
  const name = raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["«»'`]+|["«»'`]+$/g, "")
    .trim();
  if (name.length < TRACK_NAME_MIN) return { ok: false, error: `Название слишком короткое — минимум ${TRACK_NAME_MIN} символа.` };
  if (name.length > TRACK_NAME_MAX) return { ok: false, error: `Название слишком длинное — максимум ${TRACK_NAME_MAX} символов.` };
  if (!/\p{L}/u.test(name)) return { ok: false, error: "В названии должны быть буквы." };
  const key = trackKey(name);
  if (key.length < TRACK_NAME_MIN) return { ok: false, error: "Название слишком короткое." };
  if (new Set(key).size === 1 && key.length > 2) return { ok: false, error: "Похоже на случайный набор символов — введите настоящее название." };
  if (/(.)\1{3,}/u.test(key)) return { ok: false, error: "Слишком много одинаковых букв подряд — проверьте опечатку." };
  return { ok: true, name: name[0].toUpperCase() + name.slice(1) };
}

function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

export type TrackMatch<T> = { track: T; kind: "exact" | "prefix" | "contains" | "similar" };

/**
 * Что из уже существующих треков стоит показать человеку, пока он вводит название:
 * точное совпадение (после нормализации), начало слова/названия, вхождение и «почти такое же» (опечатка в 1–2 буквы).
 * Результат отсортирован: точные → по началу → по вхождению → похожие.
 */
export function findTrackMatches<T extends { name: string }>(input: string, tracks: T[], max = 6): TrackMatch<T>[] {
  const q = trackKey(input);
  if (q.length < 1) return [];
  const words = normalizeText(input).split(" ").filter(Boolean);
  const out: Array<TrackMatch<T> & { rank: number }> = [];
  for (const track of tracks) {
    const key = trackKey(track.name);
    const norm = normalizeText(track.name);
    let kind: TrackMatch<T>["kind"] | null = null;
    if (key === q) kind = "exact";
    else if (key.startsWith(q) || norm.split(" ").some((w) => w.startsWith(q))) kind = "prefix";
    else if (q.length >= 2 && (key.includes(q) || words.every((w) => key.includes(trackKey(w))))) kind = "contains";
    else if (q.length >= 4) {
      // опечатка: сравниваем с названием целиком, с его началом такой же длины и с каждым словом по отдельности
      const limit = q.length >= 8 ? 2 : 1;
      const candidates = [key, key.slice(0, q.length), ...norm.split(" ").map(trackKey).filter((w) => w.length >= 4)];
      if (candidates.some((c) => distance(q, c, limit) <= limit)) kind = "similar";
    }
    if (kind) out.push({ track, kind, rank: { exact: 0, prefix: 1, contains: 2, similar: 3 }[kind] });
  }
  return out.sort((a, b) => a.rank - b.rank || a.track.name.localeCompare(b.track.name, "ru")).slice(0, max).map(({ track, kind }) => ({ track, kind }));
}
