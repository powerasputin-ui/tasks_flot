import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, verifyPassword, DUMMY_PASSWORD_HASH, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

const WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const { email, password } = parsed.data;

  // перебор пароля: за 15 минут не больше 10 попыток на связку «адрес + логин», 100 с одного адреса и 60 на один логин
  const ip = clientIp(request);
  const acctKey = `login:acct:${ip}:${email.toLowerCase()}`;
  // третий лимит — на сам логин при любом адресе: подставленный X-Forwarded-For не даёт перебирать пароль без конца
  const limited =
    (await enforceRateLimit(`login:ip:${ip}`, 100, WINDOW_MS, "попыток входа")) ??
    (await enforceRateLimit(acctKey, 10, WINDOW_MS, "попыток входа")) ??
    (await enforceRateLimit(`login:any:${email.toLowerCase()}`, 60, WINDOW_MS, "попыток входа"));
  if (limited) return limited;

  const user = await prisma.user.findUnique({ where: { email } });

  // пароль сверяется всегда (у несуществующего логина — с пустышкой): по времени ответа нельзя понять, есть ли такой пользователь
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !user.isActive || !valid) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }
  await prisma.rateLimit.deleteMany({ where: { key: acctKey } }); // верный вход сбрасывает счётчик неудач этой связки

  const token = await createSessionToken({ userId: user.id, role: user.role, email: user.email });

  const response = NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
  response.cookies.set("viewas", "", { path: "/", maxAge: 0 }); // чужой режим просмотра не должен пережить новый вход
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
