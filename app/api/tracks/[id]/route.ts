import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canManageDirectory } from "@/lib/permissions";
import { trackSchema } from "@/lib/validation";

// Треки не удаляются физически: isActive=false (на них ссылаются позиции).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!canManageDirectory(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;

  const parsed = trackSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  if (!(await prisma.track.findUnique({ where: { id } }))) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const track = await prisma.track.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ track });
}
