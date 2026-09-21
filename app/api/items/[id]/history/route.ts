import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { requireDirectorate } from "@/lib/scope";
import { canViewItems } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

// Журнал правок позиции: кто, что, было → стало (TZ_v4, раздел 4.2).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!canViewItems(actor.role)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!(await prisma.operationalItem.findFirst({ where: { id, directorateId: requireDirectorate(actor) }, select: { id: true } }))) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const events = await prisma.auditEvent.findMany({
    where: { entityType: "OperationalItem", entityId: id },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { timestamp: "desc" },
    take: 200,
  });
  return NextResponse.json({ events });
}
