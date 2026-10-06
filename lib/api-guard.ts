import { NextResponse } from "next/server";
import { AuthError } from "@/lib/session";
import { ScopeError } from "@/lib/scope";

/**
 * Обёртка обработчиков API: ошибки доступа, которые бросают requireActor/requireDirectorate, превращаются в понятные
 * ответы (401 «войдите заново» / 403 «нет дирекции»), а не в 500. Остальные ошибки пробрасываются как раньше.
 */
/** Ответ API дольше этого пишется в журнал (кроме ИИ это всегда признак проблемы). */
const SLOW_API_MS = 3000;

export function withApiErrors<A extends unknown[]>(handler: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const t = Date.now();
    const req = args[0] instanceof Request ? args[0] : null;
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof AuthError) {
        if (e.message === "NO_DIRECTORATE") return NextResponse.json({ error: "NO_DIRECTORATE" }, { status: 403 });
        // дирекцию отключили — сессия больше не действует: человек попадает на вход и видит причину
        return NextResponse.json({ error: e.message === "DIRECTORATE_DISABLED" ? "DIRECTORATE_DISABLED" : "UNAUTHENTICATED" }, { status: 401 });
      }
      if (e instanceof ScopeError) return NextResponse.json({ error: "NO_DIRECTORATE" }, { status: 403 });
      throw e;
    } finally {
      // диагностика зависаний: медленный ответ API — в журнал Vercel с номером запроса (x-vercel-id), чтобы сверить с замером
      const ms = Date.now() - t;
      if (ms > SLOW_API_MS && req) console.warn(`[api-slow] ${req.method} ${new URL(req.url).pathname} ${ms} мс id=${req.headers.get("x-vercel-id") ?? "-"}`);
    }
  };
}
