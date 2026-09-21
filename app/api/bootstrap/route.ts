import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { requireDirectorate } from "@/lib/scope";
import { listDirectorates } from "@/lib/directorates";

/**
 * Всё, что нужно экрану сразу при открытии: текущий пользователь, справочники, свои колонки и общий вид таблицы.
 * Один запрос вместо восьми отдельных: каждый обращается к удалённой базе, и вместе они ждали в очереди друг за другом.
 * Внутри запросы к базе идут параллельно.
 */
export async function GET() {
  const actor = await requireActor();
  // ЗГД дирекции не имеет: справочники дирекции ему не нужны
  if (actor.role === "EXECUTIVE") {
    const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, name: true, email: true, role: true, isActive: true } });
    return NextResponse.json({ user, segments: [], tracks: [], statuses: [], attractiveness: [], users: [], columns: [], tableColumns: null, directorate: null, directorates: [] });
  }
  const directorateId = requireDirectorate(actor);
  const [user, segments, tracks, statuses, attractiveness, users, columns, layout] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, name: true, email: true, role: true, isActive: true } }),
    prisma.segment.findMany({ where: { isActive: true, directorateId }, orderBy: { sortOrder: "asc" } }),
    prisma.track.findMany({ where: { isActive: true, directorateId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, segmentId: true } }),
    prisma.status.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.attractiveness.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { isActive: true, directorateId }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    prisma.customColumn.findMany({ where: { isActive: true, directorateId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.appSetting.findUnique({ where: { key: `table.columns:${directorateId}` } }),
  ]);
  const dirs = await listDirectorates();
  // список дирекций нужен только админу (переключатель); остальным — название своей
  const isAdmin = actor.role === "ADMIN" || actor.role === "SYSTEM_ADMIN";
  return NextResponse.json({
    user,
    segments,
    tracks,
    statuses,
    attractiveness,
    users,
    columns,
    tableColumns: layout?.value ?? null,
    directorate: dirs.find((d) => d.id === directorateId) ?? null,
    directorates: isAdmin ? dirs.filter((d) => d.isActive) : [],
  });
}
