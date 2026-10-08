import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canManageDirectory } from "@/lib/permissions";
import { inUse, PROTECTED_STATUSES, renameSchema, sameName } from "@/lib/reference-edit";
import { withApiErrors } from "@/lib/api-guard";

// Статус (общий для всех дирекций): переименовать / удалить (только админ).
// «Завершено» и «Не актуально» — системные: по ним считаются просрочки и напоминания.
async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFreshSession();
  if (!canManageDirectory(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const parsed = renameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message }, { status: 400 });
  const status = await prisma.status.findUnique({ where: { id } });
  if (!status) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (PROTECTED_STATUSES.includes(status.name)) return NextResponse.json({ error: "PROTECTED" }, { status: 409 });
  const others = await prisma.status.findMany({ where: { id: { not: id } }, select: { name: true } });
  if (others.some((o) => sameName(o.name, parsed.data.name))) return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });
  const updated = await prisma.status.update({ where: { id }, data: { name: parsed.data.name } });
  invalidateDicts();
  return NextResponse.json({ status: updated });
}

async function DELETEHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFreshSession();
  if (!canManageDirectory(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const status = await prisma.status.findUnique({ where: { id } });
  if (!status) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (PROTECTED_STATUSES.includes(status.name)) return NextResponse.json({ error: "PROTECTED" }, { status: 409 });
  const items = await prisma.operationalItem.count({ where: { statusId: id } });
  if (items > 0) return inUse(items, "статус");
  await prisma.status.delete({ where: { id } });
  invalidateDicts();
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiErrors(PATCHHandler);
export const DELETE = withApiErrors(DELETEHandler);
