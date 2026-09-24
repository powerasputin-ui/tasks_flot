import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { AiError, buildContext, chatSystem, streamText, type ChatMessage } from "@/lib/ai";
import { aiErrorResponse, canUseAi, loadAiConfig, loadLatestMemoIds, loadMemosForAi } from "@/lib/ai-server";
import { withApiErrors } from "@/lib/api-guard";
import { enforceRateLimit } from "@/lib/rate-limit";

const MAX_MESSAGES = 20;
const MAX_MESSAGE_LEN = 4000;

// Чат ЗГД по справкам. Клиент присылает только id справок и историю вопросов: тексты справок сервер достаёт сам и только те, что человеку доступны.
async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!canUseAi(actor)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const limited = await enforceRateLimit(`ai-chat:${actor.id}`, 40, 600000, "вопросов помощнику");
  if (limited) return limited;
  const b = (await request.json().catch(() => null)) as { versionIds?: unknown; messages?: unknown } | null;
  const messages: ChatMessage[] = (Array.isArray(b?.messages) ? (b!.messages as Array<{ role?: string; content?: unknown }>) : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role as ChatMessage["role"], content: (m.content as string).slice(0, MAX_MESSAGE_LEN) }));
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return NextResponse.json({ error: "INVALID_INPUT", message: "Введите вопрос." }, { status: 400 });
  try {
    const cfg = await loadAiConfig(actor.id);
    if (!cfg) throw new AiError("NOT_CONFIGURED", "ИИ не подключён: откройте настройки ИИ и вставьте ключ.");
    const requested = Array.isArray(b?.versionIds) && b!.versionIds.length > 0;
    const memos = await loadMemosForAi(actor, requested ? b?.versionIds : await loadLatestMemoIds(actor));
    if (memos.length === 0) return NextResponse.json({ error: "NO_CONTEXT", message: "Отправленных справок пока нет — отвечать не по чему." }, { status: 400 });
    const stream = await streamText(cfg, { system: chatSystem(buildContext(memos)), messages, maxTokens: 1500, signal: request.signal });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

export const POST = withApiErrors(POSTHandler);
