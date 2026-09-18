import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canAccessManagerViews } from "@/lib/permissions";
import { computeWeeklyDigestContent } from "@/lib/weekly-digest";
import { z } from "zod";

export async function GET() {
  const session = await requireSession();
  if (!canAccessManagerViews(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const weeklyDigests = await prisma.weeklyDigest.findMany({
    orderBy: { weekStart: "desc" },
    include: { generatedBy: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ weeklyDigests });
}

const generateSchema = z.object({
  weekStart: z.coerce.date(),
  weekEnd: z.coerce.date(),
});

/**
 * Раздел 23-25 ТЗ: генерация — явное действие Куратора/Руководителя
 * (canAccessManagerViews, раздел 37), содержимое считается детерминированно.
 * Повторная генерация той же недели перезаписывает content (weekStart уникален).
 */
export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!canAccessManagerViews(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const content = await computeWeeklyDigestContent(parsed.data.weekStart, parsed.data.weekEnd);

  const weeklyDigest = await prisma.weeklyDigest.upsert({
    where: { weekStart: parsed.data.weekStart },
    update: { content, generatedAt: new Date(), generatedById: session.userId },
    create: {
      weekStart: parsed.data.weekStart,
      weekEnd: parsed.data.weekEnd,
      content,
      generatedById: session.userId,
    },
  });

  return NextResponse.json({ weeklyDigest }, { status: 201 });
}
