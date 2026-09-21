import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireFreshSession } from "@/lib/session";
import { canCreateDirectorates } from "@/lib/permissions";
import { DIRECTORATE_COOKIE, listDirectorates } from "@/lib/directorates";

// Админ выбирает, в какой дирекции работает сейчас. Выбор хранится в куке; каждый запрос проверяет его заново.
export async function POST(request: NextRequest) {
  const session = await requireFreshSession();
  if (!canCreateDirectorates(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = z.object({ id: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  if (!(await listDirectorates()).some((d) => d.id === parsed.data.id && d.isActive)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DIRECTORATE_COOKIE, parsed.data.id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  return res;
}
