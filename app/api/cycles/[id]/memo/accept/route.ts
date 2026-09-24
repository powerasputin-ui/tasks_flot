import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canEditMemo, loadMemo } from "@/lib/memo-load";
import { acceptSource } from "@/lib/memo";
import { withApiErrors } from "@/lib/api-guard";

// «Принять новый источник»: пометка «источник изменился» снимается, текст пункта остаётся как есть.
async function POSTHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const cycle = await prisma.cycle.findUnique({ where: { id } });
  if (!cycle || !canEditMemo(actor, cycle)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (cycle.status === "FINAL") return NextResponse.json({ error: "BAD_STATE" }, { status: 409 });
  const body = (await request.json().catch(() => null)) as { bulletId?: string } | null;
  if (!body?.bulletId) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const state = await loadMemo(cycle);
  const doc = acceptSource(state.doc, body.bulletId, state.sources);
  const res = await prisma.cycle.updateMany({ where: { id, memoVersion: state.version }, data: { memoDraft: doc as unknown as Prisma.InputJsonValue, memoVersion: { increment: 1 } } });
  if (res.count !== 1) return NextResponse.json({ error: "CONFLICT" }, { status: 409 });
  return NextResponse.json({ ok: true, version: state.version + 1 });
}

export const POST = withApiErrors(POSTHandler);
