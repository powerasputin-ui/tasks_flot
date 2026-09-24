import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { invalidateActor, requireFreshSession } from "@/lib/session";
import { createNotification } from "@/lib/notifications";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageUser, canManageUsers, checkRoleChange } from "@/lib/permissions";
import { hashPassword } from "@/lib/auth";
import { ROLES } from "@/lib/validation";
import { listDirectorates } from "@/lib/directorates";
import { withApiErrors } from "@/lib/api-guard";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  /** Только админ: составитель справки для ЗГД. */
  memoEditor: z.boolean().optional(),
  password: z.string().min(8, "Минимум 8 символов").optional(),
  /** Только админ: перевести человека в другую дирекцию (нельзя, пока за ним закреплены позиции). */
  directorateId: z.string().nullable().optional(),
});

/**
 * Админ назначает любую роль, отключает пользователя, сбрасывает пароль. Куратор ведёт руководителей и, кроме того,
 * назначает руководителя куратором и снимает других кураторов (роль «руководитель ↔ куратор»).
 */
const ROLE_NAME: Record<string, string> = { HEAD: "руководитель", DIRECTOR: "директор", ADMIN: "админ", EXECUTIVE: "ЗГД", SYSTEM_ADMIN: "технический администратор" };

async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFreshSession(); // роль из базы: назначение и снятие действуют сразу
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const actor = { id: session.userId, role: session.role };

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true, directorateId: true } });
  if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // Директор видит и правит только людей своей дирекции; чужие для него «не существуют».
  const isAdminActor = session.role === "ADMIN" || session.role === "SYSTEM_ADMIN";
  if (!isAdminActor && target.directorateId !== session.directorateId) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (parsed.data.memoEditor !== undefined && !isAdminActor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (parsed.data.directorateId !== undefined) {
    if (!isAdminActor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    const to = parsed.data.directorateId;
    if (to !== target.directorateId) {
      if (to && !(await listDirectorates()).some((d) => d.id === to && d.isActive)) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
      if (await prisma.operationalItem.count({ where: { responsibleId: id, archivedAt: null } })) return NextResponse.json({ error: "HAS_ITEMS" }, { status: 409 });
    }
  }

  // Смена роли: правила — в checkRoleChange (куратор: только руководитель ↔ куратор, не себя, не последнего).
  const newRole = parsed.data.role && parsed.data.role !== target.role ? parsed.data.role : undefined;
  if (newRole) {
    const activeAdmins = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
    const err = checkRoleChange(actor, { id, role: target.role, isActive: target.isActive }, newRole, activeAdmins);
    if (err) return NextResponse.json({ error: err }, { status: err === "FORBIDDEN" ? 403 : err === "LAST_ADMIN" ? 409 : 400 });
  }
  // Имя, пароль и отключение куратор может менять только у руководителей.
  const otherFields = parsed.data.name !== undefined || parsed.data.isActive !== undefined || parsed.data.password !== undefined;
  if (otherFields && !canManageUser(actor, target.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // Админ не может лишить себя доступа: иначе управлять системой станет некому.
  if (id === session.userId && (parsed.data.isActive === false || (parsed.data.role && parsed.data.role !== target.role))) {
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
  if (newRole) {
    await createNotification({
      userId: id,
      type: "ROLE_CHANGED",
      message: `Вам изменили роль: теперь вы — ${ROLE_NAME[newRole] ?? newRole}. Обновите страницу, чтобы увидеть новое меню.`,
      link: "/table",
    });
  }
  return NextResponse.json({ user });
}

export const PATCH = withApiErrors(PATCHHandler);
