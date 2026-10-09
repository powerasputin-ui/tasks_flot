import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { AiError, aiBudget, localBudget, complete, fitHistory, streamText, type ChatMessage } from "@/lib/ai";
import { aiErrorResponse, chainForEngine, isLocalEngine, loadEffectiveAiConfig, modelLabel, parseEngine, withAiFallback } from "@/lib/ai-server";
import { canEditMemo, loadMemo } from "@/lib/memo-load";
import { cleanVariant, memoAssistContext, memoAssistSystem, memoDateText, newNumbers, rewriteSystem, type RewriteStyle } from "@/lib/memo-assist";
import { withApiErrors } from "@/lib/api-guard";
import { buildLocalPrompt, localRewriteMessages, routeTask } from "@/lib/local-ai-prompt";
import { hitsAnswer, hitsBlock } from "@/lib/ai-search";
import { aiSearch } from "@/lib/ai-search-load";
import { collectDocs, docRefs, docsAnswer, docsBlock, isDocsQuestion, type AiDoc } from "@/lib/ai-docs";
import { quickAnswer } from "@/lib/local-quick";
import { TABLE_RULE, directAnswer, directResponse, hasConditions, itemRefs, itemsHeader, labelItems, parseTableQuestion, tableAnswer, tableContext } from "@/lib/ai-table";
import { loadTableFacts } from "@/lib/ai-table-load";
import { guardStream } from "@/lib/ai-guard";
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
  const b = (await request.json().catch(() => null)) as { cycleId?: unknown; mode?: unknown; text?: unknown; style?: unknown; messages?: unknown; engine?: unknown; localDevice?: unknown; localCtx?: unknown } | null;
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
    if (isLocalEngine(b?.engine)) {
      // локальная модель: отдаём готовый запрос, ответ считает браузер (lib/local-ai.ts); справка в облако не уходит
      const headers = { "Cache-Control": "no-store" };
      const lb = localBudget(b?.localDevice, b?.localCtx);
      if (mode === "rewrite") {
        const style: RewriteStyle = b?.style === "shorter" || b?.style === "formal" ? b.style : "improve";
        const system = `${rewriteSystem(style)}\nОтвечай только на русском языке.`;
        return NextResponse.json({ local: { kind: "rewrite", system, messages: localRewriteMessages(text), maxTokens: 260, original: text, sampling: { temp: 0.2, top_p: 0.9, min_p: 0.05, penalty_repeat: 1.1, penalty_last_n: 128 } } }, { headers });
      }
      const state = await loadMemo(cycle);
      const localMemos = [{ directorate: "", title: state.title, doc: state.doc, sources: state.sources, date: memoDateText(state.title, cycle.meetingDate) }];
      const { task, found } = await searchFor(actor, messages, state);
      const docs = memoDocs(state);
      const question = messages[messages.length - 1].content;
      const facts = await loadTableFacts(actor, cycle.directorateId);
      const memoItemIds = state.doc.sections.flatMap((s) => s.bullets.flatMap((x) => x.itemIds));
      // процессор: выборка из таблицы («у кого», «что просрочено», «не подано», «удалённые») и журнал — сразу точным списком
      const tableText = facts ? (b?.localDevice === "cpu" ? tableAnswer : directAnswer)({ ...facts, question, memoItemIds, budget: 0, memoBullets: bulletNumbers(state.doc) }) : null;
      if (tableText && facts) return NextResponse.json({ local: { kind: "text", text: tableText, items: itemRefs({ ...facts, question, memoItemIds }) } }, { headers });
      // процессор: вопрос про документы — сразу список с путями и ссылками
      if (b?.localDevice === "cpu" && isDocsQuestion(question) && task !== "search") return NextResponse.json({ local: { kind: "text", text: docsAnswer(question, docs), docs: docRefs(docs) } }, { headers });
      if (b?.localDevice === "cpu" && task === "search" && found) return NextResponse.json({ local: { kind: "text", text: hitsAnswer(found, found.scope) } }, { headers });
      // на процессоре типовые вопросы — мгновенный разбор кодом (lib/local-quick.ts)
      const quick = b?.localDevice === "cpu" ? quickAnswer({ audience: "compiler", memos: localMemos, question: messages[messages.length - 1].content }) : null;
      if (quick) return NextResponse.json({ local: { kind: "text", text: quick } }, { headers });
      const local = buildLocalPrompt({
        audience: "compiler",
        memos: localMemos,
        compact: b?.localDevice === "cpu",
        messages,
        contextChars: lb.contextChars,
        historyChars: lb.historyChars,
        outScale: b?.localDevice === "cpu" ? 0.75 : 1,
        // таблица (итоги, выборка по вопросу, карточки) — с правилом; из поиска — только найденное в справках
        hits: [
          facts ? `${TABLE_RULE}\n${tableContext({ ...facts, question, memoItemIds, budget: Math.round(lb.contextChars * 0.45) }).text}` : "",
          found && (task === "search" || found.hits.length) && !(facts && hasConditions(parseTableQuestion(question, facts.dict))) ? hitsBlock(facts ? { ...found, hits: found.hits.filter((h) => h.kind === "memo") } : found, Math.round(lb.contextChars * 0.15), found.scope) : "",
        ].filter(Boolean).join("\n\n") || undefined,
        docs,
      });
      return NextResponse.json({ local: { ...local, docs: docRefs(docs), items: facts ? itemRefs({ ...facts, question, memoItemIds }) : undefined } }, { headers });
    }
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
    const docs = memoDocs(state);
    const docsText = docsBlock(docs, 4000);
    // вся таблица дирекции (с удалёнными), итоги и точная выборка по вопросу — программой (lib/ai-table.ts)
    const facts = await loadTableFacts(actor, cycle.directorateId);
    const question = messages[messages.length - 1].content;
    const memoItemIds = state.doc.sections.flatMap((s) => s.bullets.flatMap((b) => b.itemIds));
    const labels = facts ? labelItems(facts.items) : null;
    const ctx = memoAssistContext(state.doc, state.title, { number: cycle.number, meetingDate: cycle.meetingDate, deadline: cycle.deadline }, docs, labels ? (id) => labels.get(id) : undefined);
    const { task, found } = await searchFor(actor, messages, state);
    // таблица уже целиком в контексте — из поиска берём только найденное в справках (архив, черновик)
    // в вопросе точные условия (статус, ответственный…) — ответ из выборки таблицы; поиск похожих слов только сбивает модель (экзамен, R2)
    const precise = !!facts && hasConditions(parseTableQuestion(question, facts.dict));
    // «какие / у кого / сколько / кто подавал» — точный ответ программы без модели (модель путает метки и людей)
    const direct = facts ? directAnswer({ ...facts, question, memoItemIds, budget: 0, memoBullets: bulletNumbers(state.doc) }) : null;
    if (direct) return directResponse(direct, facts ? itemRefs({ ...facts, question, memoItemIds }) : []);
    const memoFound = precise ? null : found && facts ? { ...found, hits: found.hits.filter((h) => h.kind === "memo") } : found;
    let used = chain as Parameters<typeof modelLabel>[0];
    const make = async (c: Parameters<typeof aiBudget>[0] & Parameters<typeof streamText>[0]) => {
      used = c;
      const budget = aiBudget(c);
      const table = facts ? tableContext({ ...facts, question, memoItemIds, budget: Math.round(budget.contextChars * 0.5) }).text : "";
      const hits = memoFound && (task === "search" || memoFound.hits.length) ? hitsBlock(memoFound, Math.round(budget.contextChars * 0.15), memoFound.scope) : "";
      // документы и таблица — отдельно и целиком: при сжатии справки под окно их не должно отрезать
      const memoText = ctx.text.slice(0, Math.max(2000, budget.contextChars - hits.length - docsText.length - table.length));
      return streamText(c, { system: memoAssistSystem(docsText ? `${memoText}\n\n${docsText}` : memoText, hits || undefined, table || undefined), messages: fitHistory(messages, budget.historyChars), maxTokens: budget.chatOut, signal: request.signal });
    };
    const first = await withAiFallback(chain, ctx.text.length, make, preroute);
    // мусор в начале ответа («personas, personas…») — отбрасываем и спрашиваем ещё раз (запасную модель, если есть)
    const stream = await guardStream(first, () => withAiFallback(chain.fallback ?? chain, ctx.text.length, make, false));
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-AI-Model": encodeURIComponent(modelLabel(used)), ...docsHeader(docs), ...(facts ? itemsHeader(itemRefs({ ...facts, question, memoItemIds })) : {}) } });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

/**
 * «Оперативщик» ещё и поиск: «найди…», «есть ли в таблице…», «что было по … в прошлых справках» — по таблице дирекции
 * (с удалёнными позициями), отправленным справкам и текущему черновику; свободный вопрос тоже получает находки.
 */
async function searchFor(actor: Parameters<typeof aiSearch>[0], messages: ChatMessage[], state: { title: string; doc: Parameters<typeof memoAssistContext>[0] }) {
  const question = messages[messages.length - 1].content;
  const task = routeTask(question, "compiler").task;
  const found = task === "search" || task === "free" ? await aiSearch(actor, question, { draft: { title: state.title, doc: state.doc } }) : null;
  return { task, found };
}

/** Документы пунктов черновика (ссылки на общий диск у позиций-источников). */
function memoDocs(state: { doc: Parameters<typeof memoAssistContext>[0]; sources: Array<{ id: string; title: string; files?: Array<{ id: string; name: string; path: string }> }> }): AiDoc[] {
  return collectDocs([state.doc], new Map(state.sources.map((s) => [s.id, { title: s.title, files: s.files ?? [] }])));
}

/** Метки [Д1]… → ссылки в чате: id позиции и файла (без путей — заголовок короткий). */
function docsHeader(docs: AiDoc[]): Record<string, string> {
  return docs.length ? { "X-AI-Docs": encodeURIComponent(JSON.stringify(docRefs(docs))) } : {};
}

/** Номера видимых пунктов справки у позиций (как [n] в контексте модели): «в справке: пункт [3]». */
function bulletNumbers(doc: Parameters<typeof memoAssistContext>[0]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  let n = 0;
  for (const s of doc.sections)
    for (const b of s.bullets) {
      if (b.hidden || !b.text.trim()) continue;
      n++;
      for (const id of b.itemIds) out.set(id, [...(out.get(id) ?? []), n]);
    }
  return out;
}

export const POST = withApiErrors(POSTHandler);
export const maxDuration = 300;
