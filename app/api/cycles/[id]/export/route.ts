import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canViewFinalCycle } from "@/lib/scope";
import { exportResponse, parseExportFormat, renderExport } from "@/lib/export";
import { renderPptx, renderReportPptx } from "@/lib/export-pptx";
import { buildFinalReport, resolveReportConfig } from "@/lib/report-load";
import { reportFileHeader, reportPdfHeader, reportToSections } from "@/lib/report-export";

type SnapRow = {
  segmentName: string | null;
  trackName: string | null;
  name: string;
  cost: string | null;
  attractivenessName: string | null;
  ownerName: string | null;
  deadline: string | null;
  statusName: string | null;
  comment: string | null;
  customFields?: Array<{ name: string; type: string; value: string | null }>;
};

// Выгрузка финальной оперативки из неизменяемого снимка (Excel / PDF / CSV). Доступна всем ролям, включая руководство.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const formatParam = new URL(request.url).searchParams.get("format");
  const pptx = formatParam === "pptx";
  const format = pptx ? null : parseExportFormat(formatParam);
  if (!pptx && !format) return NextResponse.json({ error: "INVALID_FORMAT" }, { status: 400 });
  const cycle = await prisma.cycle.findFirst({ where: { id, status: "FINAL" } });
  if (!cycle || !canViewFinalCycle(actor, cycle)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Выгрузка по шаблону или по своей конфигурации отчёта (?config=<JSON> | ?templateId=…); без них — прежний плоский список.
  const sp = new URL(request.url).searchParams;
  if (sp.get("config") || sp.get("templateId")) {
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
    const model = await buildFinalReport(cycle, resolved.config);
    if (pptx) {
      return new Response(new Uint8Array(await renderReportPptx(model)), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": `attachment; filename="operativka-${cycle.number}.pptx"`,
        },
      });
    }
    const pdf = format === "pdf";
  const head = pdf ? reportPdfHeader(model) : reportFileHeader(model);
    return exportResponse(format!, await renderExport(format!, { title: head.title, subtitle: head.subtitle, sections: reportToSections(model, { summary: !pdf }) }), `operativka-${cycle.number}`);
  }

  const rows = (cycle.snapshot ?? []) as unknown as SnapRow[];
  const date = (v: string | null) => (v ? new Date(v).toLocaleDateString("ru-RU") : null);
  const report = {
    title: `Оперативка №${cycle.number}`,
    subtitle: `Зафиксирована ${date(cycle.finalizedAt?.toISOString() ?? null)} · позиций: ${rows.length}`,
    sections: [
      {
        title: "Позиции",
        headers: ["Сегмент", "Трек", "Задача", "Оценка $", "Привлекательность", "Ответственный", "Дедлайн", "Статус", "Комментарий", ...(rows[0]?.customFields?.map((f) => f.name) ?? [])],
        rows: rows.map((r) => [
          r.segmentName,
          r.trackName,
          r.name,
          r.cost,
          r.attractivenessName ?? "P0",
          r.ownerName,
          date(r.deadline),
          r.statusName,
          r.comment,
          ...(r.customFields ?? []).map((f) => (f.value && f.type === "DATE" ? date(f.value) : f.value)),
        ]),
      },
    ],
  };
  if (pptx) {
    return new Response(new Uint8Array(await renderPptx(report)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="operativka-${cycle.number}.pptx"`,
      },
    });
  }
  return exportResponse(format!, await renderExport(format!, report), `operativka-${cycle.number}`);
}
