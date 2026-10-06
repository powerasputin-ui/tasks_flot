import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { purgeItem } from "@/lib/items";
import { withApiErrors } from "@/lib/api-guard";

// Удалить навсегда позицию из «Удалённых» (без возврата; директор и ответственный получают уведомление).
async function POSTHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const result = await purgeItem(actor, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "NOT_FOUND" ? 404 : result.error === "FORBIDDEN" ? 403 : 409 });
  return NextResponse.json({ ok: true });
}

export const POST = withApiErrors(POSTHandler);
