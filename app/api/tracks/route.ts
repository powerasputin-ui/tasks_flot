import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canCreateWorkEntity } from "@/lib/permissions";
import { createTrackSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

export async function GET(request: NextRequest) {
  await requireSession();
  const { searchParams } = new URL(request.url);

  const segmentId = searchParams.get("segmentId") ?? undefined;
  const statusId = searchParams.get("statusId") ?? undefined;
  const ownerId = searchParams.get("ownerId") ?? undefined;
  const attractivenessId = searchParams.get("attractivenessId") ?? undefined;

  const tracks = await prisma.track.findMany({
    where: {
      archivedAt: null,
      ...(segmentId ? { segmentId } : {}),
      ...(statusId ? { statusId } : {}),
      ...(ownerId ? { ownerId } : {}),
      ...(attractivenessId ? { attractivenessId } : {}),
    },
    include: {
      segment: true,
      status: true,
      attractiveness: true,
      owner: { select: { id: true, name: true } },
      _count: { select: { tasks: true, vesselOptions: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tracks });
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!canCreateWorkEntity(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createTrackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const track = await prisma.track.create({ data: parsed.data });
  await recordAudit({
    entityType: "Track",
    entityId: track.id,
    actorId: session.userId,
    action: "CREATE",
  });

  return NextResponse.json({ track }, { status: 201 });
}
