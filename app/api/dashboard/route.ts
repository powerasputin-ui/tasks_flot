import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { canAccessManagerViews } from "@/lib/permissions";
import { computeDashboard } from "@/lib/dashboard";

export async function GET() {
  const session = await requireSession();
  if (!canAccessManagerViews(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const data = await computeDashboard();
  return NextResponse.json(data);
}
