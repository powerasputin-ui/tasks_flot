import { NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { withApiErrors } from "@/lib/api-guard";
import { burstLimited } from "@/lib/rate-limit";
import { chatPeople } from "@/lib/chat-server";

async function GETHandler() {
  const actor = await requireActor();
  if (actor.viewAs) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const tooMany = burstLimited(`chat-people:${actor.id}`, 20, 10_000);
  if (tooMany) return tooMany;
  return NextResponse.json({ people: await chatPeople(actor.id) });
}
export const GET = withApiErrors(GETHandler);
