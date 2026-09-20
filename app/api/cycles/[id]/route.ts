import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// Финальная оперативка с неизменяемым снимком — доступна всем ролям, включая руководство.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireActor();
  const { id } = await params;
  const cycle = await prisma.cycle.findFirst({ where: { id, status: "FINAL" } });
  if (!cycle) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ cycle });
}
