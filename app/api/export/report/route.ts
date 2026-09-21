import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { canUseReports } from "@/lib/report-templates";
import { buildLiveReport, resolveReportConfig } from "@/lib/report-load";
import { reportFileHeader, reportPdfHeader, reportToSections } from "@/lib/report-export";
import { exportResponse, parseExportFormat, renderExport } from "@/lib/export";
import { renderReportPptx } from "@/lib/export-pptx";

// Выгрузка отчёта «Оперативки» по шаблону или по своей конфигурации: ?format=xlsx|pdf|csv|pptx&templateId=… | &config=<JSON>.
export async function GET(request: NextRequest) {
  const actor = await requireActor();
  if (!canUseReports(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const formatParam = sp.get("format");
  const pptx = formatParam === "pptx";
  const format = pptx ? null : parseExportFormat(formatParam);
  if (!pptx && !format) return NextResponse.json({ error: "INVALID_FORMAT" }, { status: 400 });

  let config: unknown;
  if (sp.get("config")) {
    try {
      config = JSON.parse(sp.get("config")!);
    } catch {
      return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    }
  }
  const resolved = await resolveReportConfig(actor, { templateId: sp.get("templateId") ?? undefined, config });
  if (!resolved.ok) return NextResponse.json({ error: resolved.status === 404 ? "NOT_FOUND" : "INVALID_INPUT" }, { status: resolved.status });

  const model = await buildLiveReport(resolved.config);
  const stamp = new Date().toISOString().slice(0, 10);
  if (pptx) {
    return new Response(new Uint8Array(await renderReportPptx(model)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="operativka-${stamp}.pptx"`,
      },
    });
  }
  const pdf = format === "pdf";
  const head = pdf ? reportPdfHeader(model) : reportFileHeader(model);
  const body = await renderExport(format!, { title: head.title, subtitle: head.subtitle, sections: reportToSections(model, { summary: !pdf }) });
  return exportResponse(format!, body, `operativka-${stamp}`);
}
