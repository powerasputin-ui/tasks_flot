import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canEditReference, inUse, renameSchema, sameName, visibleTo } from "@/lib/reference-edit";
import { attractivenessText } from "@/lib/attractiveness";
import { withApiErrors } from "@/lib/api-guard";

// Значение шкалы «Внимание»: переименовать / удалить. Общее (для всех дирекций) — админ; своё значение дирекции —
// директор или админ в этой дирекции. Новое название показывается как есть; место в шкале при сортировке сохраняется.
async function load(id: string) {
  const session = await requireFreshSession();
  const value = await prisma.attractiveness.findUnique({ where: { id } });
  if (!value || (value.directorateId && value.directorateId !== session.directorateId)) return { error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  if (!canEditReference(session, value)) return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  return { value };
}

async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = renameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message }, { status: 400 });
  const found = await load(id);
  if (found.error) return found.error;
  const others = await prisma.attractiveness.findMany({ where: { id: { not: id }, ...(found.value.directorateId ? visibleTo(found.value.directorateId) : {}) }, select: { name: true } });
  if (others.some((o) => sameName(o.name, parsed.data.name) || sameName(attractivenessText(o.name), parsed.data.name))) {
    return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });
  }
  const updated = await prisma.attractiveness.update({ where: { id }, data: { name: parsed.data.name } });
  invalidateDicts();
  return NextResponse.json({ attractiveness: updated });
}

async function DELETEHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await load(id);
  if (found.error) return found.error;
  const items = await prisma.operationalItem.count({ where: { attractivenessId: id } });
  if (items > 0) return inUse(items, "это значение");
  await prisma.attractiveness.delete({ where: { id } });
  invalidateDicts();
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiErrors(PATCHHandler);
export const DELETE = withApiErrors(DELETEHandler);
