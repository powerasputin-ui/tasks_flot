import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import { withApiErrors } from "@/lib/api-guard";
import { burstLimited } from "@/lib/rate-limit";
import { closeThread, getThread } from "@/lib/chat-server";

type Ctx = { params: Promise<{ id: string }> };

async function GETHandler(request: NextRequest, ctx: Ctx) {
  const actor = await requireActor();
  if (actor.viewAs) return NextResponse.json({ error: "FORBIDDEN", message: "В режиме просмотра чат недоступен." }, { status: 403 });
  const tooMany = burstLimited(`chat-thread:${actor.id}`, 60, 10_000);
  if (tooMany) return tooMany;
  const { id } = await ctx.params;
  const sp = new URL(request.url).searchParams;
  const sinceRaw = sp.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  if (since && Number.isNaN(since.getTime())) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const r = await getThread(actor.id, id, { since, markRead: sp.get("markRead") === "1" });
  if (!r.ok) return NextResponse.json({ error: r.error, message: r.message }, { status: r.status });
  return NextResponse.json(r.data);
}

async function POSTHandler(request: NextRequest, ctx: Ctx) {
  const actor = await requireActor();
  if (actor.viewAs) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const tooMany = burstLimited(`chat-close:${actor.id}`, 10, 10_000);
  if (tooMany) return tooMany;
  const p = z.object({ action: z.literal("close") }).safeParse(await request.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const { id } = await ctx.params;
  const r = await closeThread(actor.id, id);
  if (!r.ok) return NextResponse.json({ error: r.error, message: r.message }, { status: r.status });
  return NextResponse.json({ ok: true });
}

export const GET = withApiErrors(GETHandler);
export const POST = withApiErrors(POSTHandler);
