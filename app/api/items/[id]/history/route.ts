import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { canViewItem } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

// Журнал правок позиции: кто, что, было → стало (TZ_v4, раздел 4.2).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const item = await prisma.operationalItem.findUnique({ where: { id }, select: { departmentId: true } });
  if (!item || !canViewItem(actor, item)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const events = await prisma.auditEvent.findMany({
    where: { entityType: "OperationalItem", entityId: id },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { timestamp: "desc" },
    take: 200,
  });
  return NextResponse.json({ events });
}
