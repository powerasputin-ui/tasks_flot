import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { createEditRequest } from "@/lib/notifications";

const schema = z.object({
  entityType: z.enum(["Track", "Task", "VesselOption"]),
  entityId: z.string().min(1),
  note: z.string().min(1, "Опишите, что нужно изменить").max(500),
});

// Раздел 33: "Запрос на изменение записи" — уведомление владельцу (или Кураторам, если владельца нет).
export async function POST(request: NextRequest) {
  const session = await requireSession();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  const { entityType, entityId, note } = parsed.data;

  let target: { name: string; ownerId: string | null; trackId: string } | null = null;
  if (entityType === "Track") {
    const t = await prisma.track.findUnique({ where: { id: entityId } });
    if (t) target = { name: t.name, ownerId: t.ownerId, trackId: t.id };
  } else if (entityType === "Task") {
    const t = await prisma.task.findUnique({ where: { id: entityId } });
    if (t) target = { name: t.title, ownerId: t.ownerId, trackId: t.trackId };
  } else {
    // VesselOption не имеет ownerId — правит владелец трека (раздел 15).
    const v = await prisma.vesselOption.findUnique({ where: { id: entityId }, include: { track: true } });
    if (v) target = { name: v.name, ownerId: v.track.ownerId, trackId: v.trackId };
  }
  if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
  const delivered = await createEditRequest({
    requesterId: session.userId,
    requesterName: me?.name ?? "Пользователь",
    ownerId: target.ownerId,
    name: target.name,
    note,
    link: `/tracks/${target.trackId}`,
  });
  return NextResponse.json({ delivered }, { status: 201 });
}
