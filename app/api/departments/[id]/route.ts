import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canManageDirectory } from "@/lib/permissions";
import { departmentSchema } from "@/lib/validation";

// Подразделения не удаляются физически: isActive=false (в них могут быть позиции).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!canManageDirectory(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;

  const parsed = departmentSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });

  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (parsed.data.name && parsed.data.name !== existing.name) {
    if (await prisma.department.findUnique({ where: { name: parsed.data.name } })) {
      return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });
    }
  }
  const department = await prisma.department.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ department });
}
