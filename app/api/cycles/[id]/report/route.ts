import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canViewFinalCycle } from "@/lib/scope";
import { buildFinalReport, resolveReportConfig } from "@/lib/report-load";

// Отчёт по ФИНАЛЬНОЙ оперативке из неизменяемого снимка. Доступен всем ролям, включая руководство (только финалы).
// Тело: { templateId?, config? } — как у /api/report.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const cycle = await prisma.cycle.findFirst({ where: { id, status: "FINAL" } });
  if (!cycle || !canViewFinalCycle(actor, cycle)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { templateId?: string; config?: unknown };
  const resolved = await resolveReportConfig(actor, body);
  if (!resolved.ok) return NextResponse.json({ error: resolved.status === 404 ? "NOT_FOUND" : "INVALID_INPUT" }, { status: resolved.status });
  return NextResponse.json({ model: await buildFinalReport(cycle, resolved.config) });
}
