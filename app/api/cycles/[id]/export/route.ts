import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { exportResponse, parseExportFormat, renderExport } from "@/lib/export";
import { renderPptx } from "@/lib/export-pptx";

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
  await requireActor();
  const { id } = await params;
  const formatParam = new URL(request.url).searchParams.get("format");
  const pptx = formatParam === "pptx";
  const format = pptx ? null : parseExportFormat(formatParam);
  if (!pptx && !format) return NextResponse.json({ error: "INVALID_FORMAT" }, { status: 400 });
  const cycle = await prisma.cycle.findFirst({ where: { id, status: "FINAL" } });
  if (!cycle) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

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
