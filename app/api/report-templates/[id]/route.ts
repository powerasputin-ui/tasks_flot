import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { reportConfigSchema } from "@/lib/report-config";
import { canEditTemplate, canShareTemplates } from "@/lib/report-templates";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  scope: z.enum(["PERSONAL", "SHARED"]).optional(),
  config: reportConfigSchema.optional(),
});

async function loadEditable(id: string) {
  const actor = await requireActor();
  const tpl = await prisma.reportTemplate.findUnique({ where: { id } });
  // чужой личный шаблон для остальных «не существует»
  if (!tpl || (tpl.scope === "PERSONAL" && tpl.ownerId !== actor.id)) return { actor, tpl: null, error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  if (!canEditTemplate(actor, tpl)) return { actor, tpl, error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  return { actor, tpl, error: null };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, tpl, error } = await loadEditable(id);
  if (error || !tpl) return error!;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  // «для всех» может сделать только куратор или администратор
  if (parsed.data.scope === "SHARED" && !canShareTemplates(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const template = await prisma.reportTemplate.update({
    where: { id },
    data: { name: parsed.data.name, scope: parsed.data.scope, ...(parsed.data.config ? { config: parsed.data.config } : {}) },
    select: { id: true, name: true, scope: true, ownerId: true, config: true },
  });
  return NextResponse.json({ template });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await loadEditable(id);
  if (error) return error;
  await prisma.reportTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
