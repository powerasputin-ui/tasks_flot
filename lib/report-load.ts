import { prisma } from "@/lib/prisma";
import { getDicts } from "@/lib/dictionaries";
import { loadTableRows } from "@/lib/table-view";
import { buildFinalModel, buildReport, type ReportModel } from "@/lib/report";
import { DEFAULT_DIRECTORATE, DEFAULT_TEMPLATE_ID, reportConfigSchema, systemTemplate, type ReportConfig } from "@/lib/report-config";
import { canViewTemplate } from "@/lib/report-templates";
import { directorateName } from "@/lib/directorates";
import { requireDirectorate } from "@/lib/scope";
import type { Actor } from "@/lib/permissions";

/** Название дирекции для шапки отчёта. */
export async function loadDirectorateName(directorateId: string | null | undefined): Promise<string> {
  return (await directorateName(directorateId)) ?? DEFAULT_DIRECTORATE;
}

export type ConfigInput = { templateId?: string; config?: unknown };

/**
 * Конфиг из запроса: свой (проверяется схемой), шаблон из коробки (sys:…) или сохранённый шаблон из базы
 * (виден владельцу и всем, если общий). По умолчанию — «Оперативка по дирекции».
 */
export async function resolveReportConfig(actor: Actor, input: ConfigInput): Promise<{ ok: true; config: ReportConfig } | { ok: false; status: number }> {
  if (input.config !== undefined) {
    const parsed = reportConfigSchema.safeParse(input.config);
    return parsed.success ? { ok: true, config: parsed.data } : { ok: false, status: 400 };
  }
  const id = input.templateId ?? DEFAULT_TEMPLATE_ID;
  const sys = systemTemplate(id);
  if (sys) return { ok: true, config: sys.config };
  const tpl = await prisma.reportTemplate.findUnique({ where: { id } });
  if (!tpl || !canViewTemplate(actor, tpl)) return { ok: false, status: 404 };
  const parsed = reportConfigSchema.safeParse(tpl.config);
  return parsed.success ? { ok: true, config: parsed.data } : { ok: false, status: 400 };
}

/** Отчёт по живым данным (текущие неархивные позиции). */
export async function buildLiveReport(actor: Actor, config: ReportConfig): Promise<ReportModel> {
  const directorateId = requireDirectorate(actor);
  const [rows, dicts, directorate] = await Promise.all([loadTableRows("active", directorateId), getDicts(), loadDirectorateName(directorateId)]);
  const customColumns = dicts.customColumns.filter((c) => c.directorateId === directorateId).map((c) => ({ id: c.id, name: c.name, type: c.type }));
  return buildReport(rows, config, { directorate, generatedAt: new Date(), customColumns });
}

/** Отчёт по финальной оперативке (доступен и руководству). */
export async function buildFinalReport(cycle: { snapshot: unknown; finalizedAt: Date | null; number: number; directorateId?: string | null }, config: ReportConfig): Promise<ReportModel> {
  return buildFinalModel(cycle, config, await loadDirectorateName(cycle.directorateId));
}
