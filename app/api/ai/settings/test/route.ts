import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { AI_DEFAULTS, AiError, complete, normalizeBaseUrl, providerLabel, type AiConfig } from "@/lib/ai";
import { NOT_A_KEY_MESSAGE, aiErrorResponse, baseUrlForKey, canUseAi, loadAiConfig, looksLikeApiKey, sharedAiConfig } from "@/lib/ai-server";
import { withApiErrors } from "@/lib/api-guard";
import { enforceRateLimit } from "@/lib/rate-limit";

// Проверка связи: короткий запрос к ИИ с теми настройками, что сейчас в форме (а если ключ не вводили заново — с сохранённым).
async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!canUseAi(actor)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const limited = await enforceRateLimit(`ai-test:${actor.id}`, 10, 600000, "проверок связи");
  if (limited) return limited;
  const b = (await request.json().catch(() => null)) as { provider?: string; baseUrl?: string; model?: string; apiKey?: string } | null;
  try {
    const own = await loadAiConfig(actor.id);
    const typed = !!(b?.apiKey?.trim() || b?.baseUrl?.trim());
    // своего ключа нет и в форме ничего не ввели — проверяем общее подключение: основной и запасной по отдельности
    if (!own && !typed) {
      const shared = sharedAiConfig();
      if (!shared) return NextResponse.json({ error: "NOT_CONFIGURED", message: "ИИ не подключён: ни общего подключения, ни своего ключа." }, { status: 409 });
      const links = [shared, ...(shared.fallback ? [shared.fallback] : [])];
      const results = await Promise.all(links.map(ping));
      const okOne = results.find((r) => r.ok);
      const text = results.map((r) => (r.ok ? `${r.label}: связь есть, ${(r.ms / 1000).toFixed(1)} с` : `${r.label}: ${r.error}`)).join(" · ");
      if (!okOne) return NextResponse.json({ error: "PROVIDER", message: text }, { status: 502 });
      return NextResponse.json({ ok: true, ms: okOne.ms, model: okOne.model, details: text });
    }
    const provider = b?.provider === "openai" || b?.provider === "anthropic" ? b.provider : own?.provider;
    if (!provider) return NextResponse.json({ error: "INVALID_INPUT", message: "Выберите тип подключения." }, { status: 400 });
    // пустое поле формы = «как сохранено» (раньше пустая строка превращалась в адрес OpenAI по умолчанию)
    const apiKey = b?.apiKey?.trim() || own?.apiKey;
    if (!apiKey) return NextResponse.json({ error: "INVALID_INPUT", message: "Вставьте ключ API." }, { status: 400 });
    if (!looksLikeApiKey(apiKey)) return NextResponse.json({ error: "INVALID_INPUT", message: NOT_A_KEY_MESSAGE }, { status: 400 });
    const base = normalizeBaseUrl(b?.baseUrl?.trim() || own?.baseUrl || "", provider);
    if (!base) return NextResponse.json({ error: "INVALID_INPUT", message: "Адрес API недопустим: нужен http:// или https:// и внешний адрес провайдера." }, { status: 400 });
    const cfg: AiConfig = { provider, baseUrl: baseUrlForKey(apiKey, base), model: b?.model?.trim() || own?.model || AI_DEFAULTS[provider].model, apiKey };
    const r = await ping(cfg);
    if (!r.ok) return NextResponse.json({ error: r.code, message: r.error }, { status: r.code === "BAD_KEY" ? 401 : r.code === "RATE_LIMIT" ? 429 : 502 });
    return NextResponse.json({ ok: true, ms: r.ms, model: r.model, details: `${r.label}: связь есть` });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

/** Короткий запрос к модели. Лимит ответа с запасом: у «размышляющих» моделей рассуждения съедают маленький лимит, и ответ пустой. */
async function ping(cfg: AiConfig): Promise<{ ok: true; ms: number; model: string; label: string } | { ok: false; code: string; error: string; label: string }> {
  const label = `${providerLabel(cfg.baseUrl)} · ${cfg.model}`;
  const started = Date.now();
  try {
    await complete(cfg, { system: "Ты проверка связи.", messages: [{ role: "user", content: "Ответь одним словом: ок" }], maxTokens: 400, signal: AbortSignal.timeout(30000) });
    return { ok: true, ms: Date.now() - started, model: cfg.model, label };
  } catch (e) {
    return { ok: false, code: e instanceof AiError ? e.code : "PROVIDER", error: e instanceof AiError ? e.message : "нет ответа", label };
  }
}

export const POST = withApiErrors(POSTHandler);
