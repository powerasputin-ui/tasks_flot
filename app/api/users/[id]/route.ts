import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { invalidateActor } from "@/lib/session";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canManageUser, canManageUsers } from "@/lib/permissions";
import { hashPassword } from "@/lib/auth";
import { ROLES } from "@/lib/validation";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8, "Минимум 8 символов").optional(),
});

/** Админ назначает роль, отключает пользователя, сбрасывает пароль. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const actor = { id: session.userId, role: session.role };

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // Куратор правит только ответственных (HEAD) и не назначает роли.
  if (!canManageUser(actor, target.role) || (parsed.data.role && !canManageUser(actor, parsed.data.role))) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // Админ не может лишить себя доступа: иначе управлять системой станет некому.
  if (id === session.userId && (parsed.data.isActive === false || (parsed.data.role && parsed.data.role !== "SYSTEM_ADMIN"))) {
    return NextResponse.json({ error: "CANNOT_DEMOTE_SELF" }, { status: 400 });
  }

  const { password, ...rest } = parsed.data;
  const user = await prisma.user.update({
    where: { id },
    data: { ...rest, ...(password ? { passwordHash: await hashPassword(password) } : {}) },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  invalidateDicts();
  invalidateActor(id);
  return NextResponse.json({ user });
}
