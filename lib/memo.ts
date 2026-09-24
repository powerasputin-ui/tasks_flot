/**
 * Справка директора («Статус текущих задач по дирекции … к ОС …»). Чистая логика без базы:
 * сборка черновика из поданных («Опер») позиций, добавление новых позиций без потери правок, слияние пунктов,
 * пометки «источник изменился». Хранится как JSON в `Cycle.memoDraft`.
 */

export type MemoBullet = {
  id: string;
  text: string;
  /** Позиции-источники пункта (пункт может склеивать несколько строк). */
  itemIds: string[];
  origin: "auto" | "manual";
  /** Текст правили руками: обновлять его из данных автоматически нельзя. */
  edited: boolean;
  /** Скрыт: в файл не идёт, но остаётся в черновике. */
  hidden: boolean;
  /** Хэш исходного текста источников на момент сборки или последнего принятия. */
  sourceHash: string;
  /**
   * Директор положил строку в справку сам — из таблицы («В справку») или кнопкой «+» из «Не вошло в справку».
   * Такой пункт автоматика не выкидывает, даже если строка не подана: явное решение человека сильнее правила.
   */
  pinned?: boolean;
};

export type MemoSectionDoc = {
  id: string;
  title: string;
  /** "other" — служебный раздел «Прочие направления» для строк без раздела. */
  kind: "section" | "other";
  bullets: MemoBullet[];
};

export type MemoDoc = {
  sections: MemoSectionDoc[];
  /** Заголовок, вписанный директором вручную. Пусто/не задано — заголовок собирается сам (см. memoTitle). */
  title?: string;
};

export type SourceItem = {
  id: string;
  title: string;
  comment: string | null;
  operFlag: boolean;
  archived: boolean;
  trackId: string | null;
  segmentId?: string | null;
  createdAt?: Date | string;
  /** Готовый текст заготовки пункта, собранный по «виду справки» дирекции (поля таблицы). Если не задан — комментарий или название. */
  text?: string;
};

/**
 * Раздел справки: трековый (в него входит один трек) или сегментный. Какие из них вообще существуют, решает
 * «Вид справки»: отмечен «Трек» — в структуру попадают треки, отмечен «Сегмент» — сегменты (см. `loadSectionDefs`).
 * У строки сначала ищется раздел по треку, если трека нет или он не в структуре — по сегменту.
 */
export type SectionDef = { id: string; title: string; trackIds: string[]; segmentIds?: string[] };

/**
 * Вид справки (настройка дирекции): отмеченные галочками столбцы таблицы — это и есть содержимое справки.
 * «Сегмент» и «Трек» задают структуру документа: отмечен «Трек» — разделы по трекам (сегмент, если тоже отмечен,
 * уходит в начало текста пункта); отмечен только «Сегмент» — разделы по сегментам; не отмечено ни то, ни другое —
 * разделов нет вообще, просто список пунктов. Остальные столбцы (задача, комментарий, ответственный, дедлайн,
 * статус, оценка, привлекательность, свои колонки `custom:<id>`) складываются в текст пункта. Что вообще можно
 * отметить, определяется актуальной таблицей — убранные из неё столбцы не предлагаются.
 */
export type MemoField = string;
export type MemoConfig = { fields: MemoField[] };
/** Стандартные поля справки (подписи по умолчанию; в настройках подписи берутся из таблицы). */
export const MEMO_FIELDS: Array<{ key: MemoField; label: string }> = [
  { key: "segment", label: "Сегмент" },
  { key: "track", label: "Трек" },
  { key: "task", label: "Задача" },
  { key: "comment", label: "Комментарий" },
  { key: "owner", label: "Ответственный" },
  { key: "deadline", label: "Дедлайн" },
  { key: "status", label: "Статус" },
  { key: "cost", label: "Оценка $" },
  { key: "attractiveness", label: "Привлекательность" },
];
/** По умолчанию как в исходной справке: разделы по трекам + комментарий в пунктах (если комментария нет — название задачи). */
export const DEFAULT_MEMO_CONFIG: MemoConfig = { fields: ["track", "comment"] };

const FIELD_KEY = /^(segment|track|task|comment|owner|deadline|status|cost|attractiveness|custom:[\w-]{1,80})$/;

export function parseMemoConfig(value: unknown): MemoConfig {
  const v = value as Partial<MemoConfig> | null;
  const fields = Array.isArray(v?.fields) ? v!.fields.filter((f) => typeof f === "string" && FIELD_KEY.test(f)) : DEFAULT_MEMO_CONFIG.fields;
  return { fields: fields.length ? [...new Set(fields)] : DEFAULT_MEMO_CONFIG.fields };
}

export type ComposeInput = {
  title: string;
  comment: string | null;
  segmentName?: string | null;
  trackName?: string | null;
  ownerName?: string | null;
  deadline?: string | Date | null;
  statusName?: string | null;
  cost?: string | null;
  attractivenessName?: string | null;
  /** Значения своих колонок: { <id колонки>: значение }. */
  custom?: Record<string, string>;
};

const ruDay = (d: string | Date) => {
  const x = new Date(d);
  return `${String(x.getUTCDate()).padStart(2, "0")}.${String(x.getUTCMonth() + 1).padStart(2, "0")}.${x.getUTCFullYear()}`;
};

/**
 * Текст заготовки пункта из столбцов таблицы по настройке «вида справки»:
 * «Сегмент / Трек: Задача: Комментарий (Ответственный; срок 07.09.2026; Статус; оценка …; Своя колонка: значение)».
 * В текст попадает только отмеченное — ничего «на всякий случай» не дорисовывается: не отмечены ни задача, ни
 * комментарий — текста не будет вовсе (такой пункт в файл не пойдёт, см. `visibleSections`). Единственное
 * исключение — обещанное в настройках: отмечен «Комментарий», а он у строки пустой → берётся название задачи.
 * labels — подписи столбцов для своих колонок (ключ custom:<id>).
 */
export function composeText(item: ComposeInput, fields: MemoField[], labels: Record<string, string> = {}): string {
  const has = (f: MemoField) => fields.includes(f);
  const head = [has("segment") ? item.segmentName : null, has("track") ? item.trackName : null].filter(Boolean).join(" / ");
  const task = has("task") ? clean(item.title) : "";
  const comment = has("comment") ? clean(item.comment ?? "") || (task ? "" : clean(item.title)) : "";
  const body = [task, comment].filter(Boolean).join(": ");
  const custom = fields
    .filter((f) => f.startsWith("custom:"))
    .map((f) => {
      const v = item.custom?.[f.slice("custom:".length)];
      return v ? `${labels[f] ?? "поле"}: ${v}` : null;
    });
  const extras = [
    has("owner") ? item.ownerName : null,
    has("deadline") && item.deadline ? `срок ${ruDay(item.deadline)}` : null,
    has("status") ? item.statusName : null,
    has("cost") && item.cost ? `оценка ${item.cost}` : null,
    has("attractiveness") && item.attractivenessName ? `привлекательность ${item.attractivenessName}` : null,
    ...custom,
  ]
    .filter(Boolean)
    .join("; ");
  // «Сегмент / Трек: текст» — но если текста нет, двоеточие не висит; если нет и начала, дополнения идут сами по себе
  const lead = [head, body].filter(Boolean).join(": ");
  if (!lead) return extras;
  return extras ? `${lead} (${extras})` : lead;
}

/** Разделы справки: каждый трек — свой раздел, в порядке справочника. */
export function tracksToSections(tracks: Array<{ id: string; name: string }>): SectionDef[] {
  return tracks.map((t) => ({ id: `track:${t.id}`, title: t.name, trackIds: [t.id] }));
}

/** Разделы-подстраховка по сегменту: для строк без трека (или с треком не из структуры), у которых есть сегмент. */
export function segmentsToSections(segments: Array<{ id: string; name: string }>): SectionDef[] {
  return segments.map((s) => ({ id: `segment:${s.id}`, title: s.name, trackIds: [], segmentIds: [s.id] }));
}

export const OTHER_SECTION_ID = "other";
export const OTHER_SECTION_TITLE = "Прочие направления";

/** Небольшой стабильный хэш строки (для «источник изменился»; не криптографический). */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Заготовка пункта из строки. Если текст уже собран по «Виду справки» (`text` задан — так делает `loadSources`),
 * он и есть истина, даже когда пустой: снятые галочки должны убирать данные с листа, а не подменяться чем-то ещё.
 * Запасной вариант (комментарий, иначе название) — только когда собранного текста нет вовсе.
 */
export function sourceText(item: Pick<SourceItem, "title" | "comment" | "text">): string {
  if (item.text !== undefined) return item.text.trim();
  return clean(item.comment ?? "") || clean(item.title);
}

/**
 * «Сырое» содержание строки для отслеживания реальных изменений источника — только комментарий (а если пуст, название
 * задачи), без учёта `item.text` (готового текста по текущему «виду справки»). Смена отмеченных столбцов в «Виде
 * справки» не должна считаться изменением источника — это разные вещи, и раньше они были перепутаны в одном хэше.
 */
function rawSourceText(item: Pick<SourceItem, "title" | "comment">): string {
  return clean(item.comment ?? "") || clean(item.title);
}

const isEligible = (i: SourceItem) => i.operFlag && !i.archived;

/**
 * Почему источник пункта недоступен: строки не нашли в текущей выборке (`loadSources` не отдаёт архивные —
 * настоящего безвозвратного удаления в системе нет, «удалить» строку и означает «архивировать») или нашли,
 * но подача снята («Опер»/«Отправить»). Разные события — разный текст предупреждения в редакторе.
 */
function missingReason(item: SourceItem | undefined): false | "unsubmitted" | "archived" {
  if (!item || item.archived) return "archived";
  if (!item.operFlag) return "unsubmitted";
  return false;
}
const byCreated = (a: SourceItem, b: SourceItem) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();

let counter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function bulletFor(item: SourceItem): MemoBullet {
  return { id: newId("b"), text: sourceText(item), itemIds: [item.id], origin: "auto", edited: false, hidden: false, sourceHash: hashText(rawSourceText(item)) };
}

/**
 * Раздел строки: сначала по треку, если не нашёлся — по сегменту, иначе null («Прочие направления» —
 * только если у строки нет ни трека из структуры, ни сегмента).
 */
export function sectionOf(item: Pick<SourceItem, "trackId" | "segmentId">, defs: SectionDef[]): SectionDef | null {
  const byTrack = item.trackId && defs.find((d) => d.trackIds.includes(item.trackId!));
  if (byTrack) return byTrack;
  const bySegment = item.segmentId && defs.find((d) => d.segmentIds?.includes(item.segmentId!));
  return bySegment || null;
}

/**
 * Из трека/сегмента строки убирает тот, что и так стал жирным заголовком её раздела (см. `sectionOf`) — не
 * дублируем название раздела в тексте пункта. Второе (не совпавшее с заголовком) остаётся — это не дублирование,
 * а полезное уточнение (например, сегмент строки при разделе по треку).
 */
export function stripSectionHead(
  item: { trackId: string | null; segmentId?: string | null; trackName: string | null; segmentName: string | null },
  defs: SectionDef[]
): { trackName: string | null; segmentName: string | null } {
  const def = sectionOf(item, defs);
  if (def?.trackIds.includes(item.trackId ?? "")) return { trackName: null, segmentName: item.segmentName };
  if (def && item.segmentId && def.segmentIds?.includes(item.segmentId)) return { trackName: item.trackName, segmentName: null };
  return { trackName: item.trackName, segmentName: item.segmentName };
}

/**
 * Раздел под строку. Заглушка («Прочие направления») нужна, только когда структура вообще есть, но конкретная
 * строка в неё не попала. Если ни «Трек», ни «Сегмент» не отмечены — структуры нет, и заглушка остаётся без
 * названия: справка становится просто списком пунктов, без жирных заголовков (см. `catchAllTitle`).
 */
function emptySection(def: SectionDef | null, defs: SectionDef[]): MemoSectionDoc {
  return def
    ? { id: def.id, title: def.title, kind: "section", bullets: [] }
    : { id: OTHER_SECTION_ID, title: catchAllTitle(defs), kind: "other", bullets: [] };
}

const catchAllTitle = (defs: SectionDef[]) => (defs.length ? OTHER_SECTION_TITLE : "");

/** Порядок разделов документа: как в структуре, «Прочие» — последними. */
function orderSections(sections: MemoSectionDoc[], defs: SectionDef[]): MemoSectionDoc[] {
  const rank = (s: MemoSectionDoc) => (s.kind === "other" ? Number.MAX_SAFE_INTEGER : defs.findIndex((d) => d.id === s.id) === -1 ? Number.MAX_SAFE_INTEGER - 1 : defs.findIndex((d) => d.id === s.id));
  return [...sections].sort((a, b) => rank(a) - rank(b));
}

/** Черновик справки: поданные позиции раскладываются по разделам структуры, каждая — заготовка пункта. */
export function buildDraft(items: SourceItem[], defs: SectionDef[]): MemoDoc {
  const map = new Map<string, MemoSectionDoc>();
  for (const item of items.filter(isEligible).sort(byCreated)) {
    const def = sectionOf(item, defs);
    const key = def?.id ?? OTHER_SECTION_ID;
    if (!map.has(key)) map.set(key, emptySection(def, defs));
    map.get(key)!.bullets.push(bulletFor(item));
  }
  return { sections: orderSections([...map.values()], defs) };
}

/**
 * «Обновить из данных»: поданные позиции, которых ещё нет ни в одном пункте, добавляются новыми пунктами.
 * Существующие пункты (и отредактированные, и скрытые) не трогаются. Возвращает документ и число добавленных пунктов.
 */
export function refreshDraft(doc: MemoDoc, items: SourceItem[], defs: SectionDef[]): { doc: MemoDoc; added: number } {
  const used = new Set(doc.sections.flatMap((s) => s.bullets.flatMap((b) => b.itemIds)));
  const sections = doc.sections.map((s) => ({ ...s, bullets: [...s.bullets] }));
  let added = 0;
  for (const item of items.filter(isEligible).sort(byCreated)) {
    if (used.has(item.id)) continue;
    const def = sectionOf(item, defs);
    const key = def?.id ?? OTHER_SECTION_ID;
    let section = sections.find((s) => s.id === key);
    if (!section) {
      section = emptySection(def, defs);
      sections.push(section);
    }
    section.bullets.push(bulletFor(item));
    used.add(item.id);
    added++;
  }
  return { doc: { ...doc, sections: orderSections(sections, defs) }, added };
}

export type BulletFlags = {
  /** Источник (комментарий) изменился после того, как пункт был собран/принят. */
  sourceChanged: boolean;
  /** Почему источник недоступен (см. `missingReason`): false, если всё на месте. */
  sourceMissing: false | "unsubmitted" | "archived";
};

function combinedSource(itemIds: string[], byId: Map<string, SourceItem>): string {
  return itemIds.map((id) => byId.get(id)).filter((x): x is SourceItem => !!x).map(sourceText).join(" | ");
}

/** То же самое, но «сырым» содержанием — для отслеживания изменений источника (см. `rawSourceText`). */
function combinedRawSource(itemIds: string[], byId: Map<string, SourceItem>): string {
  return itemIds.map((id) => byId.get(id)).filter((x): x is SourceItem => !!x).map(rawSourceText).join(" | ");
}

/**
 * Свежие данные → документ: пункты, которые никто не правил и у которых один источник, обновляются сами (и по
 * данным, и по «виду справки» — эта часть не зависит от того, что именно изменилось); остальные помечаются
 * («источник изменился»), только если правда изменилось содержание строки (комментарий), а не «вид справки» —
 * текст директора не перезаписывается.
 */
export function syncWithSources(doc: MemoDoc, items: SourceItem[]): { doc: MemoDoc; flags: Map<string, BulletFlags>; autoUpdated: number } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const flags = new Map<string, BulletFlags>();
  let autoUpdated = 0;
  const sections = doc.sections.map((s) => ({
    ...s,
    bullets: s.bullets.map((b) => {
      if (b.origin === "manual" && b.itemIds.length === 0) return b;
      const current = b.itemIds.map((id) => byId.get(id));
      const sourceMissing = current.map(missingReason).find((r) => r !== false) ?? false;
      const rawNow = combinedRawSource(b.itemIds, byId);
      // пока строка-источник на месте, текст пункта полностью следует «Виду справки» — в том числе становится
      // пустым, если ничего текстового не отмечено. Снятая подача на это не влияет: такой пункт всё равно
      // уходит из файла (его скрывает `hideMissingSources`), но показывать устаревший текст незачем.
      if (!b.edited && b.itemIds.length === 1 && byId.has(b.itemIds[0])) {
        const composedNow = combinedSource(b.itemIds, byId);
        flags.set(b.id, { sourceChanged: false, sourceMissing });
        if (composedNow !== b.text) autoUpdated++;
        return { ...b, text: composedNow, sourceHash: hashText(rawNow) };
      }
      const changed = !!rawNow && hashText(rawNow) !== b.sourceHash;
      flags.set(b.id, { sourceChanged: changed, sourceMissing });
      return b;
    }),
  }));
  return { doc: { ...doc, sections }, flags, autoUpdated };
}

/**
 * В справку идут только поданные строки. Если строку после сборки сняли с подачи или отправили в архив, её пункт
 * сам уходит из файла — помечается скрытым (в редакторе он виден серым, с причиной, и вернуть его можно одной
 * кнопкой). Ничего не удаляем: текст, который мог написать директор, остаётся на месте.
 */
export function hideMissingSources(doc: MemoDoc, flags: Map<string, BulletFlags>): { doc: MemoDoc; hidden: number } {
  let hidden = 0;
  const sections = doc.sections.map((s) => ({
    ...s,
    bullets: s.bullets.map((b) => {
      if (b.hidden || b.pinned || !flags.get(b.id)?.sourceMissing) return b;
      hidden++;
      return { ...b, hidden: true };
    }),
  }));
  return { doc: hidden > 0 ? { ...doc, sections } : doc, hidden };
}

/** Раздел построен структурой (трек/сегмент), а не создан директором вручную через «Добавить раздел». */
const isStructuralId = (id: string) => id.startsWith("track:") || id.startsWith("segment:");

/**
 * Приводит уже собранный документ к текущей структуре («Вид справки» мог поменяться, у строки мог появиться трек):
 * пункт с одним источником встаёт в свой раздел по актуальной `sectionOf` — переезжает только место, текст не
 * трогается, поэтому правки директора в безопасности. Пункты из нескольких строк и написанные вручную остаются
 * там, куда их положили. Разделы по треку/сегменту, которых больше нет в структуре (сняли галочку, убрали трек),
 * расформировываются в заглушку — иначе на листе оставались бы осиротевшие жирные заголовки.
 */
export function resyncSections(doc: MemoDoc, items: SourceItem[], defs: SectionDef[]): { doc: MemoDoc; moved: number } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const known = new Set(defs.map((d) => d.id));
  const sections = doc.sections.map((s) => ({ ...s, bullets: [...s.bullets] }));
  const bySectionId = new Map(sections.map((s) => [s.id, s]));
  let moved = 0;

  const targetFor = (b: MemoBullet, from: MemoSectionDoc): MemoSectionDoc | null => {
    // «pinned» защищает пункт только от автоскрытия (см. hideMissingSources) — место в структуре он всё равно
    // должен занимать правильное, иначе строка с верным треком может навсегда застрять в «Прочих направлениях»
    const item = b.itemIds.length === 1 ? byId.get(b.itemIds[0]) : undefined;
    // пункт со строкой-источником живёт там, где велит структура; остальные — только если их раздел исчез
    const def = item ? sectionOf(item, defs) : null;
    const targetId = item ? def?.id ?? OTHER_SECTION_ID : isStructuralId(from.id) && !known.has(from.id) ? OTHER_SECTION_ID : from.id;
    if (targetId === from.id) return null;
    let target = bySectionId.get(targetId);
    if (!target) {
      target = emptySection(targetId === OTHER_SECTION_ID ? null : def, defs);
      bySectionId.set(targetId, target);
      sections.push(target);
    }
    return target;
  };

  for (const section of [...sections]) {
    section.bullets = section.bullets.filter((b) => {
      const target = targetFor(b, section);
      if (!target) return true;
      target.bullets.push(b);
      moved++;
      return false;
    });
  }
  // опустевшие разделы структуры, которых больше нет, и «Прочие» без пунктов на листе не нужны
  const kept = sections.filter((s) => s.bullets.length > 0 || (!isStructuralId(s.id) && s.id !== OTHER_SECTION_ID) || known.has(s.id));
  const normalized = kept.map((s) => (s.id === OTHER_SECTION_ID && s.title !== catchAllTitle(defs) ? { ...s, title: catchAllTitle(defs) } : s));
  const changed = moved > 0 || kept.length !== sections.length || normalized.some((s, i) => s !== kept[i]);
  return { doc: changed ? { ...doc, sections: orderSections(normalized, defs) } : doc, moved };
}

/** Принять новый источник: пометка «источник изменился» снимается (текст остаётся как есть). */
export function acceptSource(doc: MemoDoc, bulletId: string, items: SourceItem[]): MemoDoc {
  const byId = new Map(items.map((i) => [i.id, i]));
  return { ...doc, sections: doc.sections.map((s) => ({ ...s, bullets: s.bullets.map((b) => (b.id === bulletId ? { ...b, sourceHash: hashText(combinedRawSource(b.itemIds, byId)) } : b)) })) };
}

/** Объединить пункт `bId` в пункт `aId` того же раздела: тексты склеиваются, источники объединяются. */
export function mergeBullets(doc: MemoDoc, sectionId: string, aId: string, bId: string, items: SourceItem[]): MemoDoc {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    ...doc,
    sections: doc.sections.map((s) => {
      if (s.id !== sectionId) return s;
      const a = s.bullets.find((x) => x.id === aId);
      const b = s.bullets.find((x) => x.id === bId);
      if (!a || !b || a.id === b.id) return s;
      const itemIds = [...new Set([...a.itemIds, ...b.itemIds])];
      const merged: MemoBullet = {
        ...a,
        text: `${a.text.replace(/\s+$/, "")} ${b.text.trim()}`.trim(),
        itemIds,
        edited: true,
        hidden: a.hidden && b.hidden,
        sourceHash: hashText(combinedRawSource(itemIds, byId)),
      };
      return { ...s, bullets: s.bullets.filter((x) => x.id !== bId).map((x) => (x.id === aId ? merged : x)) };
    }),
  };
}

/** Новый пункт, написанный вручную (в раздел или из строки, которая не вошла в справку). */
export function manualBullet(text = "", itemIds: string[] = [], items: SourceItem[] = []): MemoBullet {
  const byId = new Map(items.map((i) => [i.id, i]));
  return { id: newId("b"), text, itemIds, origin: "manual", edited: true, hidden: false, sourceHash: hashText(combinedRawSource(itemIds, byId)) };
}

/** Строки, которые не вошли в справку: не податься или не попали ни в один пункт. */
export function notIncluded(doc: MemoDoc, items: SourceItem[]): SourceItem[] {
  const used = new Set(doc.sections.flatMap((s) => s.bullets.filter((b) => !b.hidden).flatMap((b) => b.itemIds)));
  return items.filter((i) => !i.archived && !used.has(i.id));
}

/** Разделы, видимые в файле: только те, где есть хотя бы один нескрытый пункт с текстом. */
export function visibleSections(doc: MemoDoc): MemoSectionDoc[] {
  return doc.sections
    .map((s) => ({ ...s, bullets: s.bullets.filter((b) => !b.hidden && b.text.trim()) }))
    .filter((s) => s.bullets.length > 0);
}

const ruDate = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

/** Заголовок справки по умолчанию: «Статус текущих задач по дирекции РФ и КЭ к ОС 14.09.2026». */
export function memoTitle(dir: { name: string; shortName?: string | null }, meetingDate: Date | string | null): string {
  const who = dir.shortName?.trim() ? `по дирекции ${dir.shortName.trim()}` : `— ${dir.name}`;
  const date = meetingDate ? ` к ОС ${ruDate(new Date(meetingDate))}` : "";
  return `Статус текущих задач ${who}${date}`;
}

/** Заголовок делится на название и дату совещания («… к ОС 14.09.2026» → «…» и «14.09.2026»): в справке дата пишется отдельной строкой справа, без «к ОС». */
export function splitTitleDate(title: string): { main: string; date: string } {
  const m = /^([\s\S]*?)[\s,;—–-]*к ОС (\d{2}\.\d{2}\.\d{4})\s*$/.exec(title.trim());
  return m ? { main: m[1].trim(), date: m[2] } : { main: title.trim(), date: "" };
}

/** Заголовок справки: то, что вписал директор, а если ничего не вписал — собирается сам (memoTitle). */
export function resolveTitle(doc: Pick<MemoDoc, "title">, dir: { name: string; shortName?: string | null }, meetingDate: Date | string | null): string {
  return doc.title?.trim() || memoTitle(dir, meetingDate);
}

/** Документ из неизвестного JSON (например, из базы): ненадёжное значение превращается в пустую справку. */
export function parseMemoDoc(value: unknown): MemoDoc | null {
  const v = value as MemoDoc | null;
  if (!v || !Array.isArray(v.sections)) return null;
  return {
    ...(typeof v.title === "string" && v.title.trim() ? { title: v.title } : {}),
    sections: v.sections.map((s) => ({
      id: String(s.id),
      title: String(s.title ?? ""),
      kind: s.kind === "other" ? "other" : "section",
      bullets: (Array.isArray(s.bullets) ? s.bullets : []).map((b) => ({
        id: String(b.id),
        text: String(b.text ?? ""),
        itemIds: Array.isArray(b.itemIds) ? b.itemIds.map(String) : [],
        origin: b.origin === "manual" ? "manual" : "auto",
        edited: !!b.edited,
        hidden: !!b.hidden,
        sourceHash: String(b.sourceHash ?? ""),
        ...(b.pinned ? { pinned: true } : {}),
      })),
    })),
  };
}

/**
 * Решение «в справку / не в справку» по строке (из таблицы или из левой колонки редактора).
 * Включить: если пункт со строкой уже есть — показать, если нет — добавить пунктом в раздел её трека.
 * Исключить: пункт с одной строкой скрывается (не возвращается при «Обновить из данных»); у объединённого пункта строка
 * просто убирается из источников, текст остаётся на усмотрение составителя.
 */
export function setIncluded(doc: MemoDoc, item: SourceItem, include: boolean, defs: SectionDef[], items: SourceItem[]): MemoDoc {
  const byId = new Map(items.map((i) => [i.id, i]));
  if (include) {
    const has = doc.sections.some((s) => s.bullets.some((b) => b.itemIds.includes(item.id)));
    if (has) return { ...doc, sections: doc.sections.map((s) => ({ ...s, bullets: s.bullets.map((b) => (b.itemIds.includes(item.id) ? { ...b, hidden: false } : b)) })) };
    const def = sectionOf(item, defs);
    const key = def?.id ?? OTHER_SECTION_ID;
    const sections = doc.sections.map((s) => ({ ...s, bullets: [...s.bullets] }));
    let target = sections.find((s) => s.id === key);
    if (!target) {
      target = emptySection(def, defs);
      sections.push(target);
    }
    // решение принято человеком: даже если строка не подана, автоматика её из справки не уберёт
    target.bullets.push({ ...bulletFor(item), pinned: true });
    return { ...doc, sections: orderSections(sections, defs) };
  }
  return {
    ...doc,
    sections: doc.sections.map((s) => ({
      ...s,
      bullets: s.bullets.map((b) => {
        if (!b.itemIds.includes(item.id)) return b;
        if (b.itemIds.length === 1) return { ...b, hidden: true };
        const itemIds = b.itemIds.filter((id) => id !== item.id);
        return { ...b, itemIds, sourceHash: hashText(combinedRawSource(itemIds, byId)) };
      }),
    })),
  };
}

/** Строки, по которым составитель ещё не принял решения (поданы, но их нет ни в одном пункте, даже скрытом). */
export function undecided(doc: MemoDoc, items: SourceItem[]): SourceItem[] {
  const known = new Set(doc.sections.flatMap((s) => s.bullets.flatMap((b) => b.itemIds)));
  return items.filter((i) => isEligible(i) && !known.has(i.id));
}

