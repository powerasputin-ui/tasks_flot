/**
 * Как дирекция называет разделы своей таблицы. По умолчанию — «Сегмент / Сегменты» и «Трек / Треки», но у дирекции это
 * могут быть «Проект / Проекты», «Направление / Направления», «Судно / Суда» — меняется в «Настройки → Сегменты» и
 * «Настройки → Треки» и видно только ей. Остальные колонки переименовываются в «Колонках таблицы».
 *
 * Падежи своего названия не угадать, поэтому со своим названием подписи строятся из именительного падежа
 * («Проекты: все», «Проект: не указано»); с названиями по умолчанию — привычные фразы («Все сегменты», «Без сегмента»).
 */
export type Terms = { one: string; many: string; trackOne: string; trackMany: string };

export const DEFAULT_TERMS: Terms = { one: "Сегмент", many: "Сегменты", trackOne: "Трек", trackMany: "Треки" };
export const TERM_MAX = 30;

/** Ключ настройки в app_settings: у каждой дирекции свои названия. */
export const termsKey = (directorateId: string) => `directorate.terms:${directorateId}`;

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, TERM_MAX) : "");

/** Сохранённое значение → названия; пустое или испорченное поле — название по умолчанию. */
export function normalizeTerms(value: unknown): Terms {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof Terms, unknown>>;
  return {
    one: clean(v.one) || DEFAULT_TERMS.one,
    many: clean(v.many) || DEFAULT_TERMS.many,
    trackOne: clean(v.trackOne) || DEFAULT_TERMS.trackOne,
    trackMany: clean(v.trackMany) || DEFAULT_TERMS.trackMany,
  };
}

const segmentDefault = (t: Terms) => t.one === DEFAULT_TERMS.one && t.many === DEFAULT_TERMS.many;
const trackDefault = (t: Terms) => t.trackOne === DEFAULT_TERMS.trackOne && t.trackMany === DEFAULT_TERMS.trackMany;
/** «Проект» → «проект» в середине фразы; аббревиатуры («ТОФ») не трогаем. */
const lower = (s: string) => (s.length > 1 && s[1] === s[1].toUpperCase() && s[1] !== s[1].toLowerCase() ? s : s.charAt(0).toLowerCase() + s.slice(1));

/** «Все сегменты» · «Проекты: все». */
export const allLabel = (t: Terms) => (segmentDefault(t) ? "Все сегменты" : `${t.many}: все`);
/** «Без сегмента» · «Судно: не указано» (род своего названия не угадать — безличная форма). */
export const noneLabel = (t: Terms) => (segmentDefault(t) ? "Без сегмента" : `${t.one}: не указано`);
/** «Сегментов: 3» · «Проекты: 3». */
export const segmentsCount = (t: Terms, n: number) => (segmentDefault(t) ? `Сегментов: ${n}` : `${t.many}: ${n}`);
/** «Без трека» · «Работа: не указано». */
export const noTrackLabel = (t: Terms) => (trackDefault(t) ? "Без трека" : `${t.trackOne}: не указано`);
/** «треков: 3» · «суда: 3». */
export const tracksCount = (t: Terms, n: number) => (trackDefault(t) ? `треков: ${n}` : `${lower(t.trackMany)}: ${n}`);
/** «Добавить трек» · «Добавить: судно». */
export const addTrackLabel = (t: Terms) => (trackDefault(t) ? "Добавить трек" : `Добавить: ${lower(t.trackOne)}`);
/** Подпись колонки «Трек»: своя подпись колонки (её задали в «Колонках таблицы») важнее; иначе — название из терминов дирекции. */
export const trackColumnLabel = (columnLabel: string | null | undefined, t: Terms) => {
  const own = columnLabel?.trim();
  return own && own !== DEFAULT_TERMS.trackOne ? own : t.trackOne;
};
/** Подсказка над списком слева. */
export const pickHint = (t: Terms) =>
  segmentDefault(t) && trackDefault(t)
    ? "Выберите несколько сегментов, чтобы сравнить их в одной таблице. Правая кнопка по сегменту — «Раскрыть сегмент»: его треки."
    : `${t.many}: отметьте несколько, чтобы сравнить их в одной таблице. Правая кнопка по строке — раскрыть её (${lower(t.trackMany)}).`;
/** Пункт меню «Раскрыть сегмент (треков: 4)» / «Свернуть сегмент». */
export const expandLabel = (t: Terms, open: boolean, n: number) =>
  segmentDefault(t) && trackDefault(t) ? (open ? "Свернуть сегмент" : `Раскрыть сегмент (треков: ${n})`) : open ? "Свернуть" : `Раскрыть (${tracksCount(t, n)})`;
/** Пустой раскрытый сегмент. */
export const emptySegmentHint = (t: Terms) => (segmentDefault(t) && trackDefault(t) ? "В сегменте пока нет позиций с треками." : `Здесь пока нет позиций, у которых указано: ${lower(t.trackOne)}.`);
/** «По трекам» в аналитике. */
export const byTracksTitle = (t: Terms) => (trackDefault(t) ? "По трекам" : t.trackMany);

/** Названия треков по умолчанию («Трек / Треки»): привычные фразы оставляем как были. */
export const isDefaultTrackTerm = trackDefault;
/** Названия сегментов по умолчанию. */
export const isDefaultSegmentTerm = segmentDefault;
/** «Дублировать трек» · «Дублировать: судно». */
export const duplicateTrackLabel = (t: Terms) => (trackDefault(t) ? "Дублировать трек" : `Дублировать: ${lower(t.trackOne)}`);
/** « · выбрано треков: 2» · «выбрано (суда): 2». */
export const pickedTracks = (t: Terms, n: number) => (trackDefault(t) ? `выбрано треков: ${n}` : `выбрано (${lower(t.trackMany)}): ${n}`);
/** Подсказка у галочки трека в раскрытом сегменте. */
export const trackPickTitle = (t: Terms, on: boolean) => (trackDefault(t) ? (on ? "Снять выбор трека" : "Показать в таблице только этот трек") : on ? "Снять выбор" : `Показать в таблице только это (${lower(t.trackOne)})`);
/** Поле названия нового трека. */
export const newTrackPlaceholder = (t: Terms) => (trackDefault(t) ? "Название нового трека" : `Название (${lower(t.trackOne)})`);
/** Куда попадёт новый трек. */
export const trackPlaceHint = (t: Terms, segmentName: string | null) =>
  trackDefault(t) && segmentDefault(t)
    ? segmentName
      ? `Трек будет в сегменте «${segmentName}».`
      : "Без сегмента — трек будет виден во всех сегментах."
    : segmentName
      ? `${t.one}: «${segmentName}».`
      : `${t.one}: не указано — значение будет доступно везде.`;
/** Кнопка создания трека. */
export const createTrackLabel = (t: Terms) => (trackDefault(t) ? "Создать трек" : "Создать");
/** Похожие названия при создании трека. */
export const similarTracksHint = (t: Terms) => (trackDefault(t) ? "Есть похожие треки (см. выше). Если это точно другой трек — нажмите кнопку ещё раз." : "Есть похожие названия (см. выше). Если это точно другое — нажмите кнопку ещё раз.");
export const exactTrackHint = (t: Terms) => (trackDefault(t) ? "Такой трек уже есть:" : "Такое название уже есть:");
/** Круговая диаграмма аналитики. */
export const pieEmptyHint = (t: Terms) => (trackDefault(t) ? "Отметьте треки ниже, чтобы построить диаграмму." : "Отметьте строки ниже, чтобы построить диаграмму.");
/** Как таблица превращается в разделы справки (Настройки → Вид справки). */
export const memoSectionsHint = (t: Terms) =>
  trackDefault(t) && segmentDefault(t)
    ? "«Трек» и «Сегмент» задают разделы справки: отмечен трек — разделы по трекам, только сегмент — по сегментам, ничего — просто список пунктов. Остальные столбцы идут в текст пункта."
    : `«${t.trackOne}» и «${t.one}» задают разделы справки: отмечено «${t.trackOne}» — разделы по этому полю, только «${t.one}» — по нему, ничего — просто список пунктов. Остальные столбцы идут в текст пункта.`;

/** Раскладка колонок для показа: у колонки «Трек» без своей подписи — название из терминов дирекции. */
export const withTermLabels = <T extends { key: string; label: string }>(cols: T[], t: Terms): T[] => cols.map((c) => (c.key === "track" ? { ...c, label: trackColumnLabel(c.label, t) } : c));
/** Обратно перед сохранением раскладки: название из терминов не записываем как свою подпись колонки — иначе оно «прилипнет». */
export const withoutTermLabels = <T extends { key: string; label: string }>(cols: T[], t: Terms): T[] => cols.map((c) => (c.key === "track" && c.label === t.trackOne ? { ...c, label: DEFAULT_TERMS.trackOne } : c));
