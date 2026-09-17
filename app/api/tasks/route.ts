import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canCreateWorkEntity } from "@/lib/permissions";
import { createTaskSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";
import { deadlineWeek } from "@/lib/deadline-week";

export async function GET(request: NextRequest) {
  await requireSession();
  const { searchParams } = new URL(request.url);

  const trackId = searchParams.get("trackId") ?? undefined;
  const statusId = searchParams.get("statusId") ?? undefined;
  const ownerId = searchParams.get("ownerId") ?? undefined;

  const tasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      ...(trackId ? { trackId } : {}),
      ...(statusId ? { statusId } : {}),
      ...(ownerId ? { ownerId } : {}),
    },
    include: {
      status: true,
      owner: { select: { id: true, name: true } },
      track: { select: { id: true, name: true, segmentId: true } },
    },
    orderBy: { deadline: "asc" },
  });

  const withWeek = tasks.map((t) => ({ ...t, deadlineWeek: deadlineWeek(t.deadline) }));
  return NextResponse.json({ tasks: withWeek });
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!canCreateWorkEntity(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const track = await prisma.track.findUnique({ where: { id: parsed.data.trackId } });
  if (!track || track.archivedAt) {
    return NextResponse.json({ error: "TRACK_NOT_FOUND" }, { status: 400 });
  }

  const task = await prisma.task.create({ data: parsed.data });
  await recordAudit({ entityType: "Task", entityId: task.id, actorId: session.userId, action: "CREATE" });

  return NextResponse.json({ task: { ...task, deadlineWeek: deadlineWeek(task.deadline) } }, { status: 201 });
}
