import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { AI_DEFAULTS, AiError, decryptKey, encryptKey, keyHint, normalizeBaseUrl, type AiProvider } from "@/lib/ai";
import { canUseAi } from "@/lib/ai-server";
import { withApiErrors } from "@/lib/api-guard";

const forbidden = () => NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

// Подключение ИИ у ЗГД. Ключ наружу не отдаётся: только «подключено» и последние 4 символа.
async function GETHandler() {
  const actor = await requireActor();
  if (!canUseAi(actor)) return forbidden();
  const s = await prisma.aiSetting.findUnique({ where: { userId: actor.id } });
  if (!s) return NextResponse.json({ configured: false, defaults: AI_DEFAULTS });
  let hint = "…";
  try {
    hint = keyHint(decryptKey(s.apiKeyEnc));
  } catch {
    /* ключ нечитаем — покажем «…», человек введёт заново */
  }
  return NextResponse.json({ configured: true, provider: s.provider, baseUrl: s.baseUrl, model: s.model, keyHint: hint, defaults: AI_DEFAULTS });
}

async function PUTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!canUseAi(actor)) return forbidden();
  const b = (await request.json().catch(() => null)) as { provider?: string; baseUrl?: string; model?: string; apiKey?: string } | null;
  const provider: AiProvider | null = b?.provider === "openai" || b?.provider === "anthropic" ? b.provider : null;
  if (!provider) return NextResponse.json({ error: "INVALID_INPUT", message: "Выберите тип подключения." }, { status: 400 });
  const baseUrl = normalizeBaseUrl(b?.baseUrl ?? "", provider);
  if (!baseUrl) return NextResponse.json({ error: "INVALID_INPUT", message: "Адрес API недопустим: нужен http:// или https:// и внешний адрес провайдера." }, { status: 400 });
  const model = (b?.model ?? "").trim() || AI_DEFAULTS[provider].model;
  const key = (b?.apiKey ?? "").trim();
  try {
    const existing = await prisma.aiSetting.findUnique({ where: { userId: actor.id } });
    if (!key && !existing) return NextResponse.json({ error: "INVALID_INPUT", message: "Вставьте ключ API." }, { status: 400 });
    const apiKeyEnc = key ? encryptKey(key) : existing!.apiKeyEnc;
    await prisma.aiSetting.upsert({
      where: { userId: actor.id },
      create: { userId: actor.id, provider, baseUrl, model, apiKeyEnc },
      update: { provider, baseUrl, model, apiKeyEnc },
    });
  } catch (e) {
    if (e instanceof AiError) return NextResponse.json({ error: e.code, message: e.message }, { status: 500 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}

async function DELETEHandler() {
  const actor = await requireActor();
  if (!canUseAi(actor)) return forbidden();
  await prisma.aiSetting.deleteMany({ where: { userId: actor.id } });
  return NextResponse.json({ ok: true });
}

export const GET = withApiErrors(GETHandler);
export const PUT = withApiErrors(PUTHandler);
export const DELETE = withApiErrors(DELETEHandler);
