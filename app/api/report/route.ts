import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { canExportWorkTable } from "@/lib/permissions";
import { buildLiveReport, configFromInput } from "@/lib/report-load";

// Отчёт для экрана «Оперативка»: руководитель и куратор строят его, администратор читает.
// Тело: { templateId?: "sys:directorate" | "sys:table", config?: ReportConfig } — без тела берётся «Оперативка по дирекции».
export async function POST(request: NextRequest) {
  const actor = await requireActor();
  if (!canExportWorkTable(actor.role) && actor.role !== "SYSTEM_ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { templateId?: string; config?: unknown };
  const resolved = configFromInput(body);
  if (!resolved.ok) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  return NextResponse.json({ model: await buildLiveReport(resolved.config) });
}
