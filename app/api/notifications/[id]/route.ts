import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { z } from "zod";
import { withApiErrors } from "@/lib/api-guard";

const patchSchema = z.object({ isRead: z.boolean() });

async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const existing = await prisma.notification.findUnique({ where: { id } });
  // чужое уведомление «не существует»: по ответу нельзя узнать, есть ли оно вообще
  if (!existing || existing.userId !== session.userId) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const updated = await prisma.notification.update({ where: { id }, data: { isRead: parsed.data.isRead } });
  return NextResponse.json({ notification: updated });
}

export const PATCH = withApiErrors(PATCHHandler);
