import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canManageDirectory } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { inUse, renameSchema, sameName } from "@/lib/reference-edit";
import { withApiErrors } from "@/lib/api-guard";

// Сегмент своей дирекции: переименовать / удалить (только админ). Удаляется, только если нет позиций и треков с ним.
async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFreshSession();
  if (!canManageDirectory(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const parsed = renameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message }, { status: 400 });
  const directorateId = requireDirectorate(session);
  const segment = await prisma.segment.findFirst({ where: { id, directorateId } });
  if (!segment) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const others = await prisma.segment.findMany({ where: { directorateId, id: { not: id } }, select: { name: true } });
  if (others.some((o) => sameName(o.name, parsed.data.name))) return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });
  const updated = await prisma.segment.update({ where: { id }, data: { name: parsed.data.name } });
  invalidateDicts();
  return NextResponse.json({ segment: updated });
}

async function DELETEHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFreshSession();
  if (!canManageDirectory(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  if (!(await prisma.segment.findFirst({ where: { id, directorateId: requireDirectorate(session) } }))) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const items = await prisma.operationalItem.count({ where: { segmentId: id } });
  if (items > 0) return inUse(items, "сегмент");
  const tracks = await prisma.track.count({ where: { segmentId: id } });
  if (tracks > 0) {
    return NextResponse.json({ error: "IN_USE", count: tracks, message: `Нельзя удалить: к сегменту привязаны треки (${tracks}). Перенесите их в разделе «Треки».` }, { status: 409 });
  }
  await prisma.segment.delete({ where: { id } });
  invalidateDicts();
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiErrors(PATCHHandler);
export const DELETE = withApiErrors(DELETEHandler);
