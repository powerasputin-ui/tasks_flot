import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import { withApiErrors } from "@/lib/api-guard";
import { burstLimited, enforceRateLimit } from "@/lib/rate-limit";
import { CHAT_MAX_TEXT } from "@/lib/chat-rules";
import { listThreads, sendMessage } from "@/lib/chat-server";

// Чат недоступен в режиме «Посмотреть как»: переписка личная, админ её чужими глазами не читает.
const noChatInViewAs = () => NextResponse.json({ error: "FORBIDDEN", message: "В режиме просмотра чат недоступен." }, { status: 403 });

async function GETHandler() {
  const actor = await requireActor();
  if (actor.viewAs) return noChatInViewAs();
  const tooMany = burstLimited(`chat-list:${actor.id}`, 40, 10_000);
  if (tooMany) return tooMany;
  return NextResponse.json(await listThreads(actor.id));
}

const sendSchema = z.object({ toUserId: z.string().min(1).max(60), text: z.string().max(CHAT_MAX_TEXT + 500), itemId: z.string().max(60).nullable().optional() });

async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (actor.viewAs) return noChatInViewAs();
  const tooMany = burstLimited(`chat-send:${actor.id}`, 15, 10_000) ?? (await enforceRateLimit(`chat-send:${actor.id}`, 120, 60_000, "сообщений"));
  if (tooMany) return tooMany;
  const p = sendSchema.safeParse(await request.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const r = await sendMessage(actor.id, p.data);
  if (!r.ok) return NextResponse.json({ error: r.error, message: r.message }, { status: r.status });
  return NextResponse.json(r.data, { status: 201 });
}

export const GET = withApiErrors(GETHandler);
export const POST = withApiErrors(POSTHandler);
