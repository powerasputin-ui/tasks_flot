import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sensibleDate } from "@/lib/validation";
import { trackerActionLimited } from "@/lib/rate-limit";
import { requireActor } from "@/lib/session";
import { rowFromRecord } from "@/lib/table-view";
import { performTransition } from "@/lib/workflow-server";
import { withApiErrors } from "@/lib/api-guard";

const schema = z.object({
  action: z.enum(["submit", "accept", "return", "block", "unblock", "cancel", "reopen"]),
  version: z.number().int().min(1),
  result: z.string().max(2000).optional(),
  comment: z.string().max(2000).optional(),
  blockedBy: z.string().max(500).optional(),
  blockedUntil: sensibleDate.nullable().optional(),
  reason: z.string().max(1000).optional(),
  files: z.array(z.object({ id: z.string().max(80).optional(), path: z.string().max(700) })).max(5).optional(),
});

// Действие трекера: сдать на проверку / принять / вернуть / заблокировать / снять блок / отменить / переоткрыть (lib/workflow.ts).
async function POSTHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (actor.viewAs) return NextResponse.json({ error: "FORBIDDEN", message: "В режиме просмотра менять задачи нельзя." }, { status: 403 });
  const tooMany = await trackerActionLimited("tr", actor.id);
  if (tooMany) return tooMany;
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  const { action, ...input } = parsed.data;
  const r = await performTransition(actor, id, action, input);
  if (!r.ok) return NextResponse.json({ error: r.error, message: r.message }, { status: r.status });
  return NextResponse.json({ row: await rowFromRecord(r.record) });
}

export const POST = withApiErrors(POSTHandler);
