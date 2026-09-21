import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { requireDirectorate } from "@/lib/scope";
import { CYCLE_ERROR_STATUS, returnItem } from "@/lib/cycles";
import { loadTableRow } from "@/lib/table-view";

// Куратор возвращает отправленную позицию на доработку. Тело: { comment }.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { comment?: string } | null;
  const result = await returnItem(actor, id, body?.comment ?? "");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: CYCLE_ERROR_STATUS[result.error] });
  return NextResponse.json({ row: await loadTableRow(id, requireDirectorate(actor)) });
}
