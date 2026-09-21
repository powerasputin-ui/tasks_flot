import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canManageDirectory, canManageUser, canManageUsers } from "@/lib/permissions";
import { hashPassword } from "@/lib/auth";
import { ROLES } from "@/lib/validation";
import { listDirectorates } from "@/lib/directorates";

// Читают все (списки ответственных); e-mail и неактивные — только админу.
export async function GET(request: NextRequest) {
  const session = await requireFreshSession();
  const admin = canManageDirectory(session.role);
  const manager = canManageUsers(session.role);
  const all = manager && new URL(request.url).searchParams.get("all") === "1";
  // админ для режима «Посмотреть как» просит людей всех дирекций
  const everywhere = all && (admin || session.role === "ADMIN") && new URL(request.url).searchParams.get("everywhere") === "1";
  // Куратор в настройках видит «ответственных»: руководителей (ведёт их) и кураторов (у них права руководителя тоже есть; их ведёт администратор).
  // Свои люди дирекции. Админ дополнительно видит тех, кто ни в какой дирекции не состоит (ЗГД, админы без дирекции).
  const inDir = { directorateId: session.directorateId ?? "" };
  const seesAllPeople = admin || session.role === "ADMIN";
  const users = await prisma.user.findMany({
    where: everywhere
      ? {}
      : all
      ? seesAllPeople
        ? { OR: [inDir, { directorateId: null }] }
        : { ...inDir, role: { in: ["HEAD", "DIRECTOR", "ADMIN"] } }
      : { isActive: true, ...inDir },
    select: { id: true, name: true, role: true, isActive: true, directorateId: true, ...(manager ? { email: true } : {}) },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ users });
}

const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Минимум 8 символов"),
  role: z.enum(ROLES),
  /** Только админ: дирекция нового человека (по умолчанию — выбранная им сейчас). У директора всегда своя. */
  directorateId: z.string().nullable().optional(),
});

/** Самостоятельной регистрации нет: пользователей создаёт SYSTEM_ADMIN и назначает роль. */
export async function POST(request: NextRequest) {
  const session = await requireFreshSession();
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const parsed = createUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });

  if (!canManageUser({ id: session.userId, role: session.role }, parsed.data.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (await prisma.user.findUnique({ where: { email: parsed.data.email } })) {
    return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });
  }
  const { password, directorateId: requested, ...rest } = parsed.data;
  // ЗГД дирекции не имеет; остальным дирекция обязательна. Директор создаёт людей только в своей дирекции.
  const isAdminActor = session.role === "ADMIN" || session.role === "SYSTEM_ADMIN";
  let directorateId: string | null = null;
  if (rest.role !== "EXECUTIVE") {
    directorateId = isAdminActor ? (requested ?? session.directorateId) : session.directorateId;
    if (!directorateId || !(await listDirectorates()).some((d) => d.id === directorateId && d.isActive)) {
      return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    }
  }
  const user = await prisma.user.create({
    data: { ...rest, directorateId, passwordHash: await hashPassword(password) },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  invalidateDicts();
  return NextResponse.json({ user }, { status: 201 });
}
