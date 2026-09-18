import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await requireSession();
  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get("unreadOnly") === "true";

  const notifications = await prisma.notification.findMany({
    where: { userId: session.userId, ...(unreadOnly ? { isRead: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const unreadCount = await prisma.notification.count({ where: { userId: session.userId, isRead: false } });

  return NextResponse.json({ notifications, unreadCount });
}
