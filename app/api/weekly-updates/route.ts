import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canCreateWeeklyUpdate } from "@/lib/permissions";
import { createWeeklyUpdateSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

export async function GET(request: NextRequest) {
  await requireSession();
  const { searchParams } = new URL(request.url);

  const trackId = searchParams.get("trackId") ?? undefined;
  const authorId = searchParams.get("authorId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;

  const weeklyUpdates = await prisma.weeklyUpdate.findMany({
    where: {
      ...(trackId ? { trackId } : {}),
      ...(authorId ? { authorId } : {}),
      ...(status ? { status: status as "DRAFT" | "SUBMITTED" } : {}),
    },
    include: {
      track: { select: { id: true, name: true } },
      author: { select: { id: true, name: true } },
    },
    orderBy: { weekStart: "desc" },
  });

  return NextResponse.json({ weeklyUpdates });
}

export async function POST(request: NextRequest) {
  const session = await requireSession();

  const body = await request.json().catch(() => null);
  const parsed = createWeeklyUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const track = await prisma.track.findUnique({ where: { id: parsed.data.trackId } });
  if (!track || track.archivedAt) {
    return NextResponse.json({ error: "TRACK_NOT_FOUND" }, { status: 400 });
  }

  if (!canCreateWeeklyUpdate(session.role, session.userId, track)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const weeklyUpdate = await prisma.weeklyUpdate.create({
    data: {
      trackId: parsed.data.trackId,
      authorId: session.userId,
      weekStart: parsed.data.weekStart,
      weekEnd: parsed.data.weekEnd,
      whatDone: parsed.data.whatDone,
      currentState: parsed.data.currentState,
      nextSteps: parsed.data.nextSteps,
      risks: parsed.data.risks,
      needManagerHelp: parsed.data.needManagerHelp ?? false,
    },
  });

  await recordAudit({
    entityType: "WeeklyUpdate",
    entityId: weeklyUpdate.id,
    actorId: session.userId,
    action: "WEEKLY_UPDATE_CREATED",
  });

  return NextResponse.json({ weeklyUpdate }, { status: 201 });
}
