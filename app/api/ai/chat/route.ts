import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { AiError, aiBudget, localBudget, buildContextInfo, chatSystem, fitHistory, streamText, type ChatMessage } from "@/lib/ai";
import { aiErrorResponse, canUseAi, chainForEngine, isLocalEngine, loadEffectiveAiConfig, loadLatestMemoIds, loadMemosForAi, modelLabel, parseEngine, withAiFallback } from "@/lib/ai-server";
import { withApiErrors } from "@/lib/api-guard";
import { buildLocalPrompt } from "@/lib/local-ai-prompt";
import { quickAnswer } from "@/lib/local-quick";
import { enforceRateLimit } from "@/lib/rate-limit";

const MAX_MESSAGES = 20;
const MAX_MESSAGE_LEN = 4000;

// Чат ЗГД по справкам. Клиент присылает только id справок и историю вопросов: тексты справок сервер достаёт сам и только те, что человеку доступны.
async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!canUseAi(actor)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const limited = await enforceRateLimit(`ai-chat:${actor.id}`, 40, 600000, "вопросов помощнику");
  if (limited) return limited;
  const b = (await request.json().catch(() => null)) as { versionIds?: unknown; messages?: unknown; engine?: unknown; localDevice?: unknown; localCtx?: unknown } | null;
  const messages: ChatMessage[] = (Array.isArray(b?.messages) ? (b!.messages as Array<{ role?: string; content?: unknown }>) : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role as ChatMessage["role"], content: (m.content as string).slice(0, MAX_MESSAGE_LEN) }));
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return NextResponse.json({ error: "INVALID_INPUT", message: "Введите вопрос." }, { status: 400 });
  try {
    const local = isLocalEngine(b?.engine);
    const cfg = local ? null : await loadEffectiveAiConfig(actor.id);
    if (!local && !cfg) throw new AiError("NOT_CONFIGURED", "ИИ не подключён: попросите администратора подключить его для всех или вставьте свой ключ в настройках ИИ.");
    const requested = Array.isArray(b?.versionIds) && b!.versionIds.length > 0;
    const memos = await loadMemosForAi(actor, requested ? b?.versionIds : await loadLatestMemoIds(actor));
    if (memos.length === 0) return NextResponse.json({ error: "NO_CONTEXT", message: "Отправленных справок пока нет — отвечать не по чему." }, { status: 400 });
    if (!cfg) {
      // локальная модель (маленькая): сроки, пустые формулировки, дубли считает сервер, модель формулирует выводы
      // (lib/local-ai-prompt.ts); ответ считает браузер этого человека, справки в облако не уходят
      const lb = localBudget(b?.localDevice, b?.localCtx);
      const localMemos = memos.map((m) => ({ directorate: m.directorate, title: m.title, doc: m.doc, sources: m.sources }));
      // на процессоре типовые вопросы — мгновенный разбор кодом (модель читала бы справку минутами), см. lib/local-quick.ts
      const quick = b?.localDevice === "cpu" ? quickAnswer({ audience: "zgd", memos: localMemos, question: messages[messages.length - 1].content }) : null;
      if (quick) return NextResponse.json({ local: { kind: "text", text: quick } }, { headers: { "Cache-Control": "no-store" } });
      const local = buildLocalPrompt({
        audience: "zgd",
        memos: localMemos,
        compact: b?.localDevice === "cpu",
        messages,
        contextChars: lb.contextChars,
        historyChars: lb.historyChars,
        outScale: b?.localDevice === "cpu" ? 0.75 : 1,
      });
      return NextResponse.json({ local }, { headers: { "Cache-Control": "no-store" } });
    }
    const fullLength = buildContextInfo(memos).text.length;
    const { chain, preroute } = chainForEngine(cfg, parseEngine(b?.engine));
    let used = chain as Parameters<typeof modelLabel>[0];
    const { stream, trimmed } = await withAiFallback(chain, fullLength, async (c) => {
      used = c;
      const budget = aiBudget(c);
      const ctx = buildContextInfo(memos, budget.contextChars);
      const st = await streamText(c, { system: chatSystem(ctx.text), messages: fitHistory(messages, budget.historyChars), maxTokens: budget.chatOut, signal: request.signal });
      return { stream: st, trimmed: ctx.trimmed };
    }, preroute);
    // ИИ видел справки не целиком — чат покажет это человеку
    const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
    if (trimmed) headers["X-AI-Context"] = trimmed;
    // какая модель ответила и была ли она первой в выборе (заголовки — только ASCII, поэтому закодировано)
    headers["X-AI-Model"] = encodeURIComponent(modelLabel(used));
    if (used.model !== chain.model || used.baseUrl !== chain.baseUrl) headers["X-AI-Switched"] = "1";
    return new Response(stream, { headers });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

export const POST = withApiErrors(POSTHandler);

// длинный ответ модели с переходом на запасную может идти дольше минуты
export const maxDuration = 300;
