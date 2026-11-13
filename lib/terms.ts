/**
 * Как дирекция называет свои разделы таблицы. По умолчанию — «Сегмент / Сегменты», но у дирекции это могут быть
 * «Проект / Проекты», «Направление / Направления», «Судно / Суда» — меняется в «Настройки → Сегменты» и видно только ей.
 * (Название колонки «Трек» и остальных колонок меняется в «Колонках таблицы».)
 */
export type Terms = { one: string; many: string };

export const DEFAULT_TERMS: Terms = { one: "Сегмент", many: "Сегменты" };
export const TERM_MAX = 30;

/** Ключ настройки в app_settings: у каждой дирекции свои названия. */
export const termsKey = (directorateId: string) => `directorate.terms:${directorateId}`;

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, TERM_MAX) : "");

/** Сохранённое значение → названия; пустое или испорченное — названия по умолчанию. */
export function normalizeTerms(value: unknown): Terms {
  const v = (value && typeof value === "object" ? value : {}) as { one?: unknown; many?: unknown };
  return { one: clean(v.one) || DEFAULT_TERMS.one, many: clean(v.many) || DEFAULT_TERMS.many };
}

const isDefault = (t: Terms) => t.one === DEFAULT_TERMS.one && t.many === DEFAULT_TERMS.many;

/** «Все сегменты»; у своего названия падеж не угадать — «Проекты: все». */
export const allLabel = (t: Terms) => (isDefault(t) ? "Все сегменты" : `${t.many}: все`);
/** «Без сегмента»; у своего названия — «Проект не указан». */
export const noneLabel = (t: Terms) => (isDefault(t) ? "Без сегмента" : `${t.one} не указан`);
