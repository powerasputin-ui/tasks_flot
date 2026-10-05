import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canEditMemo, refreshMemoDraft } from "@/lib/memo-load";
import { withApiErrors } from "@/lib/api-guard";
import { logMemoEdit } from "@/lib/memo-log";

// «Обновить из данных»: новые поданные строки становятся новыми пунктами; правки директора не трогаются.
async function POSTHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const cycle = await prisma.cycle.findUnique({ where: { id } });
  if (!cycle || !canEditMemo(actor, cycle)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (cycle.status === "FINAL") return NextResponse.json({ error: "BAD_STATE" }, { status: 409 });
  const r = await refreshMemoDraft(cycle);
  if (!r) return NextResponse.json({ error: "CONFLICT" }, { status: 409 });
  if (r.added > 0) await logMemoEdit({ id: actor.id, name: actor.name, role: actor.role }, cycle, { changed: 0, added: r.added, removed: 0, hidden: 0, shown: 0, title: false, meeting: false });
  return NextResponse.json({ ok: true, added: r.added, version: r.version });
}

export const POST = withApiErrors(POSTHandler);
