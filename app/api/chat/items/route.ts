import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { withApiErrors } from "@/lib/api-guard";
import { burstLimited } from "@/lib/rate-limit";
import { searchItemsForChat } from "@/lib/chat-server";

async function GETHandler(request: NextRequest) {
  const actor = await requireActor();
  if (actor.viewAs) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const tooMany = burstLimited(`chat-items:${actor.id}`, 20, 10_000);
  if (tooMany) return tooMany;
  return NextResponse.json({ items: await searchItemsForChat(actor, new URL(request.url).searchParams.get("q") ?? "") });
}
export const GET = withApiErrors(GETHandler);
