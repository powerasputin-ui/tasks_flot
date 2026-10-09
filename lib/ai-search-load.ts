import { prisma } from "@/lib/prisma";
import { canViewVersion } from "@/lib/memo-versions";
import { listDirectorates } from "@/lib/directorates";
import { parseMemoDoc, splitTitleDate, type MemoDoc } from "@/lib/memo";
import { effectiveDate } from "@/lib/memo-archive";
import { canViewItems, type Actor } from "@/lib/permissions";
import { loadTableRows, searchHaystack } from "@/lib/table-view";
import { searchAll, type SearchItem, type SearchMemo } from "@/lib/ai-search";
import { normalizeText } from "@/lib/search";

/** Сколько последних справок просматривает поиск ИИ (архив растёт — старые хуже помогают, а читать их дорого). */
const MEMO_DEPTH = 80;

/**
 * Где ищет помощник этого человека — с теми же правами, что в интерфейсе:
 * таблица своей дирекции вместе с удалёнными позициями (только тем, кому таблица доступна — не ЗГД),
 * отправленные справки, которые человек может открыть в архиве, и (для «Оперативщика») текущий черновик.
 */
export async function aiSearch(actor: Actor, question: string, opts: { draft?: { title: string; doc: MemoDoc }; limit?: number } = {}) {
  const tableOk = canViewItems(actor.role) && !!actor.directorateId;
  const [rows, versions, dirs] = await Promise.all([
    tableOk ? loadTableRows("all", actor.directorateId!) : Promise.resolve([]),
    prisma.memoVersion.findMany({
      orderBy: { sentAt: "desc" },
      take: MEMO_DEPTH * 3,
      select: { id: true, directorateId: true, title: true, meetingDate: true, sentAt: true, doc: true },
    }),
    listDirectorates(),
  ]);
  const names = new Map(dirs.map((d) => [d.id, d.name]));
  const items: SearchItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    comment: r.comment,
    trackName: r.trackName,
    segmentName: r.segmentName,
    ownerName: r.ownerName,
    statusName: r.statusName,
    deadline: r.deadline,
    cost: r.cost,
    archived: r.archived,
    files: r.files.map((f) => ({ name: f.name, path: f.path })),
    // названия прикреплённых файлов тоже ищутся: «найди презентацию …»
    haystack: `${searchHaystack(r)}${r.files.length ? ` ${normalizeText(r.files.map((f) => f.name).join(" "))}` : ""}${r.archived ? " удалена" : ""}`,
  }));
  const memos: SearchMemo[] = [];
  if (opts.draft) memos.push({ id: "draft", directorate: "", title: opts.draft.title, date: "", doc: opts.draft.doc, draft: true });
  for (const v of versions) {
    if (!canViewVersion(actor, v)) continue;
    const doc = parseMemoDoc(v.doc);
    if (!doc) continue;
    memos.push({ id: v.id, directorate: names.get(v.directorateId) ?? "", title: v.title, date: v.meetingDate ? effectiveDate(v).toLocaleDateString("ru-RU") : splitTitleDate(v.title).date || effectiveDate(v).toLocaleDateString("ru-RU"), doc });
    if (memos.length >= MEMO_DEPTH) break;
  }
  const found = searchAll(question, items, memos, opts.limit ?? 12);
  const scope = [tableOk ? "таблица дирекции, включая удалённые позиции" : null, "отправленные справки", opts.draft ? "текущий черновик" : null].filter(Boolean).join(", ");
  return { ...found, scope };
}

