import { prisma } from "@/lib/prisma";
import { DEFAULT_LABEL, type StdKey } from "@/lib/table-columns";

/**
 * Подписи колонок так, как их назвал админ в «Настройки → Колонки таблицы» (например, «Срок» вместо «Дедлайн»).
 * Одни и те же названия — в таблице, фильтрах, сортировке, карточке, истории и выгрузках.
 */
export async function loadColumnLabels(directorateId: string): Promise<Record<StdKey, string>> {
  const setting = await prisma.appSetting.findUnique({ where: { key: `table.columns:${directorateId}` } });
  const saved = Array.isArray(setting?.value) ? (setting!.value as Array<{ key?: string; label?: string }>) : [];
  const out = { ...DEFAULT_LABEL };
  for (const c of saved) if (c.key && c.key in out && c.label?.trim()) out[c.key as StdKey] = c.label.trim();
  return out;
}

/** Поле журнала правок → колонка таблицы, по подписи которой его называем. */
export const AUDIT_FIELD_COLUMN: Record<string, StdKey> = {
  title: "name",
  cost: "cost",
  trackId: "track",
  attractivenessId: "attractiveness",
  responsibleId: "owner",
  deadline: "deadline",
  statusId: "status",
  comment: "comment",
  operFlag: "operFlag",
};
