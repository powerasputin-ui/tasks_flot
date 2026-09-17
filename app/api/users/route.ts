import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canManageReferenceData } from "@/lib/permissions";
import { hashPassword } from "@/lib/auth";
import { z } from "zod";

export async function GET() {
  await requireSession();
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ users });
}

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Минимум 8 символов"),
  role: z.enum(["RESPONSIBLE", "CURATOR", "MANAGER"]),
});

/**
 * Раздел 34 ТЗ: self-signup отсутствует, пользователей создаёт администратор.
 * В MVP роль "администратор" не выделена отдельно — используем Куратора
 * (единственная роль с правами на управление справочными данными, раздел 36).
 */
export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!canManageReferenceData(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
      role: parsed.data.role,
    },
    select: { id: true, name: true, email: true, role: true },
  });

  return NextResponse.json({ user }, { status: 201 });
}
