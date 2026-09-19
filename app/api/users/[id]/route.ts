import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canManageDirectory } from "@/lib/permissions";
import { hashPassword } from "@/lib/auth";
import { ROLES } from "@/lib/validation";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.enum(ROLES).optional(),
  departmentId: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8, "Минимум 8 символов").optional(),
});

/** Админ назначает роль и подразделение, отключает пользователя, сбрасывает пароль. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!canManageDirectory(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  if (!(await prisma.user.findUnique({ where: { id } }))) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Админ не может лишить себя доступа: иначе управлять системой станет некому.
  if (id === session.userId && (parsed.data.isActive === false || (parsed.data.role && parsed.data.role !== "SYSTEM_ADMIN"))) {
    return NextResponse.json({ error: "CANNOT_DEMOTE_SELF" }, { status: 400 });
  }

  const { password, ...rest } = parsed.data;
  const user = await prisma.user.update({
    where: { id },
    data: { ...rest, ...(password ? { passwordHash: await hashPassword(password) } : {}) },
    select: { id: true, name: true, email: true, role: true, departmentId: true, isActive: true },
  });
  return NextResponse.json({ user });
}
