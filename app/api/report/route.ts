import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { canExportWorkTable } from "@/lib/permissions";
import { buildLiveReport, resolveReportConfig } from "@/lib/report-load";

// Отчёт для экрана «Оперативка»: руководитель и куратор строят его, администратор читает.
// Тело: { templateId?: "sys:…" | id сохранённого шаблона, config?: ReportConfig } — без тела берётся «Оперативка по дирекции».
export async function POST(request: NextRequest) {
  const actor = await requireActor();
  if (!canExportWorkTable(actor.role) && actor.role !== "SYSTEM_ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { templateId?: string; config?: unknown };
  const resolved = await resolveReportConfig(actor, body);
  if (!resolved.ok) return NextResponse.json({ error: resolved.status === 404 ? "NOT_FOUND" : "INVALID_INPUT" }, { status: resolved.status });
  return NextResponse.json({ model: await buildLiveReport(resolved.config) });
}
