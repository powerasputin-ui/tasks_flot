import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export async function POST() {
  const session = await requireSession();
  await prisma.notification.updateMany({
    where: { userId: session.userId, isRead: false },
    data: { isRead: true },
  });
  return NextResponse.json({ ok: true });
}
