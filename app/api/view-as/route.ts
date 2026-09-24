import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRealActor } from "@/lib/session";
import { canViewAs } from "@/lib/permissions";
import { VIEW_AS_COOKIE } from "@/lib/directorates";
import { withApiErrors } from "@/lib/api-guard";

const schema = z.object({ userId: z.string().min(1).nullable() });

// Включить или выключить режим «Посмотреть как». Решает настоящая роль человека за сессией (не просматриваемая).
async function POSTHandler(request: NextRequest) {
  const real = await requireRealActor();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const res = NextResponse.json({ ok: true });
  if (parsed.data.userId === null) {
    res.cookies.set(VIEW_AS_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }
  const target = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, role: true, directorateId: true, isActive: true } });
  if (!target || !canViewAs(real, target)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  // сессионная кука: режим не переживает закрытие браузера
  res.cookies.set(VIEW_AS_COOKIE, target.id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  return res;
}

export const POST = withApiErrors(POSTHandler);
