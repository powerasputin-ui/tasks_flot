import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { requireDirectorate } from "@/lib/scope";
import { canViewItems } from "@/lib/permissions";
import { applyTableFilters, applyTableSort, loadTableRows, rowFromRecord, type ArchiveMode, type TableSort } from "@/lib/table-view";
import { createItem, ITEM_ERROR_STATUS } from "@/lib/items";
import { createItemSchema } from "@/lib/validation";
import { withApiErrors } from "@/lib/api-guard";

// Руководитель и куратор видят все позиции; руководству (только финал) и прочим рабочие позиции недоступны.
async function GETHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!canViewItems(actor.role)) return NextResponse.json({ rows: [], total: 0 });

  const sp = new URL(request.url).searchParams;
  const archive = (["active", "archived", "all"].includes(sp.get("archive") ?? "") ? sp.get("archive") : "active") as ArchiveMode;
  const date = (k: string) => (sp.get(k) ? new Date(sp.get(k)!) : undefined);
  const list = (k: string) => (sp.get(k) ? sp.get(k)!.split(",").filter(Boolean) : undefined);

  const rows = applyTableSort(
    applyTableFilters(await loadTableRows(archive, requireDirectorate(actor)), {
      segmentIds: sp.get("segmentIds") ? sp.get("segmentIds")!.split(",").filter(Boolean) : undefined,
      trackIds: list("trackIds"),
      statusIds: list("statusIds"),
      ownerIds: list("ownerIds"),
      attractivenessIds: list("attractivenessIds"),
      week: sp.get("week") ? Number(sp.get("week")) : undefined,
      operFlag: sp.get("operFlag") ? sp.get("operFlag") === "true" : undefined,
      deadlineFrom: date("deadlineFrom"),
      deadlineTo: date("deadlineTo"),
      q: sp.get("q") ?? undefined,
    }),
    { sortBy: (sp.get("sortBy") as TableSort["sortBy"]) ?? undefined, sortDir: (sp.get("sortDir") as "asc" | "desc") ?? undefined }
  );

  return NextResponse.json({ rows, total: rows.length });
}

async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  const parsed = createItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }
  const result = await createItem(actor, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error, message: result.message }, { status: ITEM_ERROR_STATUS[result.error] });
  return NextResponse.json({ row: await rowFromRecord(result.record) }, { status: 201 });
}

export const GET = withApiErrors(GETHandler);
export const POST = withApiErrors(POSTHandler);
