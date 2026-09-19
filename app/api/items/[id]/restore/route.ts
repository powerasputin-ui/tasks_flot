import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { loadTableRow } from "@/lib/table-view";
import { ITEM_ERROR_STATUS, setItemArchived } from "@/lib/items";

// Возврат позиции из архива в работу.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const result = await setItemArchived(actor, id, false);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: ITEM_ERROR_STATUS[result.error] });
  return NextResponse.json({ row: await loadTableRow(id) });
}
