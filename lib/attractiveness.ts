/** Шкала привлекательности: код → пояснение (используется в интерфейсе и в поиске). */
export const ATTRACTIVENESS_LABEL: Record<string, string> = {
  P100: "Высокая",
  P70: "Выше среднего",
  P50: "Средняя",
  P10: "Низкая",
  P0: "Отсутствует",
};

/** Слово для значения шкалы (P70 → «Выше среднего»); своё значение, которого нет в шкале, показываем как есть. */
export function attractivenessText(name: string | null | undefined): string {
  const code = name ?? "P0";
  return ATTRACTIVENESS_LABEL[code] ?? code;
}
