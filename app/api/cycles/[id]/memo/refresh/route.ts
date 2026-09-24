import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canEditMemo, refreshMemoDraft } from "@/lib/memo-load";
import { withApiErrors } from "@/lib/api-guard";

// «Обновить из данных»: новые поданные строки становятся новыми пунктами; правки директора не трогаются.
async function POSTHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const cycle = await prisma.cycle.findUnique({ where: { id } });
  if (!cycle || !canEditMemo(actor, cycle)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (cycle.status === "FINAL") return NextResponse.json({ error: "BAD_STATE" }, { status: 409 });
  const r = await refreshMemoDraft(cycle);
  if (!r) return NextResponse.json({ error: "CONFLICT" }, { status: 409 });
  return NextResponse.json({ ok: true, added: r.added, version: r.version });
}

export const POST = withApiErrors(POSTHandler);
