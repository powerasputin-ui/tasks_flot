import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canManageColumns } from "@/lib/permissions";

const KEY = "table.columns";

const schema = z.object({
  columns: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        label: z.string().max(60),
        visible: z.boolean(),
        width: z.number().min(20).max(2000),
        removed: z.boolean().optional(),
      })
    )
    .max(80),
});

// Вид колонок таблицы (порядок, подписи, показ, «удалённые») — один для всех пользователей.
export async function GET() {
  await requireActor();
  const setting = await prisma.appSetting.findUnique({ where: { key: KEY } });
  return NextResponse.json({ columns: setting?.value ?? null });
}

// Меняет куратор (или администратор): изменения сразу видят все.
export async function PUT(request: NextRequest) {
  const actor = await requireActor();
  if (!canManageColumns(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: parsed.data.columns },
    update: { value: parsed.data.columns },
  });
  return NextResponse.json({ ok: true });
}
