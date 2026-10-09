import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { AiError, aiBudget, localBudget, buildContextInfo, chatSystem, fitHistory, streamText, type ChatMessage } from "@/lib/ai";
import { aiErrorResponse, canUseAi, chainForEngine, isLocalEngine, loadEffectiveAiConfig, loadLatestMemoIds, loadMemosForAi, modelLabel, parseEngine, withAiFallback } from "@/lib/ai-server";
import { withApiErrors } from "@/lib/api-guard";
import { buildLocalPrompt, routeTask } from "@/lib/local-ai-prompt";
import { hitsAnswer, hitsBlock } from "@/lib/ai-search";
import { aiSearch } from "@/lib/ai-search-load";
import { collectDocs, docRefs, docsAnswer, docsBlock, isDocsQuestion } from "@/lib/ai-docs";
import { canViewItems } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readFiles } from "@/lib/item-files";
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
  // директор спрашивает о своих справках — помощник работает на него, а не на ЗГД
  const lead = actor.role === "DIRECTOR" ? ("director" as const) : undefined;
  try {
    const local = isLocalEngine(b?.engine);
    const cfg = local ? null : await loadEffectiveAiConfig(actor.id);
    if (!local && !cfg) throw new AiError("NOT_CONFIGURED", "ИИ не подключён: попросите администратора подключить его для всех или вставьте свой ключ в настройках ИИ.");
    const requested = Array.isArray(b?.versionIds) && b!.versionIds.length > 0;
    const memos = await loadMemosForAi(actor, requested ? b?.versionIds : await loadLatestMemoIds(actor));
    // помощник ещё и поиск: «найди…», «есть ли…», «кто отвечает за…» — по таблице (с удалёнными) и архиву справок;
    // свободный вопрос тоже получает находки — вдруг он про то, чего нет в открытой справке (lib/ai-search.ts)
    const question = messages[messages.length - 1].content;
    const task = routeTask(question, "zgd").task;
    const found = task === "search" || task === "free" ? await aiSearch(actor, question) : null;
    const withHits = !!found && (task === "search" || found.hits.length > 0);
    // документы пунктов (ссылки на общий диск) — тем, кто видит их в интерфейсе (не ЗГД: ему документы позиций не открываются)
    const docs = await memoDocsFor(actor, memos);
    if (memos.length === 0 && !(found && found.hits.length)) return NextResponse.json({ error: "NO_CONTEXT", message: task === "search" ? "Ничего не нашлось — ни в таблице, ни в справках." : "Отправленных справок пока нет — отвечать не по чему." }, { status: 400 });
    if (!cfg) {
      // локальная модель (маленькая): сроки, пустые формулировки, дубли считает сервер, модель формулирует выводы
      // (lib/local-ai-prompt.ts); ответ считает браузер этого человека, справки в облако не уходят
      const lb = localBudget(b?.localDevice, b?.localCtx);
      const localMemos = memos.map((m) => ({ directorate: m.directorate, title: m.title, doc: m.doc, sources: m.sources, date: m.date }));
      // на процессоре типовые вопросы — мгновенный разбор кодом (модель читала бы справку минутами), см. lib/local-quick.ts
      if (b?.localDevice === "cpu" && docs.length && isDocsQuestion(question) && task !== "search") return NextResponse.json({ local: { kind: "text", text: docsAnswer(question, docs), docs: docRefs(docs) } }, { headers: { "Cache-Control": "no-store" } });
      if (b?.localDevice === "cpu" && task === "search" && found) return NextResponse.json({ local: { kind: "text", text: hitsAnswer(found, found.scope) } }, { headers: { "Cache-Control": "no-store" } });
      const quick = b?.localDevice === "cpu" ? quickAnswer({ audience: "zgd", memos: localMemos, question: messages[messages.length - 1].content, lead }) : null;
      if (quick) return NextResponse.json({ local: { kind: "text", text: quick } }, { headers: { "Cache-Control": "no-store" } });
      const local = buildLocalPrompt({
        audience: "zgd",
        memos: localMemos,
        compact: b?.localDevice === "cpu",
        messages,
        contextChars: lb.contextChars,
        historyChars: lb.historyChars,
        outScale: b?.localDevice === "cpu" ? 0.75 : 1,
        lead,
        hits: withHits && found ? hitsBlock(found, Math.round(lb.contextChars * 0.6), found.scope) : undefined,
        docs,
      });
      return NextResponse.json({ local: { ...local, docs: docRefs(docs) } }, { headers: { "Cache-Control": "no-store" } });
    }
    const fullLength = buildContextInfo(memos).text.length;
    const { chain, preroute } = chainForEngine(cfg, parseEngine(b?.engine));
    let used = chain as Parameters<typeof modelLabel>[0];
    const { stream, trimmed } = await withAiFallback(chain, fullLength, async (c) => {
      used = c;
      const budget = aiBudget(c);
      // найденное поиском — до трети окна (у бесплатного Groq окно маленькое), остальное — справки
      const hits = withHits && found ? hitsBlock(found, Math.round(budget.contextChars * (task === "search" ? 0.5 : 0.3)), found.scope) : "";
      const docsText = docsBlock(docs, 4000);
      const ctx = buildContextInfo(memos, Math.max(2000, budget.contextChars - hits.length - docsText.length));
      const st = await streamText(c, { system: chatSystem(docsText ? `${ctx.text}\n\n${docsText}` : ctx.text, lead, hits || undefined), messages: fitHistory(messages, budget.historyChars), maxTokens: budget.chatOut, signal: request.signal });
      return { stream: st, trimmed: ctx.trimmed };
    }, preroute);
    // ИИ видел справки не целиком — чат покажет это человеку
    const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
    if (trimmed) headers["X-AI-Context"] = trimmed;
    // какая модель ответила и была ли она первой в выборе (заголовки — только ASCII, поэтому закодировано)
    headers["X-AI-Model"] = encodeURIComponent(modelLabel(used));
    if (used.model !== chain.model || used.baseUrl !== chain.baseUrl) headers["X-AI-Switched"] = "1";
    // метки [Д1]… → ссылки на документы в чате
    if (docs.length) headers["X-AI-Docs"] = encodeURIComponent(JSON.stringify(docRefs(docs)));
    return new Response(stream, { headers });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

/** Документы позиций, на которые опираются пункты справок: только своей дирекции и тем, кому доступна таблица. */
async function memoDocsFor(actor: Parameters<typeof canUseAi>[0] & { role: Parameters<typeof canViewItems>[0]; directorateId?: string | null }, memos: Awaited<ReturnType<typeof loadMemosForAi>>) {
  if (!canViewItems(actor.role) || !actor.directorateId) return [];
  const ids = [...new Set(memos.flatMap((m) => m.doc.sections.flatMap((s) => s.bullets.flatMap((b) => b.itemIds))))];
  if (!ids.length) return [];
  const rows = await prisma.operationalItem.findMany({ where: { id: { in: ids }, directorateId: actor.directorateId }, select: { id: true, title: true, files: true } });
  return collectDocs(memos.map((m) => m.doc), new Map(rows.map((r) => [r.id, { title: r.title, files: readFiles(r.files) }])));
}

export const POST = withApiErrors(POSTHandler);

// длинный ответ модели с переходом на запасную может идти дольше минуты
export const maxDuration = 300;
