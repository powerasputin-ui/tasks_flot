import { NextResponse } from "next/server";
import { AuthError } from "@/lib/session";
import { ScopeError } from "@/lib/scope";

/**
 * Обёртка обработчиков API: ошибки доступа, которые бросают requireActor/requireDirectorate, превращаются в понятные
 * ответы (401 «войдите заново» / 403 «нет дирекции»), а не в 500. Остальные ошибки пробрасываются как раньше.
 */
export function withApiErrors<A extends unknown[]>(handler: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof AuthError) {
        return NextResponse.json({ error: e.message === "NO_DIRECTORATE" ? "NO_DIRECTORATE" : "UNAUTHENTICATED" }, { status: e.message === "NO_DIRECTORATE" ? 403 : 401 });
      }
      if (e instanceof ScopeError) return NextResponse.json({ error: "NO_DIRECTORATE" }, { status: 403 });
      throw e;
    }
  };
}
