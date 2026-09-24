import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { CYCLE_ERROR_STATUS, startReview } from "@/lib/cycles";
import { withApiErrors } from "@/lib/api-guard";

async function POSTHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const result = await startReview(actor, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: CYCLE_ERROR_STATUS[result.error] });
  return NextResponse.json(result);
}

export const POST = withApiErrors(POSTHandler);
