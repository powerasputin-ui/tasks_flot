/** Подписи полей позиции для журнала и ленты изменений. */
export const FIELD_LABEL: Record<string, string> = {
  title: "Задача",
  cost: "Оценка $",
  comment: "Комментарий",
  segmentId: "Сегмент",
  trackId: "Трек",
  attractivenessId: "Внимание",
  responsibleId: "Ответственный",
  deadline: "Дедлайн",
  statusId: "Статус",
  operFlag: "Оперативка",
  files: "Файлы",
  expectedResult: "Ожидаемый результат",
};

/** События трекера в журнале (действия, запросы ЗГД, переносы): fieldName → что сделано. */
const TRACKER_EVENT: Record<string, string> = {
  "workflow:submit": "сдал(а) на проверку",
  "workflow:accept": "принял(а) задачу",
  "workflow:return": "вернул(а) на доработку",
  "workflow:block": "отметил(а) блокер",
  "workflow:unblock": "снял(а) блок",
  "workflow:cancel": "отменил(а) задачу",
  "workflow:reopen": "переоткрыл(а) задачу",
  deadlineReason: "указал(а) причину переноса срока",
  deadlineRequest: "попросил(а) перенести срок",
  zgdControl: "изменил(а) контроль ЗГД",
  zgdRequest: "запросил(а) статус (ЗГД)",
  zgdAnswer: "ответил(а) на запрос ЗГД",
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
    case "zgdControl":
      return value === "true" ? "на контроле" : "снят с контроля";
    default:
      return value;
  }
}

/** Событие трекера (действие, запрос ЗГД, перенос) — описывается словами, а не «изменил поле». */
export const isTrackerEvent = (field: string) => field in TRACKER_EVENT;

export function describeAuditAction(action: string, field: string | null): string {
  if (field && TRACKER_EVENT[field]) return TRACKER_EVENT[field];
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

/** Длиннее этого значение в журнале показывается блоками «Было / Стало», а не в одну строку со стрелкой. */
export const LONG_CHANGE_THRESHOLD = 40;

export function isLongChange(before: string | null, after: string | null): boolean {
  const long = (v: string | null) => !!v && (v.length > LONG_CHANGE_THRESHOLD || v.includes("\n"));
  return long(before) || long(after);
}

/** Обрезает длинный текст с многоточием (для ленты изменений: полный текст остаётся в журнале позиции). */
export function clipText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}
