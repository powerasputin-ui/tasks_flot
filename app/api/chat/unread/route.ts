import { NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { withApiErrors } from "@/lib/api-guard";
import { burstLimited } from "@/lib/rate-limit";
import { unreadTotal } from "@/lib/chat-server";

async function GETHandler() {
  const actor = await requireActor();
  if (actor.viewAs || actor.role === "SYSTEM_ADMIN") return NextResponse.json({ unread: 0 });
  const tooMany = burstLimited(`chat-unread:${actor.id}`, 20, 10_000);
  if (tooMany) return tooMany;
  return NextResponse.json({ unread: await unreadTotal(actor.id) });
}
export const GET = withApiErrors(GETHandler);
