import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { AI_DEFAULTS, complete, normalizeBaseUrl, type AiConfig } from "@/lib/ai";
import { aiErrorResponse, canUseAi, loadAiConfig } from "@/lib/ai-server";
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
    const saved = await loadAiConfig(actor.id);
    const provider = b?.provider === "openai" || b?.provider === "anthropic" ? b.provider : saved?.provider;
    if (!provider) return NextResponse.json({ error: "INVALID_INPUT", message: "Выберите тип подключения." }, { status: 400 });
    const baseUrl = normalizeBaseUrl(b?.baseUrl ?? saved?.baseUrl ?? "", provider);
    if (!baseUrl) return NextResponse.json({ error: "INVALID_INPUT", message: "Адрес API недопустим: нужен http:// или https:// и внешний адрес провайдера." }, { status: 400 });
    const apiKey = b?.apiKey?.trim() || saved?.apiKey;
    if (!apiKey) return NextResponse.json({ error: "INVALID_INPUT", message: "Вставьте ключ API." }, { status: 400 });
    const cfg: AiConfig = { provider, baseUrl, model: b?.model?.trim() || saved?.model || AI_DEFAULTS[provider].model, apiKey };
    const started = Date.now();
    await complete(cfg, { system: "Ты проверка связи.", messages: [{ role: "user", content: "Ответь одним словом: ок" }], maxTokens: 16, signal: AbortSignal.timeout(20000) });
    return NextResponse.json({ ok: true, ms: Date.now() - started, model: cfg.model });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

export const POST = withApiErrors(POSTHandler);
