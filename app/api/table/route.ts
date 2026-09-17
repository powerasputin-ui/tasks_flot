import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { loadTableRows, applyTableFilters, applyTableSort, type RecordType } from "@/lib/table-view";

export async function GET(request: NextRequest) {
  await requireSession();
  const { searchParams } = new URL(request.url);

  const rows = await loadTableRows();

  const filtered = applyTableFilters(rows, {
    segmentId: searchParams.get("segmentId") ?? undefined,
    trackId: searchParams.get("trackId") ?? undefined,
    type: (searchParams.get("type") as RecordType) ?? undefined,
    statusId: searchParams.get("statusId") ?? undefined,
    ownerId: searchParams.get("ownerId") ?? undefined,
    attractivenessId: searchParams.get("attractivenessId") ?? undefined,
    week: searchParams.get("week") ? Number(searchParams.get("week")) : undefined,
    operFlag: searchParams.get("operFlag") ? searchParams.get("operFlag") === "true" : undefined,
    deadlineFrom: searchParams.get("deadlineFrom") ? new Date(searchParams.get("deadlineFrom")!) : undefined,
    deadlineTo: searchParams.get("deadlineTo") ? new Date(searchParams.get("deadlineTo")!) : undefined,
  });

  const sorted = applyTableSort(filtered, {
    sortBy: (searchParams.get("sortBy") as never) ?? undefined,
    sortDir: (searchParams.get("sortDir") as "asc" | "desc") ?? undefined,
  });

  return NextResponse.json({ rows: sorted, total: sorted.length });
}
