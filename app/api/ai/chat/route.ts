import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { AiError, aiBudget, buildContextInfo, chatSystem, fitHistory, streamText, type ChatMessage } from "@/lib/ai";
import { aiErrorResponse, canUseAi, loadEffectiveAiConfig, loadLatestMemoIds, loadMemosForAi, withAiFallback } from "@/lib/ai-server";
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
    const cfg = await loadEffectiveAiConfig(actor.id);
    if (!cfg) throw new AiError("NOT_CONFIGURED", "ИИ не подключён: попросите администратора подключить его для всех или вставьте свой ключ в настройках ИИ.");
    const requested = Array.isArray(b?.versionIds) && b!.versionIds.length > 0;
    const memos = await loadMemosForAi(actor, requested ? b?.versionIds : await loadLatestMemoIds(actor));
    if (memos.length === 0) return NextResponse.json({ error: "NO_CONTEXT", message: "Отправленных справок пока нет — отвечать не по чему." }, { status: 400 });
    const fullLength = buildContextInfo(memos).text.length;
    const { stream, trimmed } = await withAiFallback(cfg, fullLength, async (c) => {
      const budget = aiBudget(c);
      const ctx = buildContextInfo(memos, budget.contextChars);
      const st = await streamText(c, { system: chatSystem(ctx.text), messages: fitHistory(messages, budget.historyChars), maxTokens: budget.chatOut, signal: request.signal });
      return { stream: st, trimmed: ctx.trimmed };
    });
    // ИИ видел справки не целиком — чат покажет это человеку
    const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
    if (trimmed) headers["X-AI-Context"] = trimmed;
    return new Response(stream, { headers });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

export const POST = withApiErrors(POSTHandler);
