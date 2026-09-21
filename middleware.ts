import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { blockedInViewOnly } from "@/lib/view-only";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];
// Статические файлы из public (логотип и т.п.) нужны и на странице входа.
const STATIC_FILE = /\.(svg|png|jpe?g|webp|ico|woff2?)$/i;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p) || pathname.startsWith("/_next") || STATIC_FILE.test(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // В режиме «Посмотреть как» (кука viewas) любые изменения запрещены (разрешённые исключения — lib/view-only.ts).
  if (request.cookies.get("viewas")?.value && blockedInViewOnly(request.method, pathname)) {
    return NextResponse.json({ error: "VIEW_ONLY", message: "Режим просмотра: изменения отключены." }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
