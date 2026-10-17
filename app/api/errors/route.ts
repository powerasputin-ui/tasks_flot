import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { withApiErrors } from "@/lib/api-guard";
import { burstLimited } from "@/lib/rate-limit";
import { recordError } from "@/lib/error-log";

/** Журнал ошибок: браузер сообщает об ошибке страницы (любой вошедший); список и «решено» — админ и техадмин. */
const canRead = (role: string) => role === "ADMIN" || role === "SYSTEM_ADMIN";

const reportSchema = z.object({ message: z.string().max(2000), stack: z.string().max(8000).nullable().optional(), route: z.string().max(500) });

async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  // одна и та же поломка в цикле не должна заливать журнал: 10 сообщений в минуту на человека, остальное молча отбрасываем
  if (burstLimited(`client-error:${actor.id}`, 10, 60_000)) return NextResponse.json({ ok: true, dropped: true });
  const p = reportSchema.safeParse(await request.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  await recordError({ source: "CLIENT", route: p.data.route, message: p.data.message, stack: p.data.stack, role: actor.role });
  return NextResponse.json({ ok: true });
}

async function GETHandler() {
  const actor = await requireActor();
  if (!canRead(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const errors = await prisma.appError.findMany({ orderBy: { lastAt: "desc" }, take: 200 });
  return NextResponse.json({ errors });
}

async function DELETEHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!canRead(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  await prisma.appError.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}

export const POST = withApiErrors(POSTHandler);
export const GET = withApiErrors(GETHandler);
export const DELETE = withApiErrors(DELETEHandler);
