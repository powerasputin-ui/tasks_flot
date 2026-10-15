import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import { answerRequest, askStatus, createOrder, directorOrder, decideDeadline, requestDeadline, setControl, zgdComment, zgdItemInfo, type ZgdResult } from "@/lib/zgd-server";
import { withApiErrors } from "@/lib/api-guard";

const date = z.coerce.date().nullable().optional();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("control"), itemId: z.string(), on: z.boolean() }),
  z.object({ action: z.literal("request"), itemId: z.string(), text: z.string().max(1000), dueAt: date }),
  z.object({ action: z.literal("answer"), requestId: z.string(), answer: z.string().max(2000) }),
  z.object({ action: z.literal("comment"), itemId: z.string(), text: z.string().max(2000) }),
  z.object({ action: z.literal("order"), directorateId: z.string(), title: z.string().max(300), expectedResult: z.string().max(2000), deadline: date, responsibleId: z.string().nullable().optional() }),
  z.object({ action: z.literal("director-order"), responsibleId: z.string(), title: z.string().max(300), expectedResult: z.string().max(2000), deadline: date, segmentId: z.string().nullable().optional() }),
  z.object({ action: z.literal("deadline-request"), itemId: z.string(), newDeadline: date, reason: z.string().max(500) }),
  z.object({ action: z.literal("deadline-decide"), requestId: z.string(), approve: z.boolean(), comment: z.string().max(500).optional() }),
]);

// Действия ЗГД (контроль, запрос статуса, комментарий, поручение) и ответы на них через директора; просьбы о переносе срока.
async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  const p = schema.safeParse(await request.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "INVALID_INPUT", details: p.error.flatten() }, { status: 400 });
  const b = p.data;
  const r: ZgdResult =
    b.action === "control" ? await setControl(actor, b.itemId, b.on)
    : b.action === "request" ? await askStatus(actor, b.itemId, b.text, b.dueAt ?? null)
    : b.action === "answer" ? await answerRequest(actor, b.requestId, b.answer)
    : b.action === "comment" ? await zgdComment(actor, b.itemId, b.text)
    : b.action === "order" ? await createOrder(actor, { directorateId: b.directorateId, title: b.title, expectedResult: b.expectedResult, deadline: b.deadline ?? null, responsibleId: b.responsibleId })
    : b.action === "director-order" ? await directorOrder(actor, { responsibleId: b.responsibleId, title: b.title, expectedResult: b.expectedResult, deadline: b.deadline ?? null, segmentId: b.segmentId })
    : b.action === "deadline-request" ? await requestDeadline(actor, b.itemId, b.newDeadline ?? null, b.reason)
    : await decideDeadline(actor, b.requestId, b.approve, b.comment);
  if (!r.ok) return NextResponse.json({ error: r.error, message: r.message }, { status: r.status });
  return NextResponse.json(r.data);
}

// Карточка ЗГД: его запросы с ответами и его комментарии по задаче.
async function GETHandler(request: NextRequest) {
  const actor = await requireActor();
  const itemId = new URL(request.url).searchParams.get("itemId") ?? "";
  const info = await zgdItemInfo(actor, itemId);
  if (!info) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return NextResponse.json(info);
}

export const POST = withApiErrors(POSTHandler);
export const GET = withApiErrors(GETHandler);
