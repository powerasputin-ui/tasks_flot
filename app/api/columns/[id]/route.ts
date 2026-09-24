import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canManageColumns } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { withApiErrors } from "@/lib/api-guard";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  options: z.array(z.string().trim().min(1)).max(50).optional(),
});

// Переименовать колонку или изменить варианты списка. Тип после создания не меняется.
async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!canManageColumns(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const existing = await prisma.customColumn.findFirst({ where: { id, directorateId: requireDirectorate(actor) } });
  if (!existing || !existing.isActive) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const column = await prisma.customColumn.update({
    where: { id },
    data: { name: parsed.data.name, ...(existing.type === "SELECT" && parsed.data.options?.length ? { options: parsed.data.options } : {}) },
  });
  invalidateDicts();
  return NextResponse.json({ column });
}

// «Удаление» скрывает колонку; значения в позициях и журнал не теряются.
async function DELETEHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!canManageColumns(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const existing = await prisma.customColumn.findFirst({ where: { id, directorateId: requireDirectorate(actor) } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  await prisma.customColumn.update({ where: { id }, data: { isActive: false } });
  invalidateDicts();
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiErrors(PATCHHandler);
export const DELETE = withApiErrors(DELETEHandler);
