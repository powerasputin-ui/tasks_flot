import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canManageTracks } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { trackSchema } from "@/lib/validation";
import { withApiErrors } from "@/lib/api-guard";

// Трек — справочник (TZ_v4, раздел 3): читают все, ведут куратор и администратор.
async function GETHandler(request: NextRequest) {
  const session = await requireFreshSession();
  const all = new URL(request.url).searchParams.get("all") === "1" && canManageTracks(session.role);
  const tracks = await prisma.track.findMany({
    where: { directorateId: requireDirectorate(session), ...(all ? {} : { isActive: true }) },
    include: { segment: { select: { id: true, name: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ tracks });
}

async function POSTHandler(request: NextRequest) {
  const session = await requireFreshSession();
  if (!canManageTracks(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const parsed = trackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });

  const directorateId = requireDirectorate(session);
  // сегмент трека должен быть из этой же дирекции
  if (parsed.data.segmentId && !(await prisma.segment.findFirst({ where: { id: parsed.data.segmentId, directorateId }, select: { id: true } }))) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const duplicate = await prisma.track.findFirst({ where: { directorateId, name: parsed.data.name, segmentId: parsed.data.segmentId ?? null } });
  if (duplicate) return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });

  const track = await prisma.track.create({ data: { ...parsed.data, directorateId } });
  invalidateDicts();
  return NextResponse.json({ track }, { status: 201 });
}

export const GET = withApiErrors(GETHandler);
export const POST = withApiErrors(POSTHandler);
