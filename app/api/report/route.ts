import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { canUseReports } from "@/lib/report-templates";
import { buildLiveReport, resolveReportConfig } from "@/lib/report-load";
import { withApiErrors } from "@/lib/api-guard";

// Отчёт для экрана «Оперативка»: руководитель и куратор строят его, администратор читает.
// Тело: { templateId?: "sys:…" | id сохранённого шаблона, config?: ReportConfig } — без тела берётся «Оперативка по дирекции».
async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!canUseReports(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { templateId?: string; config?: unknown };
  const resolved = await resolveReportConfig(actor, body);
  if (!resolved.ok) return NextResponse.json({ error: resolved.status === 404 ? "NOT_FOUND" : "INVALID_INPUT" }, { status: resolved.status });
  return NextResponse.json({ model: await buildLiveReport(actor, resolved.config) });
}

export const POST = withApiErrors(POSTHandler);
