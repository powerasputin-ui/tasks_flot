import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canEditReference, inUse, renameSchema, sameName, visibleTo } from "@/lib/reference-edit";
import { SYSTEM_STATUSES } from "@/lib/statuses";
import { withApiErrors } from "@/lib/api-guard";
import { z } from "zod";

// Статус: переименовать / сменить колонку трекера / удалить. Общий (для всех дирекций) — админ; свой статус дирекции —
// директор или админ в этой дирекции. Системные (не переименовываются, не удаляются, колонка закреплена): «Завершено» и
// «Не актуально» — по ним считаются просрочки и напоминания; «На проверке» и «На стопе» — их ставят только действия трекера.
async function load(id: string) {
  const session = await requireFreshSession();
  const status = await prisma.status.findUnique({ where: { id } });
  // чужой статус дирекции — как будто его нет
  if (!status || (status.directorateId && status.directorateId !== session.directorateId)) return { error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  if (!canEditReference(session, status)) return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  if (status.directorateId === null && SYSTEM_STATUSES.includes(status.name)) return { error: NextResponse.json({ error: "PROTECTED" }, { status: 409 }) };
  return { status };
}

async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const found = await load(id);
  if (found.error) return found.error;
  const status = found.status;
  if (body && typeof body === "object" && "trackerColumn" in body) {
    // свой статус дирекции — только рабочие колонки: в «На проверке», «Выполнено» и «Не актуально» задачу переводят действия трекера
    const col = (status.directorateId ? z.enum(["TODO", "DOING"]) : z.enum(["TODO", "DOING", "REVIEW", "DONE", "HIDDEN"])).safeParse(body.trackerColumn);
    if (!col.success) return NextResponse.json({ error: "INVALID_INPUT", message: status.directorateId ? "Свой статус дирекции — «Сделать» или «В работе»" : undefined }, { status: 400 });
    const updated = await prisma.status.update({ where: { id }, data: { trackerColumn: col.data } });
    invalidateDicts();
    return NextResponse.json({ status: updated });
  }
  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message }, { status: 400 });
  const others = await prisma.status.findMany({ where: { id: { not: id }, ...(status.directorateId ? visibleTo(status.directorateId) : {}) }, select: { name: true } });
  if (others.some((o) => sameName(o.name, parsed.data.name))) return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });
  const updated = await prisma.status.update({ where: { id }, data: { name: parsed.data.name } });
  invalidateDicts();
  return NextResponse.json({ status: updated });
}

async function DELETEHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await load(id);
  if (found.error) return found.error;
  const items = await prisma.operationalItem.count({ where: { statusId: id } });
  if (items > 0) return inUse(items, "статус");
  await prisma.status.delete({ where: { id } });
  invalidateDicts();
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiErrors(PATCHHandler);
export const DELETE = withApiErrors(DELETEHandler);
