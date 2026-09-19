import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { canViewItems } from "@/lib/permissions";
import { loadTableRow } from "@/lib/table-view";
import { ITEM_ERROR_STATUS, setItemArchived, updateItem } from "@/lib/items";
import { updateItemSchema } from "@/lib/validation";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!canViewItems(actor.role)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const row = await loadTableRow(id);
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ row });
}

// version обязателен: при расхождении — 409 CONFLICT с актуальной версией.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const parsed = updateItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }
  const result = await updateItem(actor, id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, currentVersion: result.currentVersion }, { status: ITEM_ERROR_STATUS[result.error] });
  }
  return NextResponse.json({ row: await loadTableRow(id) });
}

// «Удаление» = архивирование.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const result = await setItemArchived(actor, id, true);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: ITEM_ERROR_STATUS[result.error] });
  return NextResponse.json({ row: await loadTableRow(id) });
}
