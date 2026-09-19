import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canManageDirectory } from "@/lib/permissions";
import { departmentSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  const session = await requireSession();
  // Неактивные отделы (нужны админу в настройках) — только с ?all=1 и правом управления.
  const all = new URL(request.url).searchParams.get("all") === "1" && canManageDirectory(session.role);
  const departments = await prisma.department.findMany({
    where: all ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ departments });
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!canManageDirectory(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const parsed = departmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });

  if (await prisma.department.findUnique({ where: { name: parsed.data.name } })) {
    return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });
  }
  const department = await prisma.department.create({ data: parsed.data });
  return NextResponse.json({ department }, { status: 201 });
}
