import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { AiError, aiBudget, buildContextInfo, complete, consolidateSystem, parseConsolidated, simpleMerge } from "@/lib/ai";
import { isExecutive, loadEffectiveAiConfig, loadMemosForAi, withAiFallback } from "@/lib/ai-server";
import { withApiErrors } from "@/lib/api-guard";
import { enforceRateLimit } from "@/lib/rate-limit";

// Сводная справка из справок нескольких дирекций. Без подключённого ИИ (или если он не ответил) — простая склейка по дирекциям.
async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!isExecutive(actor)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const limited = await enforceRateLimit(`ai-consolidate:${actor.id}`, 10, 600000, "запросов на сводку");
  if (limited) return limited;
  const b = (await request.json().catch(() => null)) as { versionIds?: unknown } | null;
  const memos = await loadMemosForAi(actor, b?.versionIds);
  if (memos.length === 0) return NextResponse.json({ error: "NO_CONTEXT", message: "Отметьте хотя бы одну справку." }, { status: 400 });
  const date = memos[memos.length - 1].date;
  const title = `Сводная справка по дирекциям к ОС ${date}`;
  const cfg = await loadEffectiveAiConfig(actor.id).catch(() => null);
  if (!cfg) return NextResponse.json(simpleMerge(memos, title, "ИИ не подключён — показана простая склейка по дирекциям."));
  try {
    const { result, trimmed } = await withAiFallback(cfg, buildContextInfo(memos).text.length, async (c) => {
      const budget = aiBudget(c);
      const ctx = buildContextInfo(memos, budget.contextChars);
      const raw = await complete(c, { system: consolidateSystem(ctx.text), messages: [{ role: "user", content: "Собери сводную справку." }], maxTokens: budget.consolidateOut, json: true, signal: AbortSignal.timeout(90000) });
      return { result: parseConsolidated(raw, memos, title), trimmed: ctx.trimmed };
    });
    if (trimmed === "cut") return NextResponse.json({ ...result, warning: "Справки не поместились в окно модели целиком — сводка собрана по их началу. Выберите меньше справок." });
    return NextResponse.json(result);
  } catch (e) {
    const why = e instanceof AiError ? e.message : "ИИ не ответил.";
    return NextResponse.json(simpleMerge(memos, title, `${why} Показана простая склейка по дирекциям.`));
  }
}

export const POST = withApiErrors(POSTHandler);
