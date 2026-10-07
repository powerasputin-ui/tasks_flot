import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canCreateItem, canManageTracks } from "@/lib/permissions";
import { checkTrackName, trackKey } from "@/lib/track-name";
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

// Новый трек может добавить любой, кто заводит позиции (прямо из карточки позиции): он сразу попадает в справочник,
// как если бы его завёл куратор. Названия проверяются: пустые/мусорные — отказ, повтор (без учёта регистра, е/ё, пробелов, дефисов) — 409.
const QUICK_LIMIT_PER_HOUR = 15;

async function POSTHandler(request: NextRequest) {
  const session = await requireFreshSession();
  const manager = canManageTracks(session.role);
  if (!manager && !canCreateItem(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const parsed = trackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  const checked = checkTrackName(parsed.data.name);
  if (!checked.ok) return NextResponse.json({ error: "INVALID_NAME", message: checked.error }, { status: 400 });

  const directorateId = requireDirectorate(session);
  const data = manager ? { ...parsed.data, name: checked.name } : { name: checked.name, segmentId: parsed.data.segmentId };
  // сегмент трека должен быть из этой же дирекции
  if (data.segmentId && !(await prisma.segment.findFirst({ where: { id: data.segmentId, directorateId }, select: { id: true } }))) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  // повтор: среди треков этого сегмента и общих (без сегмента); новый «общий» трек сверяем со всеми треками дирекции
  const sameScope = await prisma.track.findMany({
    where: { directorateId, ...(data.segmentId ? { OR: [{ segmentId: data.segmentId }, { segmentId: null }] } : {}) },
    select: { id: true, name: true, segmentId: true, isActive: true },
  });
  const key = trackKey(checked.name);
  const duplicate = sameScope.find((t) => trackKey(t.name) === key);
  if (duplicate) return NextResponse.json({ error: "NAME_TAKEN", existing: duplicate }, { status: 409 });

  if (!manager) {
    const recent = await prisma.track.count({ where: { directorateId, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
    if (recent >= QUICK_LIMIT_PER_HOUR) return NextResponse.json({ error: "TOO_MANY", message: "Слишком много новых треков за час — выберите из списка или попросите куратора." }, { status: 429 });
  }

  const track = await prisma.track.create({ data: { ...data, directorateId } });
  invalidateDicts();
  return NextResponse.json({ track }, { status: 201 });
}

export const GET = withApiErrors(GETHandler);
export const POST = withApiErrors(POSTHandler);
