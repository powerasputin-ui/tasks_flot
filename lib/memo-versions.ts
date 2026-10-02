import { Prisma, type Cycle } from "@prisma/client";
import { loadMemo, type MemoSource } from "@/lib/memo-load";
import { memoSearchText, type VersionSource } from "@/lib/memo-archive";
import { undecided } from "@/lib/memo";
import type { Actor } from "@/lib/permissions";
import { canSeeSent } from "@/lib/scope";

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
    /** Поданы, но в справке их нет ни в одном пункте (даже скрытом): директор их ещё не видел. */
    undecidedCount: undecided(state.doc, state.sources).length,
  };
}

/** Версию видят по единому правилу «кто видит отправленное» (lib/scope.ts). */
export function canViewVersion(actor: Actor, v: { directorateId: string }): boolean {
  return canSeeSent(actor, v.directorateId);
}
