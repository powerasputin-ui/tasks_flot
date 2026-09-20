import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const referenceItemSchema = z.object({
  name: z.string().min(1),
  color: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const idOrNull = z.string().min(1).nullable().optional();
const textOrNull = z.string().nullable().optional();

// Позиция оперативки (TZ_v4, раздел 3). Название обязательно; остальное — по мере заполнения.
export const createItemSchema = z.object({
  title: z.string().trim().min(1, "Название обязательно"),
  segmentId: idOrNull,
  trackId: idOrNull,
  cost: textOrNull,
  attractivenessId: idOrNull,
  responsibleId: idOrNull,
  deadline: z.coerce.date().nullable().optional(),
  statusId: idOrNull,
  comment: textOrNull,
  operFlag: z.boolean().optional(),
  // значения своих колонок: { <id колонки>: значение } (проверка типа — на сервере, lib/custom-columns)
  customValues: z.record(z.string(), z.string()).optional(),
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

export const ROLES = ["HEAD", "CURATOR", "MANAGEMENT", "SYSTEM_ADMIN"] as const;
