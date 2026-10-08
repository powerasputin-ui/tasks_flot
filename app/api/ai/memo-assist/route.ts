import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { AiError, aiBudget, complete, fitHistory, streamText, type ChatMessage } from "@/lib/ai";
import { aiErrorResponse, chainForEngine, loadEffectiveAiConfig, modelLabel, parseEngine, withAiFallback } from "@/lib/ai-server";
import { canEditMemo, loadMemo } from "@/lib/memo-load";
import { cleanVariant, memoAssistContext, memoAssistSystem, newNumbers, rewriteSystem, type RewriteStyle } from "@/lib/memo-assist";
import { withApiErrors } from "@/lib/api-guard";
import { enforceRateLimit } from "@/lib/rate-limit";

const MAX_TEXT = 6000;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_LEN = 4000;

/**
 * «Оперативщик»: помощник составителя справки (директор, админ, составитель — в своей дирекции).
 *   mode "rewrite" — вариант формулировки одного пункта ({ text, style }) → { text, newNumbers };
 *   mode "chat"    — чат по текущему черновику справки (черновик сервер берёт сам по циклу), ответ потоком.
 */
async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  const b = (await request.json().catch(() => null)) as { cycleId?: unknown; mode?: unknown; text?: unknown; style?: unknown; messages?: unknown; engine?: unknown } | null;
  const cycleId = typeof b?.cycleId === "string" ? b.cycleId : "";
  const cycle = cycleId ? await prisma.cycle.findUnique({ where: { id: cycleId } }) : null;
  if (!cycle || !canEditMemo(actor, cycle)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // сначала проверяем запрос, потом идём к ИИ
  const mode = b?.mode === "rewrite" || b?.mode === "chat" ? b.mode : null;
  if (!mode) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const text = typeof b?.text === "string" ? b.text.trim() : "";
  if (mode === "rewrite" && !text) return NextResponse.json({ error: "INVALID_INPUT", message: "Пункт пустой — переписывать нечего." }, { status: 400 });
  if (mode === "rewrite" && text.length > MAX_TEXT) return NextResponse.json({ error: "INVALID_INPUT", message: "Пункт слишком длинный." }, { status: 400 });
  const messages: ChatMessage[] = (Array.isArray(b?.messages) ? (b!.messages as Array<{ role?: string; content?: unknown }>) : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role as ChatMessage["role"], content: (m.content as string).slice(0, MAX_MESSAGE_LEN) }));
  if (mode === "chat" && (messages.length === 0 || messages[messages.length - 1].role !== "user")) return NextResponse.json({ error: "INVALID_INPUT", message: "Введите вопрос." }, { status: 400 });

  const limited = await enforceRateLimit(`ai-memo:${actor.id}`, 60, 600000, "запросов Оперативщику");
  if (limited) return limited;

  try {
    const cfg = await loadEffectiveAiConfig(actor.id);
    if (!cfg) throw new AiError("NOT_CONFIGURED", "ИИ не подключён: попросите администратора подключить его для всех или вставьте свой ключ в настройках ИИ.");
    const { chain, preroute } = chainForEngine(cfg, parseEngine(b?.engine));

    if (mode === "rewrite") {
      const style: RewriteStyle = b?.style === "shorter" || b?.style === "formal" ? b.style : "improve";
      const raw = await withAiFallback(chain, text.length, (c) => complete(c, { system: rewriteSystem(style), messages: [{ role: "user", content: text }], maxTokens: aiBudget(c).chatOut, signal: request.signal }), preroute);
      const variant = cleanVariant(raw).slice(0, MAX_TEXT);
      if (!variant) throw new AiError("BAD_ANSWER", "ИИ вернул пустой ответ.");
      return NextResponse.json({ text: variant, newNumbers: newNumbers(text, variant) });
    }

    const state = await loadMemo(cycle);
    const ctx = memoAssistContext(state.doc, state.title);
    let used = chain as Parameters<typeof modelLabel>[0];
    const stream = await withAiFallback(chain, ctx.text.length, async (c) => {
      used = c;
      const budget = aiBudget(c);
      return streamText(c, { system: memoAssistSystem(ctx.text.slice(0, budget.contextChars)), messages: fitHistory(messages, budget.historyChars), maxTokens: budget.chatOut, signal: request.signal });
    }, preroute);
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-AI-Model": encodeURIComponent(modelLabel(used)) } });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

export const POST = withApiErrors(POSTHandler);
export const maxDuration = 300;
