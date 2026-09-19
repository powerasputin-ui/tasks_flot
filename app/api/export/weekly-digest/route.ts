import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canAccessManagerViews } from "@/lib/permissions";
import type { WeeklyDigestContent } from "@/lib/weekly-digest";
import { parseExportFormat, renderExport, exportResponse } from "@/lib/export";
import { buildWeeklyDigestReportData } from "@/lib/report-data";
import { renderPptx } from "@/lib/export-pptx";

// Раздел 23-26/55/56: экспортируется уже сохранённый дайджест (не пересчёт на лету).
// PPTX (Phase 5) доступен только для дайджеста: WeeklyDigest -> ReportData -> PPTX Renderer.
export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!canAccessManagerViews(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const rawFormat = searchParams.get("format");
  const format = rawFormat === "pptx" ? "pptx" : parseExportFormat(rawFormat);
  const id = searchParams.get("id");
  if (!format || !id) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const digest = await prisma.weeklyDigest.findUnique({ where: { id } });
  if (!digest) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const report = buildWeeklyDigestReportData(digest, digest.content as unknown as WeeklyDigestContent);
  const baseName = `weekly-digest-${digest.weekStart.toISOString().slice(0, 10)}`;

  if (format === "pptx") {
    const buf = await renderPptx(report);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}.pptx`,
      },
    });
  }

  const body = await renderExport(format, { title: report.title, subtitle: report.subtitle, sections: report.sections });
  return exportResponse(format, body, baseName);
}
