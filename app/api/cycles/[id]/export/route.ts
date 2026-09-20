import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { exportResponse, parseExportFormat, renderExport } from "@/lib/export";

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
};

// Выгрузка финальной оперативки из неизменяемого снимка (Excel / PDF / CSV). Доступна всем ролям, включая руководство.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireActor();
  const { id } = await params;
  const format = parseExportFormat(new URL(request.url).searchParams.get("format"));
  if (!format) return NextResponse.json({ error: "INVALID_FORMAT" }, { status: 400 });
  const cycle = await prisma.cycle.findFirst({ where: { id, status: "FINAL" } });
  if (!cycle) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const rows = (cycle.snapshot ?? []) as unknown as SnapRow[];
  const date = (v: string | null) => (v ? new Date(v).toLocaleDateString("ru-RU") : null);
  const body = await renderExport(format, {
    title: `Оперативка №${cycle.number}`,
    subtitle: `Зафиксирована ${date(cycle.finalizedAt?.toISOString() ?? null)} · позиций: ${rows.length}`,
    sections: [
      {
        title: "Позиции",
        headers: ["Сегмент", "Трек", "Название", "Оценка $", "Привлекательность", "Ответственный", "Срок", "Статус", "Комментарий"],
        rows: rows.map((r) => [r.segmentName, r.trackName, r.name, r.cost, r.attractivenessName ?? "P0", r.ownerName, date(r.deadline), r.statusName, r.comment]),
      },
    ],
  });
  return exportResponse(format, body, `operativka-${cycle.number}`);
}
