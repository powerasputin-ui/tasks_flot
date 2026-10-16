import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import { withApiErrors } from "@/lib/api-guard";
import { burstLimited, enforceRateLimit } from "@/lib/rate-limit";
import { GROUP_MAX_MEMBERS, GROUP_TITLE_MAX } from "@/lib/chat-rules";
import { createGroup, openTaskChat } from "@/lib/chat-server";

// Новая группа ({title, memberIds}) или чат по задаче из карточки ({itemId}).
const schema = z.union([
  z.object({ title: z.string().max(GROUP_TITLE_MAX + 20), memberIds: z.array(z.string().max(60)).max(GROUP_MAX_MEMBERS) }),
  z.object({ itemId: z.string().min(1).max(60) }),
]);

async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (actor.viewAs) return NextResponse.json({ error: "FORBIDDEN", message: "В режиме просмотра чат недоступен." }, { status: 403 });
  const tooMany = burstLimited(`chat-group:${actor.id}`, 12, 10_000) ?? (await enforceRateLimit(`chat-group:${actor.id}`, 20, 3_600_000, "создаваемых групп"));
  if (tooMany) return tooMany;
  const p = schema.safeParse(await request.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const r = "itemId" in p.data ? await openTaskChat(actor.id, p.data.itemId) : await createGroup(actor.id, p.data);
  if (!r.ok) return NextResponse.json({ error: r.error, message: r.message }, { status: r.status });
  return NextResponse.json(r.data, { status: 201 });
}

export const POST = withApiErrors(POSTHandler);
