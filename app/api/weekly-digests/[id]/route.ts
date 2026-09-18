import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canAccessManagerViews } from "@/lib/permissions";
import { z } from "zod";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!canAccessManagerViews(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const weeklyDigest = await prisma.weeklyDigest.findUnique({
    where: { id },
    include: { generatedBy: { select: { id: true, name: true } } },
  });
  if (!weeklyDigest) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({ weeklyDigest });
}

const patchSchema = z.object({ status: z.enum(["DRAFT", "FINAL"]) });

/**
 * Раздел 23: статус DRAFT/FINAL. Пометка FINAL — фиксирует версию, которую
 * видит Руководитель, как "окончательную" на эту неделю (раздел 24/89).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!canAccessManagerViews(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const existing = await prisma.weeklyDigest.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const weeklyDigest = await prisma.weeklyDigest.update({ where: { id }, data: { status: parsed.data.status } });
  return NextResponse.json({ weeklyDigest });
}
