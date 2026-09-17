import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canUpdateWorkEntity, canArchiveWorkEntity } from "@/lib/permissions";
import { updateTaskSchema, operFlagSchema } from "@/lib/validation";
import { recordFieldChanges, recordAudit } from "@/lib/audit";
import { deadlineWeek } from "@/lib/deadline-week";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;

  const task = await prisma.task.findUnique({
    where: { id },
    include: { status: true, owner: { select: { id: true, name: true } }, track: true },
  });
  if (!task) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({ task: { ...task, deadlineWeek: deadlineWeek(task.deadline) } });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const body = await request.json().catch(() => null);

  if (body && typeof body === "object" && "operFlag" in body && Object.keys(body).length === 1) {
    const parsedOper = operFlagSchema.safeParse(body);
    if (!parsedOper.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    if (session.role !== "CURATOR") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

    const updated = await prisma.task.update({
      where: { id },
      data: { operFlag: parsedOper.data.operFlag, operSetById: session.userId, operSetAt: new Date() },
    });
    await recordAudit({
      entityType: "Task",
      entityId: id,
      actorId: session.userId,
      action: "OPER_FLAG_CHANGE",
      fieldName: "operFlag",
      before: String(existing.operFlag),
      after: String(updated.operFlag),
    });
    return NextResponse.json({ task: { ...updated, deadlineWeek: deadlineWeek(updated.deadline) } });
  }

  if (!canUpdateWorkEntity(session.role, session.userId, existing)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.task.update({ where: { id }, data: parsed.data });

  await recordFieldChanges({
    entityType: "Task",
    entityId: id,
    actorId: session.userId,
    before: existing,
    after: updated,
    trackedFields: ["statusId", "ownerId", "deadline", "title", "description", "comment"],
  });

  return NextResponse.json({ task: { ...updated, deadlineWeek: deadlineWeek(updated.deadline) } });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (!canArchiveWorkEntity(session.role, session.userId, existing)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const archived = await prisma.task.update({ where: { id }, data: { archivedAt: new Date() } });
  await recordAudit({ entityType: "Task", entityId: id, actorId: session.userId, action: "ARCHIVE" });

  return NextResponse.json({ task: archived });
}
