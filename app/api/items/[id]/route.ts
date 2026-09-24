import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { requireDirectorate } from "@/lib/scope";
import { canViewItems } from "@/lib/permissions";
import { loadTableRow, rowFromRecord } from "@/lib/table-view";
import { ITEM_ERROR_STATUS, setItemArchived, updateItem } from "@/lib/items";
import { updateItemSchema } from "@/lib/validation";
import { withApiErrors } from "@/lib/api-guard";

async function GETHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!canViewItems(actor.role)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const row = await loadTableRow(id, requireDirectorate(actor));
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ row });
}

// version обязателен: при расхождении — 409 CONFLICT с актуальной версией.
async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const parsed = updateItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }
  const result = await updateItem(actor, id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, currentVersion: result.currentVersion, message: result.message }, { status: ITEM_ERROR_STATUS[result.error] });
  }
  return NextResponse.json({ row: await rowFromRecord(result.record) });
}

// «Удаление» = архивирование.
async function DELETEHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const result = await setItemArchived(actor, id, true);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: ITEM_ERROR_STATUS[result.error] });
  return NextResponse.json({ row: await rowFromRecord(result.record) });
}

export const GET = withApiErrors(GETHandler);
export const PATCH = withApiErrors(PATCHHandler);
export const DELETE = withApiErrors(DELETEHandler);
