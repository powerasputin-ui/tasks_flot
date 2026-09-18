import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { updateCommentSchema } from "@/lib/validation";

// Раздел 32: комментарий редактирует и удаляет только его автор.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const existing = await prisma.comment.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (existing.authorId !== session.userId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateCommentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.comment.update({
    where: { id },
    data: { text: parsed.data.text },
    include: { author: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ comment: updated });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const existing = await prisma.comment.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (existing.authorId !== session.userId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  await prisma.comment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
