import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canViewVersion } from "@/lib/memo-versions";
import { listDirectorates } from "@/lib/directorates";
import { parseMemoDoc } from "@/lib/memo";
import { withApiErrors } from "@/lib/api-guard";

// Одна отправленная версия справки целиком: текст, строки-источники, участие подачи, все ревизии этой оперативки.
async function GETHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const v = await prisma.memoVersion.findUnique({ where: { id }, include: { cycle: { select: { number: true, revision: true, status: true } } } });
  if (!v || !canViewVersion(actor, v)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const revisions = await prisma.memoVersion.findMany({ where: { cycleId: v.cycleId }, orderBy: { revision: "asc" }, select: { id: true, revision: true, sentAt: true, returnedAt: true, returnComment: true } });
  const names = new Map((await listDirectorates()).map((d) => [d.id, d.name]));
  return NextResponse.json({
    version: {
      id: v.id,
      cycleNumber: v.cycle.number,
      revision: v.revision,
      title: v.title,
      meetingDate: v.meetingDate,
      sentAt: v.sentAt,
      sentByName: v.sentByName,
      note: v.note,
      returnedAt: v.returnedAt,
      returnComment: v.returnComment,
      returnedByName: v.returnedByName,
      directorate: names.get(v.directorateId) ?? null,
      doc: parseMemoDoc(v.doc) ?? { sections: [] },
      sources: v.sources,
      participation: v.participation,
      // вернуть можно только последнюю ревизию зафиксированной оперативки
      canReturn: actor.role === "EXECUTIVE" && v.revision === v.cycle.revision && v.cycle.status === "FINAL" && !v.returnedAt,
    },
    revisions,
  });
}

export const GET = withApiErrors(GETHandler);
