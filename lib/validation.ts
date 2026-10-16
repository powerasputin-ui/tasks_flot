import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export const referenceItemSchema = z.object({
  name: z.string().min(1),
  color: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

/**
 * Дата срока / ожидания / ответа: разумные границы. Год 9999 или опечатка «20266» не должны попадать в базу:
 * таймлайн и сводки растянулись бы на миллионы дней и повесили бы страницу у всех, кто её открывает.
 */
export const MIN_DATE = new Date("2000-01-01T00:00:00.000Z");
export const MAX_DATE = new Date("2100-12-31T23:59:59.999Z");
export const sensibleDate = z.coerce.date().min(MIN_DATE, "Дата вне допустимого диапазона (2000–2100)").max(MAX_DATE, "Дата вне допустимого диапазона (2000–2100)");

const idOrNull = z.string().min(1).nullable().optional();
const textOrNull = z.string().nullable().optional();
// Длинные «простыни» ломают журнал и выгрузки: комментарий до 2000 символов, задача до 300.
const commentOrNull = z.string().max(2000, "Комментарий не длиннее 2000 символов").nullable().optional();

// Позиция оперативки (TZ_v4, раздел 3). Название обязательно; остальное — по мере заполнения.
export const createItemSchema = z.object({
  title: z.string().trim().min(1, "Название обязательно").max(300, "Задача не длиннее 300 символов"),
  segmentId: idOrNull,
  trackId: idOrNull,
  cost: z.string().max(200, "Оценка — не длиннее 200 символов").nullable().optional(),
  attractivenessId: idOrNull,
  responsibleId: idOrNull,
  deadline: sensibleDate.nullable().optional(),
  statusId: idOrNull,
  comment: commentOrNull,
  operFlag: z.boolean().optional(),
  expectedResult: z.string().max(2000, "Ожидаемый результат — не длиннее 2000 символов").nullable().optional(),
  deadlineReason: z.string().max(500).optional(),
  // значения своих колонок: { <id колонки>: значение } (проверка типа — на сервере, lib/custom-columns)
  customValues: z.record(z.string(), z.string()).optional(),
  // ссылки на файлы общего диска: [{ id?, path }] (разбор и проверка пути — lib/item-files)
  files: z.array(z.object({ id: z.string().max(80).optional(), path: z.string().max(700) })).max(10, "Можно прикрепить не больше 10 файлов").optional(),
});

// version обязателен: оптимистическая блокировка (409 при конфликте).
export const updateItemSchema = createItemSchema
  .partial()
  .extend({ version: z.number().int().min(1) })
  .refine((v) => v.title === undefined || v.title.length > 0, { message: "Название обязательно", path: ["title"] });

export const trackSchema = z.object({
  name: z.string().trim().min(1),
  segmentId: idOrNull,
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const ROLES = ["HEAD", "DIRECTOR", "EXECUTIVE", "ADMIN", "SYSTEM_ADMIN"] as const;
