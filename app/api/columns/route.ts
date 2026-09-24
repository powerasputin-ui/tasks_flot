import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canManageColumns, canViewItems } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { withApiErrors } from "@/lib/api-guard";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(["TEXT", "NUMBER", "DATE", "SELECT"]),
  options: z.array(z.string().trim().min(1)).max(50).optional(),
});

// Свои колонки таблицы читают все, кто видит позиции.
async function GETHandler() {
  const actor = await requireActor();
  if (!canViewItems(actor.role)) return NextResponse.json({ columns: [] });
  const columns = await prisma.customColumn.findMany({ where: { isActive: true, directorateId: requireDirectorate(actor) }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json({ columns });
}

// Создаёт куратор (или администратор).
async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!canManageColumns(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  const { name, type, options = [] } = parsed.data;
  if (type === "SELECT" && options.length === 0) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const directorateId = requireDirectorate(actor);
  const last = await prisma.customColumn.findFirst({ where: { directorateId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const column = await prisma.customColumn.create({
    data: { name, type, options: type === "SELECT" ? options : [], sortOrder: (last?.sortOrder ?? 0) + 1, directorateId },
  });
  invalidateDicts();
  return NextResponse.json({ column }, { status: 201 });
}

export const GET = withApiErrors(GETHandler);
export const POST = withApiErrors(POSTHandler);
