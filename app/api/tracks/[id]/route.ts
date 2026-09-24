import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canManageTracks } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { trackSchema } from "@/lib/validation";
import { withApiErrors } from "@/lib/api-guard";

// Изменить название/сегмент трека или скрыть его (isActive=false).
async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFreshSession();
  if (!canManageTracks(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;

  const parsed = trackSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  if (!(await prisma.track.findFirst({ where: { id, directorateId: requireDirectorate(session) } }))) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (parsed.data.segmentId && !(await prisma.segment.findFirst({ where: { id: parsed.data.segmentId, directorateId: requireDirectorate(session) }, select: { id: true } }))) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const track = await prisma.track.update({ where: { id }, data: parsed.data });
  invalidateDicts();
  return NextResponse.json({ track });
}

// Удаление: трек без позиций удаляется совсем; если на него ссылаются позиции — скрывается (isActive=false),
// чтобы не потерять данные в этих позициях и их историю. Ответ говорит, что именно произошло.
async function DELETEHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFreshSession();
  if (!canManageTracks(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  if (!(await prisma.track.findFirst({ where: { id, directorateId: requireDirectorate(session) } }))) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const used = await prisma.operationalItem.count({ where: { trackId: id } });
  if (used === 0) {
    await prisma.track.delete({ where: { id } });
    invalidateDicts();
    return NextResponse.json({ ok: true, mode: "deleted" });
  }
  await prisma.track.update({ where: { id }, data: { isActive: false } });
  invalidateDicts();
  return NextResponse.json({ ok: true, mode: "hidden", used });
}

export const PATCH = withApiErrors(PATCHHandler);
export const DELETE = withApiErrors(DELETEHandler);
