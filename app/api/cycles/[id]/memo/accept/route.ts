import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canEditMemo, loadMemo } from "@/lib/memo-load";
import { acceptSource } from "@/lib/memo";
import { withApiErrors } from "@/lib/api-guard";
import { diffMemo, isEmptyDiff, stampChanges } from "@/lib/memo-changes";
import { logMemoEdit } from "@/lib/memo-log";

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
  const changed = acceptSource(state.doc, body.bulletId, state.sources);
  const now = new Date();
  const doc = stampChanges(state.doc, changed, actor.name, now); // кто включил/изменил пункт — видно в справке
  const res = await prisma.cycle.updateMany({ where: { id, memoVersion: state.version }, data: { memoDraft: doc as unknown as Prisma.InputJsonValue, memoVersion: { increment: 1 } } });
  if (res.count !== 1) return NextResponse.json({ error: "CONFLICT" }, { status: 409 });
  const diff = { ...diffMemo(state.doc, changed), meeting: false };
  if (!isEmptyDiff(diff)) await logMemoEdit({ id: actor.id, name: actor.name, role: actor.role }, cycle, diff, now);
  return NextResponse.json({ ok: true, version: state.version + 1 });
}

export const POST = withApiErrors(POSTHandler);
