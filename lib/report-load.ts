import { prisma } from "@/lib/prisma";
import { getDicts } from "@/lib/dictionaries";
import { loadTableRows } from "@/lib/table-view";
import { buildReport, type ReportModel } from "@/lib/report";
import { DEFAULT_DIRECTORATE, DEFAULT_TEMPLATE_ID, reportConfigSchema, systemTemplate, type ReportConfig } from "@/lib/report-config";

/** Название дирекции из общей настройки (позже — из выбранной при входе дирекции). */
export async function loadDirectorateName(): Promise<string> {
  const s = await prisma.appSetting.findUnique({ where: { key: "directorate.name" } });
  return typeof s?.value === "string" && s.value.trim() ? s.value : DEFAULT_DIRECTORATE;
}

export type ConfigInput = { templateId?: string; config?: unknown };

/** Конфиг из запроса: свой (проверяется схемой) или шаблон из коробки; по умолчанию — «Оперативка по дирекции». */
export function configFromInput(input: ConfigInput): { ok: true; config: ReportConfig } | { ok: false } {
  if (input.config !== undefined) {
    const parsed = reportConfigSchema.safeParse(input.config);
    return parsed.success ? { ok: true, config: parsed.data } : { ok: false };
  }
  const sys = systemTemplate(input.templateId ?? DEFAULT_TEMPLATE_ID);
  return sys ? { ok: true, config: sys.config } : { ok: false };
}

/** Отчёт по живым данным (текущие неархивные позиции). */
export async function buildLiveReport(config: ReportConfig): Promise<ReportModel> {
  const [rows, dicts, directorate] = await Promise.all([loadTableRows("active"), getDicts(), loadDirectorateName()]);
  const customColumns = dicts.customColumns.map((c) => ({ id: c.id, name: c.name, type: c.type }));
  return buildReport(rows, config, { directorate, generatedAt: new Date(), customColumns });
}
