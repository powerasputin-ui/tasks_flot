import { Prisma, type Cycle } from "@prisma/client";
import { loadMemo, type MemoSource } from "@/lib/memo-load";
import { memoSearchText, type VersionSource } from "@/lib/memo-archive";
import type { Actor } from "@/lib/permissions";
import { canCompileMemo } from "@/lib/permissions";

/** Компактный снимок строк-источников, попавших в пункты (для карточки «источник» в архиве). */
export function toVersionSources(sources: MemoSource[], usedIds: Set<string>): VersionSource[] {
  return sources
    .filter((s) => usedIds.has(s.id))
    .map((s) => ({ id: s.id, title: s.title, comment: s.comment, ownerName: s.ownerName, statusName: s.statusName, deadline: s.deadline, trackName: s.trackName, segmentName: s.segmentName }));
}

/** Данные для новой версии справки: считаются ДО транзакции, записываются вместе с закрытием цикла. */
export async function prepareVersion(cycle: Cycle, actor: { id: string; name: string }, note: string | null, participation: unknown) {
  const state = await loadMemo(cycle);
  const used = new Set(state.doc.sections.flatMap((s) => s.bullets.filter((b) => !b.hidden).flatMap((b) => b.itemIds)));
  const sources = toVersionSources(state.sources, used);
  return {
    cycleId: cycle.id,
    directorateId: cycle.directorateId ?? "",
    revision: cycle.revision,
    title: state.title,
    meetingDate: cycle.meetingDate,
    doc: state.doc as unknown as Prisma.InputJsonValue,
    sources: sources as unknown as Prisma.InputJsonValue,
    participation: participation as unknown as Prisma.InputJsonValue,
    note,
    searchText: memoSearchText(state.title, state.doc, sources),
    sentById: actor.id,
    sentByName: actor.name,
    sourceItemIds: [...used],
  };
}

/** Версию видят ЗГД (всех дирекций) и составители/директор/админ своей дирекции. */
export function canViewVersion(actor: Actor, v: { directorateId: string }): boolean {
  if (actor.role === "EXECUTIVE") return true;
  return canCompileMemo(actor) && !!actor.directorateId && v.directorateId === actor.directorateId;
}
