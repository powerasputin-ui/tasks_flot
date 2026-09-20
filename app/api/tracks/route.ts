import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canManageTracks } from "@/lib/permissions";
import { trackSchema } from "@/lib/validation";

// Трек — справочник (TZ_v4, раздел 3): читают все, ведут куратор и администратор.
export async function GET(request: NextRequest) {
  const session = await requireSession();
  const all = new URL(request.url).searchParams.get("all") === "1" && canManageTracks(session.role);
  const tracks = await prisma.track.findMany({
    where: all ? {} : { isActive: true },
    include: { segment: { select: { id: true, name: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ tracks });
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!canManageTracks(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const parsed = trackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });

  const duplicate = await prisma.track.findFirst({ where: { name: parsed.data.name, segmentId: parsed.data.segmentId ?? null } });
  if (duplicate) return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });

  const track = await prisma.track.create({ data: parsed.data });
  invalidateDicts();
  return NextResponse.json({ track }, { status: 201 });
}
