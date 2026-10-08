/** Шкала привлекательности: код → пояснение (используется в интерфейсе и в поиске). */
export const ATTRACTIVENESS_LABEL: Record<string, string> = {
  P100: "Высокое",
  P70: "Выше среднего",
  P50: "Среднее",
  P10: "Низкое",
  P0: "Отсутствует",
};

/** Те же слова в женском роде — для фраз вида «привлекательность высокая» (справка). */
export const ATTRACTIVENESS_LABEL_F: Record<string, string> = {
  P100: "высокая",
  P70: "выше среднего",
  P50: "средняя",
  P10: "низкая",
  P0: "отсутствует",
};

/**
 * Код шкалы для значения: сам код (P70) или слово, в которое админ переименовал значение («Выше среднего» → P70).
 * null — своё значение вне шкалы.
 */
export function attractivenessCode(name: string | null | undefined): string | null {
  if (!name) return null;
  if (/^P\d+$/i.test(name)) return name.toUpperCase();
  const n = name.trim().toLocaleLowerCase("ru");
  const hit = Object.entries(ATTRACTIVENESS_LABEL).find(([, w]) => w.toLocaleLowerCase("ru") === n) ?? Object.entries(ATTRACTIVENESS_LABEL_F).find(([, w]) => w === n);
  return hit ? hit[0] : null;
}

/** Место в шкале для сортировки: P100 > P70 > … > P0; значения вне шкалы — после шкалы (-1). */
export function attractivenessRank(name: string | null | undefined): number | null {
  if (!name) return null;
  const code = attractivenessCode(name);
  return code ? Number(code.slice(1)) : -1;
}

/** Слово для значения шкалы (P70 → «Выше среднего»); своё значение, которого нет в шкале, показываем как есть. */
export function attractivenessText(name: string | null | undefined): string {
  const code = name ?? "P0";
  return ATTRACTIVENESS_LABEL[code] ?? code;
}
