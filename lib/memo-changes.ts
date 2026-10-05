import type { MemoDoc } from "@/lib/memo";

export type MemoDiff = { changed: number; added: number; removed: number; hidden: number; shown: number; title: boolean; meeting: boolean };

const bulletsOf = (d: MemoDoc | null) => new Map((d?.sections ?? []).flatMap((s) => s.bullets.map((b) => [b.id, b] as const)));

/** Что поменялось в справке между двумя сохранениями. */
export function diffMemo(before: MemoDoc | null, after: MemoDoc): Omit<MemoDiff, "meeting"> {
  const old = bulletsOf(before);
  const now = bulletsOf(after);
  let changed = 0;
  let added = 0;
  let hidden = 0;
  let shown = 0;
  for (const [id, b] of now) {
    const o = old.get(id);
    if (!o) {
      added++;
      continue;
    }
    if (o.text !== b.text) changed++;
    if (!o.hidden && b.hidden) hidden++;
    if (o.hidden && !b.hidden) shown++;
  }
  const removed = [...old.keys()].filter((id) => !now.has(id)).length;
  return { changed, added, removed, hidden, shown, title: (before?.title ?? "") !== (after.title ?? "") };
}

export const isEmptyDiff = (d: MemoDiff) => !d.changed && !d.added && !d.removed && !d.hidden && !d.shown && !d.title && !d.meeting;

/**
 * Метки «кто и когда менял пункт» ставит только сервер: у новых и изменённых пунктов — текущий человек,
 * у остальных — метка из прежней версии (то, что прислал клиент, игнорируется, подделать нельзя).
 */
export function stampChanges(before: MemoDoc | null, after: MemoDoc, who: string, at: Date): MemoDoc {
  const old = bulletsOf(before);
  const iso = at.toISOString();
  return {
    ...after,
    sections: after.sections.map((s) => ({
      ...s,
      bullets: s.bullets.map((b) => {
        const { changedBy: _by, changedAt: _at, ...rest } = b;
        void _by;
        void _at;
        const o = old.get(b.id);
        const touched = !o || o.text !== b.text || o.hidden !== b.hidden;
        if (touched) return { ...rest, changedBy: who, changedAt: iso };
        return { ...rest, ...(o.changedBy ? { changedBy: o.changedBy } : {}), ...(o.changedAt ? { changedAt: o.changedAt } : {}) };
      }),
    })),
  };
}

/** «изменено 3, добавлено 1, скрыто 1» — для журнала и уведомления. */
export function describeDiff(d: MemoDiff): string {
  const parts = [
    d.changed && `изменено пунктов: ${d.changed}`,
    d.added && `добавлено: ${d.added}`,
    d.removed && `удалено: ${d.removed}`,
    d.hidden && `скрыто: ${d.hidden}`,
    d.shown && `возвращено: ${d.shown}`,
    d.title && "заголовок",
    d.meeting && "дата совещания",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "без изменений текста";
}
