import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { createCommentSchema } from "@/lib/validation";
import { notifyMentions } from "@/lib/notifications";

const ENTITY_LINK_PREFIX: Record<string, string> = {
  Track: "/tracks",
  Task: "/tracks", // задачи открываются на странице трека (раздел 44)
  VesselOption: "/tracks",
  WeeklyUpdate: "/tracks",
};

export async function GET(request: NextRequest) {
  await requireSession();
  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get("entityType");
  const entityId = searchParams.get("entityId");

  if (!entityType || !entityId) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const comments = await prisma.comment.findMany({
    where: { entityType, entityId },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ comments });
}

export async function POST(request: NextRequest) {
  const session = await requireSession();

  const body = await request.json().catch(() => null);
  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const comment = await prisma.comment.create({
    data: {
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      authorId: session.userId,
      text: parsed.data.text,
    },
    include: { author: { select: { id: true, name: true } } },
  });

  // Для Task/VesselOption/WeeklyUpdate ссылка ведёт на родительский трек —
  // для Task/VesselOption entityId и есть их собственный id, страница трека
  // сама находит нужный блок; для WeeklyUpdate это trackId отчёта.
  let linkEntityId = parsed.data.entityId;
  if (parsed.data.entityType === "WeeklyUpdate") {
    const wu = await prisma.weeklyUpdate.findUnique({ where: { id: parsed.data.entityId }, select: { trackId: true } });
    if (wu) linkEntityId = wu.trackId;
  } else if (parsed.data.entityType === "Task") {
    const task = await prisma.task.findUnique({ where: { id: parsed.data.entityId }, select: { trackId: true } });
    if (task) linkEntityId = task.trackId;
  } else if (parsed.data.entityType === "VesselOption") {
    const vo = await prisma.vesselOption.findUnique({ where: { id: parsed.data.entityId }, select: { trackId: true } });
    if (vo) linkEntityId = vo.trackId;
  }

  await notifyMentions({
    text: parsed.data.text,
    actorId: session.userId,
    actorName: comment.author.name,
    entityType: parsed.data.entityType,
    entityId: parsed.data.entityId,
    link: `${ENTITY_LINK_PREFIX[parsed.data.entityType]}/${linkEntityId}`,
  });

  return NextResponse.json({ comment }, { status: 201 });
}
