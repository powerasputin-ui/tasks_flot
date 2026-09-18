import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canEditWeeklyUpdate } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";

/**
 * Раздел 20-21 ТЗ: DRAFT -> Submit -> SUBMITTED. Минимально обязательны
 * whatDone/currentState/nextSteps (risks и needManagerHelp могут быть пустыми).
 * После Submit запись не редактируется (раздел 20), поэтому canEditWeeklyUpdate
 * (которая уже требует status=DRAFT) используется как guard для самого перехода.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const existing = await prisma.weeklyUpdate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (!canEditWeeklyUpdate(session.role, session.userId, existing)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const missing: string[] = [];
  if (!existing.whatDone?.trim()) missing.push("whatDone");
  if (!existing.currentState?.trim()) missing.push("currentState");
  if (!existing.nextSteps?.trim()) missing.push("nextSteps");
  if (missing.length > 0) {
    return NextResponse.json({ error: "MISSING_REQUIRED_FIELDS", fields: missing }, { status: 400 });
  }

  const weeklyUpdate = await prisma.weeklyUpdate.update({
    where: { id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });

  await recordAudit({
    entityType: "WeeklyUpdate",
    entityId: id,
    actorId: session.userId,
    action: "WEEKLY_UPDATE_SUBMITTED",
  });

  return NextResponse.json({ weeklyUpdate });
}
