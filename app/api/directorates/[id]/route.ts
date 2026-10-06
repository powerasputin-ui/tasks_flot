import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canCreateDirectorates } from "@/lib/permissions";
import { invalidateDirectorates } from "@/lib/directorates";
import { withApiErrors } from "@/lib/api-guard";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  /** Короткое название для заголовка справки; пустая строка — убрать. */
  shortName: z.string().trim().max(40).optional(),
  isActive: z.boolean().optional(),
  /** Сдвинуть в списке (порядок дирекций у ЗГД и в переключателе). */
  move: z.enum(["up", "down"]).optional(),
});

// Переименовать, задать короткое название, сдвинуть в списке или отключить дирекцию (данные не удаляются; отключённая пропадает из выбора).
async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFreshSession();
  if (!canCreateDirectorates(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  if (!(await prisma.directorate.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (parsed.data.name && (await prisma.directorate.findFirst({ where: { name: parsed.data.name, id: { not: id } } }))) return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });
  // нельзя отключить последнюю активную дирекцию: работать станет негде
  if (parsed.data.isActive === false && (await prisma.directorate.count({ where: { isActive: true, id: { not: id } } })) === 0) return NextResponse.json({ error: "LAST_DIRECTORATE" }, { status: 409 });
  const { move, shortName, ...data } = parsed.data;
  if (move) {
    // порядок по списку; меняемся местами с соседом и заодно нумеруем всех подряд (у старых дирекций sortOrder одинаковый)
    const list = await prisma.directorate.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true } });
    const i = list.findIndex((d) => d.id === id);
    const j = move === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
    await prisma.$transaction(list.map((d, n) => prisma.directorate.update({ where: { id: d.id }, data: { sortOrder: n } })));
  }
  const directorate = await prisma.directorate.update({
    where: { id },
    data: { ...data, ...(shortName !== undefined ? { shortName: shortName || null } : {}) },
    select: { id: true, name: true, isActive: true },
  });
  invalidateDirectorates();
  return NextResponse.json({ directorate });
}

export const PATCH = withApiErrors(PATCHHandler);
