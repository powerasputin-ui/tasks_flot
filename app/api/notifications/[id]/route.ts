import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { z } from "zod";

const patchSchema = z.object({ isRead: z.boolean() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const existing = await prisma.notification.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (existing.userId !== session.userId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const updated = await prisma.notification.update({ where: { id }, data: { isRead: parsed.data.isRead } });
  return NextResponse.json({ notification: updated });
}
