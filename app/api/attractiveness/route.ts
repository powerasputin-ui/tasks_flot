import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireFreshSession, requireSession } from "@/lib/session";
import { canManageDirectory } from "@/lib/permissions";
import { referenceItemSchema } from "@/lib/validation";
import { withApiErrors } from "@/lib/api-guard";

async function GETHandler() {
  await requireSession();
  const attractiveness = await prisma.attractiveness.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ attractiveness });
}

async function POSTHandler(request: NextRequest) {
  const session = await requireFreshSession();
  if (!canManageDirectory(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = referenceItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const attractiveness = await prisma.attractiveness.create({ data: parsed.data });
  invalidateDicts();
  return NextResponse.json({ attractiveness }, { status: 201 });
}

export const GET = withApiErrors(GETHandler);
export const POST = withApiErrors(POSTHandler);
