import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";

/**
 * Всё, что нужно экрану сразу при открытии: текущий пользователь, справочники, свои колонки и общий вид таблицы.
 * Один запрос вместо восьми отдельных: каждый обращается к удалённой базе, и вместе они ждали в очереди друг за другом.
 * Внутри запросы к базе идут параллельно.
 */
export async function GET() {
  const actor = await requireActor();
  const [user, segments, tracks, statuses, attractiveness, users, columns, layout] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, name: true, email: true, role: true, isActive: true } }),
    prisma.segment.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.track.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, segmentId: true } }),
    prisma.status.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.attractiveness.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    prisma.customColumn.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.appSetting.findUnique({ where: { key: "table.columns" } }),
  ]);
  return NextResponse.json({ user, segments, tracks, statuses, attractiveness, users, columns, tableColumns: layout?.value ?? null });
}
