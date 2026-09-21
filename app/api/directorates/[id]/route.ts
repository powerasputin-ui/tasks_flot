import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canCreateDirectorates } from "@/lib/permissions";
import { invalidateDirectorates } from "@/lib/directorates";

const patchSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), isActive: z.boolean().optional() });

// Переименовать или отключить дирекцию (данные не удаляются; отключённая пропадает из выбора).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFreshSession();
  if (!canCreateDirectorates(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  if (!(await prisma.directorate.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (parsed.data.name && (await prisma.directorate.findFirst({ where: { name: parsed.data.name, id: { not: id } } }))) return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });
  // нельзя отключить последнюю активную дирекцию: работать станет негде
  if (parsed.data.isActive === false && (await prisma.directorate.count({ where: { isActive: true, id: { not: id } } })) === 0) return NextResponse.json({ error: "LAST_DIRECTORATE" }, { status: 409 });
  const directorate = await prisma.directorate.update({ where: { id }, data: parsed.data, select: { id: true, name: true, isActive: true } });
  invalidateDirectorates();
  return NextResponse.json({ directorate });
}
