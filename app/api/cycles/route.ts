import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { createCycle, CYCLE_ERROR_STATUS } from "@/lib/cycles";

// Начать новый цикл оперативки (куратор). Тело: { deadline: "YYYY-MM-DD" }.
export async function POST(request: NextRequest) {
  const actor = await requireActor();
  const body = (await request.json().catch(() => null)) as { deadline?: string } | null;
  const result = await createCycle(actor, new Date(body?.deadline ?? ""));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: CYCLE_ERROR_STATUS[result.error] });
  return NextResponse.json({ id: result.id }, { status: 201 });
}
