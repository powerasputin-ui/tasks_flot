import { prisma } from "@/lib/prisma";
import { getDicts } from "@/lib/dictionaries";
import { directorateName } from "@/lib/directorates";
import { isDirectorial, type Actor } from "@/lib/permissions";
import { isInScope } from "@/lib/scope";
import { buildDraft, memoTitle, parseMemoDoc, syncWithSources, type BulletFlags, type MemoDoc, type SectionDef, type SourceItem } from "@/lib/memo";
import { Prisma, type Cycle } from "@prisma/client";

/** Что показываем директору про строку-источник пункта (карточка «источник»). */
export type MemoSource = SourceItem & {
  ownerName: string | null;
  deadline: string | null;
  statusName: string | null;
  trackName: string | null;
  segmentName: string | null;
};

export const MEMO_LIMITS = { sections: 60, bullets: 400, textLength: 6000, titleLength: 200 };

/** Справку ведут директор и админ (в своей дирекции), руководитель и ЗГД — нет. */
export function canEditMemo(actor: Actor, cycle: { directorateId: string | null }): boolean {
  return isDirectorial(actor.role) && isInScope(actor, cycle);
}

export async function loadSectionDefs(directorateId: string): Promise<SectionDef[]> {
  const sections = await prisma.memoSection.findMany({ where: { directorateId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { tracks: { select: { id: true }, orderBy: { sortOrder: "asc" } } } });
  return sections.map((s) => ({ id: s.id, title: s.title, trackIds: s.tracks.map((t) => t.id) }));
}

/** Все активные позиции дирекции (для сверки со справкой и списка «не вошло»). */
export async function loadSources(directorateId: string): Promise<MemoSource[]> {
  const [items, dicts] = await Promise.all([
    prisma.operationalItem.findMany({
      where: { directorateId, archivedAt: null },
      select: { id: true, title: true, comment: true, operFlag: true, trackId: true, segmentId: true, responsibleId: true, deadline: true, statusId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    getDicts(),
  ]);
  const statuses = await prisma.status.findMany({ select: { id: true, name: true } });
  const statusName = new Map(statuses.map((s) => [s.id, s.name]));
  return items.map((i) => ({
    id: i.id,
    title: i.title,
    comment: i.comment,
    operFlag: i.operFlag,
    archived: false,
    trackId: i.trackId,
    createdAt: i.createdAt,
    ownerName: i.responsibleId ? dicts.users.get(i.responsibleId)?.name ?? null : null,
    deadline: i.deadline ? i.deadline.toISOString() : null,
    statusName: i.statusId ? statusName.get(i.statusId) ?? null : null,
    trackName: i.trackId ? dicts.tracks.get(i.trackId)?.name ?? null : null,
    segmentName: i.segmentId ? dicts.segments.get(i.segmentId)?.name ?? null : null,
  }));
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
  const [defs, sources] = await Promise.all([loadSectionDefs(directorateId), loadSources(directorateId)]);
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
  if (synced.autoUpdated > 0 && editable) {
    const r = await prisma.cycle.updateMany({ where: { id: cycle.id, memoVersion: version }, data: { memoDraft: synced.doc as unknown as Prisma.InputJsonValue, memoVersion: { increment: 1 } } });
    if (r.count === 1) version += 1;
  }
  const dir = { name: (await directorateName(cycle.directorateId)) ?? "", shortName: (await prisma.directorate.findUnique({ where: { id: directorateId }, select: { shortName: true } }))?.shortName };
  return { cycle, doc: synced.doc, version, flags: Object.fromEntries(synced.flags), sources, title: memoTitle(dir, cycle.meetingDate), defs };
}
