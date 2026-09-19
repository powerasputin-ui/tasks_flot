import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { computeChanges, type PeriodKind } from "@/lib/change-engine";

// Раздел 31: Change Engine. Чтение — всем ролям (как Table View / История).
export async function GET(request: NextRequest) {
  await requireSession();
  const sp = new URL(request.url).searchParams;
  const kind = sp.get("kind");
  const date = new Date(sp.get("date") ?? "");
  if ((kind !== "week" && kind !== "month") || Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }
  const result = await computeChanges(kind as PeriodKind, date);
  return NextResponse.json({
    ...result,
    period: { ...result.period, start: result.period.start.toISOString(), end: result.period.end.toISOString(), previousEnd: undefined },
  });
}
