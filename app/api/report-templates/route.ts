import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { reportConfigSchema } from "@/lib/report-config";
import { canShareTemplates, canUseReports } from "@/lib/report-templates";
import { withApiErrors } from "@/lib/api-guard";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(["PERSONAL", "SHARED"]),
  config: reportConfigSchema,
});

// Шаблоны отчётов: свои личные + общие («для всех»). Шаблоны «из коробки» живут в коде (lib/report-config.ts).
async function GETHandler() {
  const actor = await requireActor();
  if (!canUseReports(actor.role)) return NextResponse.json({ templates: [] });
  const templates = await prisma.reportTemplate.findMany({
    where: { OR: [{ scope: "SHARED", directorateId: actor.directorateId ?? "" }, { ownerId: actor.id }] },
    orderBy: [{ scope: "desc" }, { name: "asc" }],
    select: { id: true, name: true, scope: true, ownerId: true, config: true, updatedAt: true },
  });
  return NextResponse.json({ templates: templates.map((t) => ({ ...t, mine: t.ownerId === actor.id, canEdit: t.scope === "SHARED" ? canShareTemplates(actor.role) : t.ownerId === actor.id })) });
}

async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!canUseReports(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  if (parsed.data.scope === "SHARED" && !canShareTemplates(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const template = await prisma.reportTemplate.create({
    data: { name: parsed.data.name, scope: parsed.data.scope, config: parsed.data.config, ownerId: actor.id, directorateId: actor.directorateId ?? null },
    select: { id: true, name: true, scope: true, ownerId: true, config: true },
  });
  return NextResponse.json({ template: { ...template, mine: true, canEdit: true } }, { status: 201 });
}

export const GET = withApiErrors(GETHandler);
export const POST = withApiErrors(POSTHandler);
