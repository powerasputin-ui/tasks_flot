import { prisma } from "@/lib/prisma";
import { getDicts } from "@/lib/dictionaries";
import { directorateName } from "@/lib/directorates";
import { canCompileMemo, type Actor } from "@/lib/permissions";
import { isInScope } from "@/lib/scope";
import { buildDraft, composeText, hideMissingSources, parseMemoConfig, resolveTitle, parseMemoDoc, resyncSections, segmentsToSections, stripSectionHead, syncWithSources, tracksToSections, type BulletFlags, type MemoConfig, type MemoDoc, type SectionDef, type SourceItem } from "@/lib/memo";
import { Prisma, type Cycle } from "@prisma/client";
import { DEFAULT_COLUMNS, normalizeColumns, withCustomColumns, type ColumnConfig, type CustomCol } from "@/lib/table-columns";

/** Что показываем директору про строку-источник пункта (карточка «источник»). */
export type MemoSource = SourceItem & {
  ownerName: string | null;
  deadline: string | null;
  statusName: string | null;
  trackName: string | null;
  segmentName: string | null;
  cost?: string | null;
  attractivenessName?: string | null;
  custom?: Record<string, string>;
};

export const MEMO_LIMITS = { sections: 60, bullets: 400, textLength: 6000, titleLength: 200 };

/** Справку ведут директор, админ и назначенные админом составители (в своей дирекции); остальные руководители и ЗГД — нет. */
export function canEditMemo(actor: Actor, cycle: { directorateId: string | null }): boolean {
  return canCompileMemo(actor) && isInScope(actor, cycle);
}

/** Столбцы таблицы, которые можно включить в текст пункта: те, что сейчас есть в таблице (убранные и скрытые не предлагаются), в порядке таблицы. */
const COLUMN_TO_FIELD: Record<string, string> = { track: "track", name: "task", comment: "comment", owner: "owner", deadline: "deadline", status: "status", cost: "cost", attractiveness: "attractiveness" };
export async function loadFieldOptions(directorateId: string): Promise<Array<{ key: string; label: string }>> {
  const [setting, custom] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: `table.columns:${directorateId}` } }),
    prisma.customColumn.findMany({ where: { directorateId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
  ]);
  const saved = Array.isArray(setting?.value) ? (setting!.value as unknown as ColumnConfig[]) : DEFAULT_COLUMNS;
  const customCols: CustomCol[] = custom.map((c) => ({ id: c.id, name: c.name, type: c.type, options: c.options }));
  const cols = withCustomColumns(normalizeColumns(saved.map((c) => ({ ...c }))), customCols).filter((c) => c.visible && !c.removed);
  const options = cols
    .map((c) => ({ key: c.key.startsWith("custom:") ? c.key : COLUMN_TO_FIELD[c.key] ?? "", label: c.label }))
    .filter((o) => o.key);
  // сегмента нет в столбцах таблицы (он слева списком), но в тексте пункта он нужен как в образце
  return [{ key: "segment", label: "Сегмент" }, ...options];
}

export async function loadMemoConfig(directorateId: string): Promise<MemoConfig> {
  const d = await prisma.directorate.findUnique({ where: { id: directorateId }, select: { memoConfig: true } });
  return parseMemoConfig(d?.memoConfig);
}

/**
 * Разделы справки собираются по «Виду справки»: отмечен «Трек» — в структуру идут треки («1. …», «2. …» в порядке
 * справочника), отмечен «Сегмент» — сегменты. Строка сначала ищет раздел по треку, потом по сегменту (см. `sectionOf`);
 * не нашла — «Прочие направления». Не отмечено ни то, ни другое — структуры нет: справка будет списком пунктов.
 */
export async function loadSectionDefs(directorateId: string, cfg?: MemoConfig): Promise<SectionDef[]> {
  const config = cfg ?? (await loadMemoConfig(directorateId));
  const byTrack = config.fields.includes("track");
  const bySegment = config.fields.includes("segment");
  const [tracks, segments] = await Promise.all([
    byTrack
      ? prisma.track.findMany({ where: { directorateId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } })
      : Promise.resolve([]),
    bySegment
      ? prisma.segment.findMany({ where: { directorateId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  return [...tracksToSections(tracks), ...segmentsToSections(segments)];
}

/** Все активные позиции дирекции (для сверки со справкой и списка «не вошло»). */
export async function loadSources(directorateId: string, cfg?: MemoConfig, defs?: SectionDef[]): Promise<MemoSource[]> {
  const [config, sectionDefs, customLabels, items, dicts] = await Promise.all([
    cfg ? Promise.resolve(cfg) : loadMemoConfig(directorateId),
    defs ? Promise.resolve(defs) : loadSectionDefs(directorateId, cfg),
    getDicts().then((d) => Object.fromEntries(d.customColumns.filter((c) => c.directorateId === directorateId).map((c) => [`custom:${c.id}`, c.name] as const))),
    prisma.operationalItem.findMany({
      where: { directorateId, archivedAt: null },
      select: { id: true, title: true, comment: true, operFlag: true, trackId: true, segmentId: true, responsibleId: true, deadline: true, statusId: true, createdAt: true, cost: true, attractivenessId: true, customValues: true },
      orderBy: { createdAt: "asc" },
    }),
    getDicts(),
  ]);
  const statuses = await prisma.status.findMany({ select: { id: true, name: true } });
  const statusName = new Map(statuses.map((s) => [s.id, s.name]));
  return items.map((i) => {
    const ownerName = i.responsibleId ? dicts.users.get(i.responsibleId)?.name ?? null : null;
    const deadline = i.deadline ? i.deadline.toISOString() : null;
    const status = i.statusId ? statusName.get(i.statusId) ?? null : null;
    const trackName = i.trackId ? dicts.tracks.get(i.trackId)?.name ?? null : null;
    const segmentName = i.segmentId ? dicts.segments.get(i.segmentId)?.name ?? null : null;
    const attractivenessName = i.attractivenessId ? dicts.attractiveness.get(i.attractivenessId)?.name ?? null : null;
    const custom = (i.customValues ?? {}) as Record<string, string>;
    // трек/сегмент, ставший заголовком раздела строки, не повторяем в тексте пункта — см. stripSectionHead
    const head = stripSectionHead({ trackId: i.trackId, segmentId: i.segmentId, trackName, segmentName }, sectionDefs);
    return {
      id: i.id,
      title: i.title,
      comment: i.comment,
      operFlag: i.operFlag,
      archived: false,
      trackId: i.trackId,
      segmentId: i.segmentId,
      createdAt: i.createdAt,
      ownerName,
      deadline,
      statusName: status,
      trackName,
      segmentName,
      cost: i.cost,
      attractivenessName,
      custom,
      text: composeText({ title: i.title, comment: i.comment, segmentName: head.segmentName, trackName: head.trackName, ownerName, deadline, statusName: status, cost: i.cost, attractivenessName, custom }, config.fields, customLabels),
    };
  });
}

export type MemoState = {
  cycle: Cycle;
  doc: MemoDoc;
  version: number;
  flags: Record<string, BulletFlags>;
  sources: MemoSource[];
  title: string;
  defs: SectionDef[];
};

/**
 * Черновик справки цикла: если его ещё нет — собирается из поданных позиций и сохраняется; неправленные пункты
 * подтягивают свежий комментарий сами, остальные только помечаются (см. lib/memo.ts).
 */
export async function loadMemo(cycle: Cycle): Promise<MemoState> {
  const directorateId = cycle.directorateId ?? "";
  // структура разделов зависит от «Вида справки», поэтому сначала конфиг, потом разделы и строки по ним
  const cfg = await loadMemoConfig(directorateId);
  const defs = await loadSectionDefs(directorateId, cfg);
  const sources = await loadSources(directorateId, cfg, defs);
  let doc = parseMemoDoc(cycle.memoDraft);
  let version = cycle.memoVersion;

  const editable = cycle.status !== "FINAL";
  if (!doc) {
    doc = buildDraft(sources, defs);
    if (editable) {
      const saved = await prisma.cycle.updateMany({ where: { id: cycle.id, memoDraft: { equals: Prisma.DbNull } }, data: { memoDraft: doc as unknown as Prisma.InputJsonValue, memoVersion: { increment: 1 } } });
      if (saved.count === 1) version += 1;
    }
  }
  const synced = syncWithSources(doc, sources);
  const resynced = resyncSections(synced.doc, sources, defs);
  // у зафиксированной справки подачу уже сбросили при отправке ЗГД — там прятать нечего, смотрим как есть
  const veiled = editable ? hideMissingSources(resynced.doc, synced.flags) : { doc: resynced.doc, hidden: 0 };
  const finalDoc = veiled.doc;
  if ((synced.autoUpdated > 0 || resynced.moved > 0 || veiled.hidden > 0) && editable) {
    const r = await prisma.cycle.updateMany({ where: { id: cycle.id, memoVersion: version }, data: { memoDraft: finalDoc as unknown as Prisma.InputJsonValue, memoVersion: { increment: 1 } } });
    if (r.count === 1) version += 1;
  }
  const dir = { name: (await directorateName(cycle.directorateId)) ?? "", shortName: (await prisma.directorate.findUnique({ where: { id: directorateId }, select: { shortName: true } }))?.shortName };
  return { cycle, doc: finalDoc, version, flags: Object.fromEntries(synced.flags), sources, title: resolveTitle(finalDoc, dir, cycle.meetingDate), defs };
}
