import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canEditMemo, loadMemo, loadSectionDefs, loadSources } from "@/lib/memo-load";
import { refreshDraft } from "@/lib/memo";

// «Обновить из данных»: новые поданные строки становятся новыми пунктами; правки директора не трогаются.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const cycle = await prisma.cycle.findUnique({ where: { id } });
  if (!cycle || !canEditMemo(actor, cycle)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (cycle.status === "FINAL") return NextResponse.json({ error: "BAD_STATE" }, { status: 409 });
  const state = await loadMemo(cycle);
  const [defs, sources] = await Promise.all([loadSectionDefs(cycle.directorateId ?? ""), loadSources(cycle.directorateId ?? "")]);
  const { doc, added } = refreshDraft(state.doc, sources, defs);
  const res = await prisma.cycle.updateMany({ where: { id, memoVersion: state.version }, data: { memoDraft: doc as unknown as Prisma.InputJsonValue, memoVersion: { increment: 1 } } });
  if (res.count !== 1) return NextResponse.json({ error: "CONFLICT" }, { status: 409 });
  return NextResponse.json({ ok: true, added, version: state.version + 1 });
}
