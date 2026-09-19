/** Подписи полей позиции для журнала и ленты изменений. */
export const FIELD_LABEL: Record<string, string> = {
  title: "Название",
  cost: "Оценка $",
  comment: "Комментарий",
  segmentId: "Сегмент",
  trackId: "Трек",
  attractivenessId: "Привлекательность",
  responsibleId: "Ответственный",
  deadline: "Срок",
  statusId: "Статус",
  operFlag: "Опер",
};

/** Справочники «id → имя» для подстановки в значения журнала (в журнале хранятся id). */
export type NameMaps = Partial<Record<"segmentId" | "trackId" | "attractivenessId" | "statusId" | "responsibleId", Map<string, string>>>;

/** Человекочитаемое значение поля из журнала; null/пусто → «—». */
export function formatAuditValue(field: string | null, value: string | null, maps: NameMaps = {}): string {
  if (value === null || value === "") return "—";
  switch (field) {
    case "segmentId":
    case "trackId":
    case "attractivenessId":
    case "statusId":
    case "responsibleId":
      return maps[field]?.get(value) ?? "—";
    case "deadline":
      return new Date(value).toLocaleDateString("ru-RU");
    case "operFlag":
      return value === "true" ? "да" : "нет";
    default:
      return value;
  }
}

export function describeAuditAction(action: string, field: string | null): string {
  if (field) return `изменил(а) «${FIELD_LABEL[field] ?? field}»`;
  switch (action) {
    case "CREATE":
      return "создал(а) позицию";
    case "ARCHIVE":
      return "отправил(а) в архив";
    case "RESTORE":
      return "вернул(а) из архива";
    default:
      return action;
  }
}
