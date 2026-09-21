import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canCreateDirectorates } from "@/lib/permissions";
import { invalidateDirectorates, listDirectorates } from "@/lib/directorates";

// Список дирекций: админу — все (в том числе отключённые), остальным — их собственная.
export async function GET() {
  const session = await requireFreshSession();
  const all = await listDirectorates();
  if (canCreateDirectorates(session.role)) return NextResponse.json({ directorates: all, current: session.directorateId });
  return NextResponse.json({ directorates: all.filter((d) => d.id === session.directorateId), current: session.directorateId });
}

const createSchema = z.object({ name: z.string().trim().min(2).max(120) });

// Дирекции заводит админ. Внутри новой дирекции пока пусто: сегменты, треки, людей добавляют директор и админ.
export async function POST(request: NextRequest) {
  const session = await requireFreshSession();
  if (!canCreateDirectorates(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  if (await prisma.directorate.findUnique({ where: { name: parsed.data.name } })) return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });
  const directorate = await prisma.directorate.create({ data: { name: parsed.data.name }, select: { id: true, name: true, isActive: true } });
  invalidateDirectorates();
  return NextResponse.json({ directorate }, { status: 201 });
}
