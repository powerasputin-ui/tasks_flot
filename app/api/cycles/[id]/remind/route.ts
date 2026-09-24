import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { CYCLE_ERROR_STATUS, remindMissing } from "@/lib/cycles";
import { withApiErrors } from "@/lib/api-guard";
import { enforceRateLimit } from "@/lib/rate-limit";

// Напомнить не подавшим: body { userIds?: string[] } — конкретным людям, без него — всем, кто ещё ничего не подал.
async function POSTHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const limited = await enforceRateLimit(`remind:${actor.id}`, 60, 600000, "напоминаний");
  if (limited) return limited;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { userIds?: unknown } | null;
  const userIds = Array.isArray(body?.userIds) ? body!.userIds.filter((x): x is string => typeof x === "string").slice(0, 200) : undefined;
  const result = await remindMissing(actor, id, userIds);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: CYCLE_ERROR_STATUS[result.error] });
  return NextResponse.json(result);
}

export const POST = withApiErrors(POSTHandler);
