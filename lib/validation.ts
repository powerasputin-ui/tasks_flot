import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createTrackSchema = z.object({
  segmentId: z.string().nullable().optional(),
  name: z.string().min(1, "Название трека обязательно"),
  description: z.string().nullable().optional(),
  attractivenessId: z.string().nullable().optional(),
  statusId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
});

export const updateTrackSchema = createTrackSchema.partial();

export const createTaskSchema = z.object({
  trackId: z.string().min(1),
  title: z.string().min(1, "Название задачи обязательно"),
  description: z.string().nullable().optional(),
  deadline: z.coerce.date().nullable().optional(),
  statusId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
});

export const updateTaskSchema = createTaskSchema.partial().omit({ trackId: true });

export const createVesselOptionSchema = z.object({
  trackId: z.string().min(1),
  name: z.string().min(1, "Название варианта судна обязательно"),
  cost: z.string().nullable().optional(),
  attractivenessId: z.string().nullable().optional(),
  statusId: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
});

export const updateVesselOptionSchema = createVesselOptionSchema.partial().omit({ trackId: true });

export const operFlagSchema = z.object({
  operFlag: z.boolean(),
});

export const ownerIdSchema = z.object({
  ownerId: z.string().nullable(),
});

export const referenceItemSchema = z.object({
  name: z.string().min(1),
  color: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

// Раздел 18-21 ТЗ: weekStart/weekEnd обязательны при создании (какую неделю
// репортим), whatDone/currentState/nextSteps/risks можно оставить пустыми в
// DRAFT — минимум обязателен только при Submit (раздел 21), проверяется отдельно.
export const createWeeklyUpdateSchema = z.object({
  trackId: z.string().min(1),
  weekStart: z.coerce.date(),
  weekEnd: z.coerce.date(),
  whatDone: z.string().nullable().optional(),
  currentState: z.string().nullable().optional(),
  nextSteps: z.string().nullable().optional(),
  risks: z.string().nullable().optional(),
  needManagerHelp: z.boolean().optional(),
});

export const updateWeeklyUpdateSchema = z.object({
  whatDone: z.string().nullable().optional(),
  currentState: z.string().nullable().optional(),
  nextSteps: z.string().nullable().optional(),
  risks: z.string().nullable().optional(),
  needManagerHelp: z.boolean().optional(),
});

// Раздел 32 ТЗ: комментарии к Track/Task/VesselOption/WeeklyUpdate.
export const createCommentSchema = z.object({
  entityType: z.enum(["Track", "Task", "VesselOption", "WeeklyUpdate"]),
  entityId: z.string().min(1),
  text: z.string().min(1, "Текст комментария обязателен"),
});

export const updateCommentSchema = z.object({
  text: z.string().min(1, "Текст комментария обязателен"),
});
