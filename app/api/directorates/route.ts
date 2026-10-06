import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canCreateDirectorates } from "@/lib/permissions";
import { invalidateDirectorates, listDirectorates } from "@/lib/directorates";
import { withApiErrors } from "@/lib/api-guard";
import { copyDirectorateStructure } from "@/lib/directorate-setup";

// Список дирекций: админу — все (в том числе отключённые) с карточкой (директор, люди, оперативка), остальным — их собственная.
async function GETHandler() {
  const session = await requireFreshSession();
  const all = await listDirectorates();
  if (!canCreateDirectorates(session.role)) return NextResponse.json({ directorates: all.filter((d) => d.id === session.directorateId), current: session.directorateId });
  const [rows, people, open, sent] = await Promise.all([
    prisma.directorate.findMany({ select: { id: true, shortName: true, sortOrder: true } }),
    prisma.user.findMany({ where: { isActive: true, directorateId: { not: null } }, select: { id: true, name: true, role: true, directorateId: true } }),
    prisma.cycle.findMany({ where: { status: { not: "FINAL" } }, select: { directorateId: true, number: true, status: true } }),
    prisma.memoVersion.groupBy({ by: ["directorateId"], _max: { sentAt: true } }),
  ]);
  const extra = new Map(rows.map((r) => [r.id, r]));
  const directorates = all.map((d) => ({
    ...d,
    shortName: extra.get(d.id)?.shortName ?? null,
    sortOrder: extra.get(d.id)?.sortOrder ?? 0,
    directors: people.filter((p) => p.directorateId === d.id && p.role === "DIRECTOR").map((p) => ({ id: p.id, name: p.name })),
    people: people.filter((p) => p.directorateId === d.id).length,
    openCycle: open.find((c) => c.directorateId === d.id) ?? null,
    lastSentAt: sent.find((x) => x.directorateId === d.id)?._max.sentAt ?? null,
  }));
  return NextResponse.json({ directorates, current: session.directorateId });
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** Короткое название для заголовка справки («РФ и КЭ»). */
  shortName: z.string().trim().max(40).optional(),
  /** Скопировать настройку таблицы (столбцы, раскладку, сегменты, треки, вид справки) из этой дирекции. */
  copyFrom: z.string().min(1).optional(),
});

// Дирекции заводит админ. Новая — по общей заготовке (стандартные столбцы, вид справки по умолчанию) или копия настройки другой дирекции.
async function POSTHandler(request: NextRequest) {
  const session = await requireFreshSession();
  if (!canCreateDirectorates(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const { name, shortName, copyFrom } = parsed.data;
  if (await prisma.directorate.findUnique({ where: { name } })) return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });
  if (copyFrom && !(await listDirectorates()).some((d) => d.id === copyFrom)) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const last = await prisma.directorate.aggregate({ _max: { sortOrder: true } });
  const directorate = await prisma.$transaction(async (tx) => {
    const d = await tx.directorate.create({ data: { name, shortName: shortName || null, sortOrder: (last._max.sortOrder ?? 0) + 1 }, select: { id: true, name: true, isActive: true } });
    if (copyFrom) await copyDirectorateStructure(tx, copyFrom, d.id);
    return d;
  });
  invalidateDirectorates();
  return NextResponse.json({ directorate }, { status: 201 });
}

export const GET = withApiErrors(GETHandler);
export const POST = withApiErrors(POSTHandler);
