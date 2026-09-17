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

export const referenceItemSchema = z.object({
  name: z.string().min(1),
  color: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});
