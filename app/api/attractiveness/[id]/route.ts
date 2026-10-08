import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canManageDirectory } from "@/lib/permissions";
import { inUse, renameSchema, sameName } from "@/lib/reference-edit";
import { attractivenessText } from "@/lib/attractiveness";
import { withApiErrors } from "@/lib/api-guard";

// Значение шкалы привлекательности (общее для всех дирекций): переименовать / удалить (только админ).
// Новое название показывается как есть; место в шкале при сортировке сохраняется (lib/attractiveness: attractivenessRank).
async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFreshSession();
  if (!canManageDirectory(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const parsed = renameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message }, { status: 400 });
  const value = await prisma.attractiveness.findUnique({ where: { id } });
  if (!value) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const others = await prisma.attractiveness.findMany({ where: { id: { not: id } }, select: { name: true } });
  if (others.some((o) => sameName(o.name, parsed.data.name) || sameName(attractivenessText(o.name), parsed.data.name))) {
    return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });
  }
  const updated = await prisma.attractiveness.update({ where: { id }, data: { name: parsed.data.name } });
  invalidateDicts();
  return NextResponse.json({ attractiveness: updated });
}

async function DELETEHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFreshSession();
  if (!canManageDirectory(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  if (!(await prisma.attractiveness.findUnique({ where: { id } }))) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const items = await prisma.operationalItem.count({ where: { attractivenessId: id } });
  if (items > 0) return inUse(items, "это значение");
  await prisma.attractiveness.delete({ where: { id } });
  invalidateDicts();
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiErrors(PATCHHandler);
export const DELETE = withApiErrors(DELETEHandler);
