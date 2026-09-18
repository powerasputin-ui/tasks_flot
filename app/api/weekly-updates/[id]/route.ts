import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canEditWeeklyUpdate } from "@/lib/permissions";
import { updateWeeklyUpdateSchema } from "@/lib/validation";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;

  const weeklyUpdate = await prisma.weeklyUpdate.findUnique({
    where: { id },
    include: { track: true, author: { select: { id: true, name: true } } },
  });
  if (!weeklyUpdate) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({ weeklyUpdate });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const existing = await prisma.weeklyUpdate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (!canEditWeeklyUpdate(session.role, session.userId, existing)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateWeeklyUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const weeklyUpdate = await prisma.weeklyUpdate.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ weeklyUpdate });
}
