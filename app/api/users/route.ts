import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canManageDirectory } from "@/lib/permissions";
import { hashPassword } from "@/lib/auth";
import { ROLES } from "@/lib/validation";

// Читают все (списки ответственных); e-mail и неактивные — только админу.
export async function GET(request: NextRequest) {
  const session = await requireSession();
  const admin = canManageDirectory(session.role);
  const all = admin && new URL(request.url).searchParams.get("all") === "1";
  const users = await prisma.user.findMany({
    where: all ? {} : { isActive: true },
    select: { id: true, name: true, role: true, isActive: true, ...(admin ? { email: true } : {}) },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ users });
}

const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Минимум 8 символов"),
  role: z.enum(ROLES),
});

/** Самостоятельной регистрации нет: пользователей создаёт SYSTEM_ADMIN и назначает роль. */
export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!canManageDirectory(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const parsed = createUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });

  if (await prisma.user.findUnique({ where: { email: parsed.data.email } })) {
    return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });
  }
  const { password, ...rest } = parsed.data;
  const user = await prisma.user.create({
    data: { ...rest, passwordHash: await hashPassword(password) },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  return NextResponse.json({ user }, { status: 201 });
}
