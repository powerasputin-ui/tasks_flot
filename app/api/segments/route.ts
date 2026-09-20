import { NextRequest, NextResponse } from "next/server";
import { invalidateDicts } from "@/lib/dictionaries";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canManageDirectory } from "@/lib/permissions";
import { referenceItemSchema } from "@/lib/validation";

export async function GET() {
  await requireSession();
  const segments = await prisma.segment.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ segments });
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!canManageDirectory(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = referenceItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const segment = await prisma.segment.create({ data: parsed.data });
  invalidateDicts();
  return NextResponse.json({ segment }, { status: 201 });
}
