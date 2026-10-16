import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canViewItems } from "@/lib/permissions";
import { withApiErrors } from "@/lib/api-guard";

// Ход работы по задаче для карточки: сдачи и решения, запросы ЗГД, просьбы о переносе, комментарии, последнее подтверждение для ЗГД.
async function GETHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!canViewItems(actor.role)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const item = await prisma.operationalItem.findFirst({ where: { id, directorateId: actor.directorateId ?? "-" }, select: { id: true } });
  if (!item) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const [reviews, deadlineRequests, zgdRequests, notes, publication] = await Promise.all([
    prisma.taskReview.findMany({ where: { itemId: id }, orderBy: { submittedAt: "desc" }, take: 10 }),
    prisma.deadlineRequest.findMany({ where: { itemId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.zgdRequest.findMany({ where: { itemId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.itemNote.findMany({ where: { itemId: id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, text: true, createdAt: true, audience: true, author: { select: { name: true, role: true } } } }),
    prisma.itemPublication.findFirst({ where: { itemId: id }, orderBy: { publishedAt: "desc" }, select: { publishedAt: true, publishedByName: true, reason: true } }),
  ]);
  return NextResponse.json({ reviews, deadlineRequests, zgdRequests, notes, publication });
}

export const GET = withApiErrors(GETHandler);
