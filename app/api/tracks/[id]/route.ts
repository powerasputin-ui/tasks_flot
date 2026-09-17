import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canUpdateWorkEntity, canArchiveWorkEntity, canManageOwnership } from "@/lib/permissions";
import { updateTrackSchema, operFlagSchema, ownerIdSchema } from "@/lib/validation";
import { recordFieldChanges, recordAudit } from "@/lib/audit";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;

  const track = await prisma.track.findUnique({
    where: { id },
    include: {
      segment: true,
      status: true,
      attractiveness: true,
      owner: { select: { id: true, name: true } },
      operSetBy: { select: { id: true, name: true } },
      tasks: {
        where: { archivedAt: null },
        include: { status: true, owner: { select: { id: true, name: true } } },
        orderBy: { deadline: "asc" },
      },
      vesselOptions: {
        where: { archivedAt: null },
        include: { status: true, attractiveness: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!track) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ track });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const existing = await prisma.track.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const body = await request.json().catch(() => null);

  // Отдельная операция смены operFlag — она доступна Куратору, не Ответственному (раздел 17/36).
  if (body && typeof body === "object" && "operFlag" in body && Object.keys(body).length === 1) {
    const parsedOper = operFlagSchema.safeParse(body);
    if (!parsedOper.success) {
      return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    }
    if (session.role !== "CURATOR") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    const updated = await prisma.track.update({
      where: { id },
      data: { operFlag: parsedOper.data.operFlag, operSetById: session.userId, operSetAt: new Date() },
    });
    await recordAudit({
      entityType: "Track",
      entityId: id,
      actorId: session.userId,
      action: "OPER_FLAG_CHANGE",
      fieldName: "operFlag",
      before: String(existing.operFlag),
      after: String(updated.operFlag),
    });
    return NextResponse.json({ track: updated });
  }

  // Отдельная операция смены владельца — доступна Куратору всегда (подтверждённое
  // бизнес-правило, см. lib/permissions.ts canManageOwnership и ANALYSIS.md), в том
  // числе когда владелец ещё не назначен (импорт из Excel, раздел 38).
  if (body && typeof body === "object" && "ownerId" in body && Object.keys(body).length === 1) {
    const parsedOwner = ownerIdSchema.safeParse(body);
    if (!parsedOwner.success) {
      return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    }
    if (!canManageOwnership(session.role)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    const updated = await prisma.track.update({ where: { id }, data: { ownerId: parsedOwner.data.ownerId } });
    await recordAudit({
      entityType: "Track",
      entityId: id,
      actorId: session.userId,
      action: "OWNER_CHANGE",
      fieldName: "ownerId",
      before: existing.ownerId,
      after: updated.ownerId,
    });
    return NextResponse.json({ track: updated });
  }

  if (!canUpdateWorkEntity(session.role, session.userId, existing)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const parsed = updateTrackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.track.update({ where: { id }, data: parsed.data });

  await recordFieldChanges({
    entityType: "Track",
    entityId: id,
    actorId: session.userId,
    before: existing,
    after: updated,
    trackedFields: ["statusId", "ownerId", "attractivenessId", "name", "description", "segmentId"],
  });

  return NextResponse.json({ track: updated });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const existing = await prisma.track.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (!canArchiveWorkEntity(session.role, session.userId, existing)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const archived = await prisma.track.update({ where: { id }, data: { archivedAt: new Date() } });
  await recordAudit({ entityType: "Track", entityId: id, actorId: session.userId, action: "ARCHIVE" });

  return NextResponse.json({ track: archived });
}
