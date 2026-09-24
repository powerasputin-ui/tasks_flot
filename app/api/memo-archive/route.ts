import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canCompileMemo } from "@/lib/permissions";
import { listDirectorates } from "@/lib/directorates";
import { effectiveDate, matchBullets, versionMatches, type VersionSource } from "@/lib/memo-archive";
import { parseMemoDoc, visibleSections } from "@/lib/memo";
import { withApiErrors } from "@/lib/api-guard";

/**
 * Архив отправленных справок: по одной строке на оперативку (последняя ревизия), с поиском по тексту и фильтром по датам.
 * ЗГД видит справки всех дирекций, составители, директор и админ — своей дирекции.
 * ?q= слова для поиска · ?from=YYYY-MM-DD & ?to=YYYY-MM-DD — по дате совещания (если её нет — по дате отправки).
 */
async function GETHandler(request: NextRequest) {
  const actor = await requireActor();
  const executive = actor.role === "EXECUTIVE";
  if (!executive && !canCompileMemo(actor)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") ?? "").slice(0, 200);
  const from = sp.get("from") ? new Date(sp.get("from")!) : null;
  const to = sp.get("to") ? new Date(`${sp.get("to")}T23:59:59.999Z`) : null;

  const versions = await prisma.memoVersion.findMany({
    where: executive ? {} : { directorateId: actor.directorateId ?? "" },
    orderBy: [{ sentAt: "desc" }],
    select: { id: true, cycleId: true, directorateId: true, revision: true, title: true, meetingDate: true, sentAt: true, sentByName: true, returnedAt: true, returnComment: true, searchText: true, doc: true, sources: true, cycle: { select: { number: true } } },
  });
  const names = new Map((await listDirectorates()).map((d) => [d.id, d.name]));

  // по одной (последней) ревизии на оперативку; число ревизий — для метки «ред. 2»
  const latest = new Map<string, (typeof versions)[number]>();
  const counts = new Map<string, number>();
  for (const v of versions) {
    counts.set(v.cycleId, (counts.get(v.cycleId) ?? 0) + 1);
    const cur = latest.get(v.cycleId);
    if (!cur || v.revision > cur.revision) latest.set(v.cycleId, v);
  }

  const rows = [...latest.values()]
    .filter((v) => {
      const d = effectiveDate(v);
      return (!from || d >= from) && (!to || d <= to) && versionMatches(v.searchText, q);
    })
    .sort((a, b) => effectiveDate(b).getTime() - effectiveDate(a).getTime())
    .map((v) => {
      const doc = parseMemoDoc(v.doc);
      return {
        id: v.id,
        cycleNumber: v.cycle.number,
        revision: v.revision,
        revisions: counts.get(v.cycleId) ?? 1,
        title: v.title,
        meetingDate: v.meetingDate,
        sentAt: v.sentAt,
        sentByName: v.sentByName,
        returned: !!v.returnedAt,
        returnComment: v.returnComment,
        directorate: names.get(v.directorateId) ?? null,
        bullets: doc ? visibleSections(doc).reduce((n, s) => n + s.bullets.length, 0) : 0,
        matches: q && doc ? matchBullets(doc, v.sources as unknown as VersionSource[], q) : [],
      };
    });
  return NextResponse.json({ versions: rows });
}

export const GET = withApiErrors(GETHandler);
