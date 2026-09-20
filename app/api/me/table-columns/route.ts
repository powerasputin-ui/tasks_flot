import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";

const schema = z.object({
  columns: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        label: z.string().max(60),
        visible: z.boolean(),
        width: z.number().min(20).max(2000),
      })
    )
    .max(80),
});

// Личные настройки колонок таблицы (порядок, видимость, ширина, подписи) хранятся в базе:
// одинаково на любом компьютере и в любом браузере.
export async function GET() {
  const actor = await requireActor();
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { tableColumns: true } });
  return NextResponse.json({ columns: user?.tableColumns ?? null });
}

export async function PUT(request: NextRequest) {
  const actor = await requireActor();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  await prisma.user.update({ where: { id: actor.id }, data: { tableColumns: parsed.data.columns } });
  return NextResponse.json({ ok: true });
}
