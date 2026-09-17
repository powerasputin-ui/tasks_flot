import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canCreateWorkEntity } from "@/lib/permissions";
import { createVesselOptionSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

export async function GET(request: NextRequest) {
  await requireSession();
  const { searchParams } = new URL(request.url);
  const trackId = searchParams.get("trackId") ?? undefined;
  const statusId = searchParams.get("statusId") ?? undefined;

  const vesselOptions = await prisma.vesselOption.findMany({
    where: {
      archivedAt: null,
      ...(trackId ? { trackId } : {}),
      ...(statusId ? { statusId } : {}),
    },
    include: {
      status: true,
      attractiveness: true,
      track: { select: { id: true, name: true, segmentId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ vesselOptions });
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!canCreateWorkEntity(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createVesselOptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const track = await prisma.track.findUnique({ where: { id: parsed.data.trackId } });
  if (!track || track.archivedAt) {
    return NextResponse.json({ error: "TRACK_NOT_FOUND" }, { status: 400 });
  }

  const vesselOption = await prisma.vesselOption.create({ data: parsed.data });
  await recordAudit({
    entityType: "VesselOption",
    entityId: vesselOption.id,
    actorId: session.userId,
    action: "CREATE",
  });

  return NextResponse.json({ vesselOption }, { status: 201 });
}
