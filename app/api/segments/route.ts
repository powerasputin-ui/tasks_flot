import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireFreshSession } from "@/lib/session";
import { canManageSegments } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { referenceItemSchema } from "@/lib/validation";
import { withApiErrors } from "@/lib/api-guard";

async function GETHandler() {
  const session = await requireFreshSession();
  const segments = await prisma.segment.findMany({
    where: { isActive: true, directorateId: session.directorateId ?? "" },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ segments });
}

async function POSTHandler(request: NextRequest) {
  const session = await requireFreshSession();
  if (!canManageSegments(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = referenceItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const directorateId = requireDirectorate(session);
  if (await prisma.segment.findFirst({ where: { directorateId, name: parsed.data.name } })) return NextResponse.json({ error: "NAME_TAKEN" }, { status: 409 });
  const segment = await prisma.segment.create({ data: { ...parsed.data, directorateId } });
  invalidateDicts();
  return NextResponse.json({ segment }, { status: 201 });
}

export const GET = withApiErrors(GETHandler);
export const POST = withApiErrors(POSTHandler);
