import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canEditMemo, loadMemo, loadSectionDefs, loadSources } from "@/lib/memo-load";
import { setIncluded } from "@/lib/memo";
import { withApiErrors } from "@/lib/api-guard";

// Решение «в справку / не в справку» по одной строке (из таблицы или из редактора). Тело: { itemId, include }.
async function POSTHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const cycle = await prisma.cycle.findUnique({ where: { id } });
  if (!cycle || !canEditMemo(actor, cycle)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (cycle.status === "FINAL") return NextResponse.json({ error: "BAD_STATE" }, { status: 409 });
  const body = (await request.json().catch(() => null)) as { itemId?: string; include?: boolean } | null;
  if (!body?.itemId || typeof body.include !== "boolean") return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const [state, defs] = await Promise.all([loadMemo(cycle), loadSectionDefs(cycle.directorateId ?? "")]);
  const sources = await loadSources(cycle.directorateId ?? "", undefined, defs);
  const item = sources.find((s) => s.id === body.itemId);
  if (!item) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const doc = setIncluded(state.doc, item, body.include, defs, sources);
  const res = await prisma.cycle.updateMany({ where: { id, memoVersion: state.version }, data: { memoDraft: doc as unknown as Prisma.InputJsonValue, memoVersion: { increment: 1 } } });
  if (res.count !== 1) return NextResponse.json({ error: "CONFLICT" }, { status: 409 });
  return NextResponse.json({ ok: true, included: body.include, version: state.version + 1 });
}

export const POST = withApiErrors(POSTHandler);
