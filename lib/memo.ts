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
};

export type MemoSectionDoc = {
  id: string;
  title: string;
  /** "other" — служебный раздел «Прочие направления» для строк без раздела. */
  kind: "section" | "other";
  bullets: MemoBullet[];
};

export type MemoDoc = { sections: MemoSectionDoc[] };

export type SourceItem = {
  id: string;
  title: string;
  comment: string | null;
  operFlag: boolean;
  archived: boolean;
  trackId: string | null;
  createdAt?: Date | string;
};

export type SectionDef = { id: string; title: string; trackIds: string[] };

export const OTHER_SECTION_ID = "other";
export const OTHER_SECTION_TITLE = "Прочие направления";

/** Небольшой стабильный хэш строки (для «источник изменился»; не криптографический). */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Заготовка пункта из строки: её комментарий, а если он пуст — название задачи. */
export function sourceText(item: Pick<SourceItem, "title" | "comment">): string {
  return clean(item.comment ?? "") || clean(item.title);
}

const isEligible = (i: SourceItem) => i.operFlag && !i.archived;
const byCreated = (a: SourceItem, b: SourceItem) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();

let counter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function bulletFor(item: SourceItem): MemoBullet {
  const t = sourceText(item);
  return { id: newId("b"), text: t, itemIds: [item.id], origin: "auto", edited: false, hidden: false, sourceHash: hashText(t) };
}

/** Раздел структуры, в который входит трек (или null — «Прочие направления»). */
function sectionOf(item: SourceItem, defs: SectionDef[]): SectionDef | null {
  if (!item.trackId) return null;
  return defs.find((d) => d.trackIds.includes(item.trackId!)) ?? null;
}

function emptySection(def: SectionDef | null): MemoSectionDoc {
  return def
    ? { id: def.id, title: def.title, kind: "section", bullets: [] }
    : { id: OTHER_SECTION_ID, title: OTHER_SECTION_TITLE, kind: "other", bullets: [] };
}

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
    if (!map.has(key)) map.set(key, emptySection(def));
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
      section = emptySection(def);
      sections.push(section);
    }
    section.bullets.push(bulletFor(item));
    used.add(item.id);
    added++;
  }
  return { doc: { sections: orderSections(sections, defs) }, added };
}

export type BulletFlags = {
  /** Источник (комментарий) изменился после того, как пункт был собран/принят. */
  sourceChanged: boolean;
  /** Одну из строк-источников сняли с подачи, архивировали или удалили. */
  sourceMissing: boolean;
};

function combinedSource(itemIds: string[], byId: Map<string, SourceItem>): string {
  return itemIds.map((id) => byId.get(id)).filter((x): x is SourceItem => !!x).map(sourceText).join(" | ");
}

/**
 * Свежие данные → документ: пункты, которые никто не правил и у которых один источник, обновляются сами;
 * остальные только помечаются («источник изменился»), текст директора не перезаписывается.
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
      const sourceMissing = current.some((i) => !i || !isEligible(i));
      const now = combinedSource(b.itemIds, byId);
      const changed = !!now && hashText(now) !== b.sourceHash;
      if (changed && !b.edited && b.itemIds.length === 1 && !sourceMissing) {
        autoUpdated++;
        flags.set(b.id, { sourceChanged: false, sourceMissing });
        return { ...b, text: now, sourceHash: hashText(now) };
      }
      flags.set(b.id, { sourceChanged: changed, sourceMissing });
      return b;
    }),
  }));
  return { doc: { sections }, flags, autoUpdated };
}

/** Принять новый источник: пометка «источник изменился» снимается (текст остаётся как есть). */
export function acceptSource(doc: MemoDoc, bulletId: string, items: SourceItem[]): MemoDoc {
  const byId = new Map(items.map((i) => [i.id, i]));
  return { sections: doc.sections.map((s) => ({ ...s, bullets: s.bullets.map((b) => (b.id === bulletId ? { ...b, sourceHash: hashText(combinedSource(b.itemIds, byId)) } : b)) })) };
}

/** Объединить пункт `bId` в пункт `aId` того же раздела: тексты склеиваются, источники объединяются. */
export function mergeBullets(doc: MemoDoc, sectionId: string, aId: string, bId: string, items: SourceItem[]): MemoDoc {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
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
        sourceHash: hashText(combinedSource(itemIds, byId)),
      };
      return { ...s, bullets: s.bullets.filter((x) => x.id !== bId).map((x) => (x.id === aId ? merged : x)) };
    }),
  };
}

/** Новый пункт, написанный вручную (в раздел или из строки, которая не вошла в справку). */
export function manualBullet(text = "", itemIds: string[] = [], items: SourceItem[] = []): MemoBullet {
  const byId = new Map(items.map((i) => [i.id, i]));
  return { id: newId("b"), text, itemIds, origin: "manual", edited: true, hidden: false, sourceHash: hashText(combinedSource(itemIds, byId)) };
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

/** Заголовок справки: «Статус текущих задач по дирекции РФ и КЭ к ОС 14.09.2026». */
export function memoTitle(dir: { name: string; shortName?: string | null }, meetingDate: Date | string | null): string {
  const who = dir.shortName?.trim() ? `по дирекции ${dir.shortName.trim()}` : `— ${dir.name}`;
  const date = meetingDate ? ` к ОС ${ruDate(new Date(meetingDate))}` : "";
  return `Статус текущих задач ${who}${date}`;
}

/** Документ из неизвестного JSON (например, из базы): ненадёжное значение превращается в пустую справку. */
export function parseMemoDoc(value: unknown): MemoDoc | null {
  const v = value as MemoDoc | null;
  if (!v || !Array.isArray(v.sections)) return null;
  return {
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
      })),
    })),
  };
}
