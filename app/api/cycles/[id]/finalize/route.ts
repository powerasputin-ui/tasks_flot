import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { CYCLE_ERROR_STATUS, finalizeCycle } from "@/lib/cycles";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  // необязательное сопроводительное слово к справке для ЗГД
  const body = (await request.json().catch(() => null)) as { note?: unknown } | null;
  const note = typeof body?.note === "string" ? body.note.slice(0, 2000) : null;
  const result = await finalizeCycle(actor, id, note);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: CYCLE_ERROR_STATUS[result.error] });
  return NextResponse.json(result);
}
