import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canEditMemo } from "@/lib/memo-load";
import { memoHistory } from "@/lib/memo-log";
import { withApiErrors } from "@/lib/api-guard";

// История правок справки: кто и когда правил черновик, начинал сборку, отправлял ЗГД. Видят те, кто ведёт справку.
async function GETHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const cycle = await prisma.cycle.findUnique({ where: { id }, select: { id: true, directorateId: true } });
  if (!cycle || !canEditMemo(actor, cycle)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ entries: await memoHistory(id) });
}

export const GET = withApiErrors(GETHandler);
