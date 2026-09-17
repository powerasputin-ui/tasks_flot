import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { updateVesselOptionSchema } from "@/lib/validation";
import { recordFieldChanges, recordAudit } from "@/lib/audit";

/**
 * VesselOption не имеет собственного ownerId (раздел 15, UNRESOLVED #2 в ANALYSIS.md) —
 * право на редактирование определяется владельцем родительского Track.
 */
async function canWriteVesselOption(role: string, userId: string, trackId: string): Promise<boolean> {
  if (role !== "RESPONSIBLE") return false;
  const track = await prisma.track.findUnique({ where: { id: trackId } });
  return track?.ownerId === userId;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;

  const vesselOption = await prisma.vesselOption.findUnique({
    where: { id },
    include: { status: true, attractiveness: true, track: true },
  });
  if (!vesselOption) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({ vesselOption });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const existing = await prisma.vesselOption.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (!(await canWriteVesselOption(session.role, session.userId, existing.trackId))) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateVesselOptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.vesselOption.update({ where: { id }, data: parsed.data });

  await recordFieldChanges({
    entityType: "VesselOption",
    entityId: id,
    actorId: session.userId,
    before: existing,
    after: updated,
    trackedFields: ["statusId", "attractivenessId", "name", "cost", "comment"],
  });

  return NextResponse.json({ vesselOption: updated });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const existing = await prisma.vesselOption.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (!(await canWriteVesselOption(session.role, session.userId, existing.trackId))) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const archived = await prisma.vesselOption.update({ where: { id }, data: { archivedAt: new Date() } });
  await recordAudit({ entityType: "VesselOption", entityId: id, actorId: session.userId, action: "ARCHIVE" });

  return NextResponse.json({ vesselOption: archived });
}
