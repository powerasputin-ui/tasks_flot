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

/** Слово для значения шкалы (P70 → «Выше среднего»); своё значение, которого нет в шкале, показываем как есть. */
export function attractivenessText(name: string | null | undefined): string {
  const code = name ?? "P0";
  return ATTRACTIVENESS_LABEL[code] ?? code;
}
