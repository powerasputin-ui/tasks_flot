export type ColumnType = "TEXT" | "NUMBER" | "DATE" | "SELECT";
export type ColumnDef = { id: string; name: string; type: ColumnType; options: string[] };

export const COLUMN_TYPE_LABEL: Record<ColumnType, string> = {
  TEXT: "Текст",
  NUMBER: "Число",
  DATE: "Дата",
  SELECT: "Список",
};

const MAX_TEXT = 500;

/** Префикс, под которым значение своей колонки попадает в журнал изменений: custom:<id колонки>. */
export const CUSTOM_FIELD_PREFIX = "custom:";

export type CustomValuesResult = { ok: true; values: Record<string, string> } | { ok: false; error: string };

/**
 * Проверяет значения своих колонок и сливает их с уже сохранёнными.
 * Пустая строка убирает значение. Неизвестные (или удалённые) колонки отклоняются.
 */
export function mergeCustomValues(columns: ColumnDef[], existing: Record<string, string>, patch: Record<string, string>): CustomValuesResult {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const values = { ...existing };
  for (const [id, raw] of Object.entries(patch)) {
    const col = byId.get(id);
    if (!col) return { ok: false, error: `Неизвестная колонка: ${id}` };
    const v = raw.trim();
    if (v === "") {
      delete values[id];
      continue;
    }
    if (v.length > MAX_TEXT) return { ok: false, error: `«${col.name}»: не длиннее ${MAX_TEXT} символов` };
    if (col.type === "NUMBER" && !/^-?\d+([.,]\d+)?$/.test(v)) return { ok: false, error: `«${col.name}»: нужно число` };
    if (col.type === "DATE" && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(v).getTime()))) return { ok: false, error: `«${col.name}»: нужна дата` };
    if (col.type === "SELECT" && !col.options.includes(v)) return { ok: false, error: `«${col.name}»: значения нет в списке` };
    values[id] = v;
  }
  return { ok: true, values };
}

/** Значения своих колонок как плоские поля custom:<id> — для сравнения «было → стало» в журнале. */
export function flattenCustom(values: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (values && typeof values === "object") {
    for (const [k, v] of Object.entries(values as Record<string, unknown>)) out[`${CUSTOM_FIELD_PREFIX}${k}`] = String(v);
  }
  return out;
}

/** Разбирает варианты списка из строки «А, Б, В» (по запятым и переводам строк, без дублей). */
export function parseOptions(input: string): string[] {
  return [...new Set(input.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
}
