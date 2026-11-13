import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { referenceItemSchema } from "@/lib/validation";
import { newReferenceScope, sameName, visibleTo } from "@/lib/reference-edit";
import { withApiErrors } from "@/lib/api-guard";

// Общие статусы (без дирекции) видны всем; свои статусы дирекции — только ей.
async function GETHandler() {
  const session = await requireFreshSession();
  const statuses = await prisma.status.findMany({ where: { isActive: true, ...visibleTo(session.directorateId) }, orderBy: { sortOrder: "asc" } });
  return NextResponse.json({ statuses });
}

// Добавить: директор — в свою дирекцию; админ — в общие (для всех дирекций) или, с own: true, в выбранную дирекцию.
async function POSTHandler(request: NextRequest) {
  const session = await requireFreshSession();
  const body = (await request.json().catch(() => null)) as { own?: unknown; trackerColumn?: unknown } | null;
  const scope = newReferenceScope(session, !!body?.own);
  if (!scope) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = referenceItemSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  const name = parsed.data.name.trim();
  if (!name || name.length > 80) return NextResponse.json({ error: "INVALID_INPUT", message: "Название — от 1 до 80 символов" }, { status: 400 });
  // название не должно совпадать ни с общим, ни со своим (в списке дирекции было бы два одинаковых);
  // общее сверяем со всеми — оно появится у каждой дирекции
  const others = await prisma.status.findMany({ where: scope.directorateId ? visibleTo(scope.directorateId) : {}, select: { name: true } });
  if (others.some((o) => sameName(o.name, name))) return NextResponse.json({ error: "NAME_TAKEN", message: "Такой статус уже есть" }, { status: 409 });
  // свой статус дирекции — рабочий: «Сделать» или «В работе» (проверку, приёмку и отмену ведут системные статусы трекера)
  const trackerColumn = body?.trackerColumn === "TODO" ? "TODO" : "DOING";
  const last = await prisma.status.aggregate({ _max: { sortOrder: true } });
  const status = await prisma.status.create({ data: { name, color: parsed.data.color ?? null, sortOrder: parsed.data.sortOrder ?? (last._max.sortOrder ?? 0) + 1, directorateId: scope.directorateId, trackerColumn } });
  invalidateDicts();
  return NextResponse.json({ status }, { status: 201 });
}

export const GET = withApiErrors(GETHandler);
export const POST = withApiErrors(POSTHandler);
