import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { AiError, buildContext, complete, consolidateSystem, parseConsolidated, simpleMerge } from "@/lib/ai";
import { isExecutive, loadAiConfig, loadMemosForAi } from "@/lib/ai-server";
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
  const cfg = await loadAiConfig(actor.id).catch(() => null);
  if (!cfg) return NextResponse.json(simpleMerge(memos, title, "ИИ не подключён — показана простая склейка по дирекциям."));
  try {
    const raw = await complete(cfg, { system: consolidateSystem(buildContext(memos)), messages: [{ role: "user", content: "Собери сводную справку." }], maxTokens: 3500, json: true, signal: AbortSignal.timeout(90000) });
    return NextResponse.json(parseConsolidated(raw, memos, title));
  } catch (e) {
    const why = e instanceof AiError ? e.message : "ИИ не ответил.";
    return NextResponse.json(simpleMerge(memos, title, `${why} Показана простая склейка по дирекциям.`));
  }
}

export const POST = withApiErrors(POSTHandler);
