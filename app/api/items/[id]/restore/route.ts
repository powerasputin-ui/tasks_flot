import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { rowFromRecord } from "@/lib/table-view";
import { ITEM_ERROR_STATUS, setItemArchived } from "@/lib/items";
import { withApiErrors } from "@/lib/api-guard";

// Возврат позиции из архива в работу.
async function POSTHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const result = await setItemArchived(actor, id, false);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: ITEM_ERROR_STATUS[result.error] });
  return NextResponse.json({ row: await rowFromRecord(result.record) });
}

export const POST = withApiErrors(POSTHandler);
