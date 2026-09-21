import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireFreshSession, requireSession } from "@/lib/session";
import { canManageDirectory } from "@/lib/permissions";
import { referenceItemSchema } from "@/lib/validation";

export async function GET() {
  await requireSession();
  const statuses = await prisma.status.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ statuses });
}

export async function POST(request: NextRequest) {
  const session = await requireFreshSession();
  if (!canManageDirectory(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = referenceItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const status = await prisma.status.create({ data: parsed.data });
  invalidateDicts();
  return NextResponse.json({ status }, { status: 201 });
}
