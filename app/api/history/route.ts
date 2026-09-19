import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { loadRowsAsOf } from "@/lib/time-travel";

// Раздел 30: состояние на дату. Чтение — всем ролям (как и Table View).
export async function GET(request: NextRequest) {
  await requireSession();
  const raw = new URL(request.url).searchParams.get("date");
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }
  // Включаем весь выбранный день.
  const asOf = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const rows = await loadRowsAsOf(asOf);
  return NextResponse.json({ asOf: asOf.toISOString(), rows });
}
