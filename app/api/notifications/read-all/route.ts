import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api-guard";

async function POSTHandler() {
  const session = await requireSession();
  await prisma.notification.updateMany({
    where: { userId: session.userId, isRead: false },
    data: { isRead: true },
  });
  return NextResponse.json({ ok: true });
}

export const POST = withApiErrors(POSTHandler);
