import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canArrangeCanvas } from "@/lib/permissions";

// Раздел 93 ТЗ: Canvas — View. Здесь только позиции карточек (ссылка на запись + x/y).
export async function GET() {
  await requireSession();
  const items = await prisma.canvasItem.findMany({ select: { entityType: true, entityId: true, x: true, y: true } });
  return NextResponse.json({ items });
}

const putSchema = z.object({
  items: z
    .array(
      z.object({
        entityType: z.enum(["Track", "Task", "VesselOption"]),
        entityId: z.string().min(1),
        x: z.number().finite(),
        y: z.number().finite(),
      })
    )
    .min(1)
    .max(500),
});

export async function PUT(request: NextRequest) {
  const session = await requireSession();
  if (!canArrangeCanvas(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  await prisma.$transaction(
    parsed.data.items.map((i) =>
      prisma.canvasItem.upsert({
        where: { entityType_entityId: { entityType: i.entityType, entityId: i.entityId } },
        update: { x: i.x, y: i.y },
        create: i,
      })
    )
  );
  return NextResponse.json({ saved: parsed.data.items.length });
}

// Сброс раскладки к автоматической (по сегментам).
export async function DELETE() {
  const session = await requireSession();
  if (!canArrangeCanvas(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { count } = await prisma.canvasItem.deleteMany();
  return NextResponse.json({ reset: count });
}
