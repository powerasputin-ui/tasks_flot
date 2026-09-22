import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { MEMO_LIMITS, canEditMemo, loadMemo } from "@/lib/memo-load";
import { notIncluded, parseMemoDoc } from "@/lib/memo";
import { cycleSummary } from "@/lib/cycles";

// Справка цикла для редактора: документ, версия, пометки, строки-источники, то, что не вошло, участие подачи.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const cycle = await prisma.cycle.findUnique({ where: { id } });
  if (!cycle || !canEditMemo(actor, cycle)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const state = await loadMemo(cycle);
  const [summary, dir] = await Promise.all([cycleSummary(cycle.directorateId ?? ""), prisma.directorate.findUnique({ where: { id: cycle.directorateId ?? "" }, select: { name: true, shortName: true } })]);
  const used = new Set(state.doc.sections.flatMap((s) => s.bullets.flatMap((b) => b.itemIds)));
  const unmapped = [...new Set(state.sources.filter((s) => s.operFlag && s.trackId && !state.defs.some((d) => d.trackIds.includes(s.trackId!))).map((s) => s.trackName).filter(Boolean))];
  return NextResponse.json({
    cycle: { id: cycle.id, number: cycle.number, status: cycle.status, deadline: cycle.deadline, meetingDate: cycle.meetingDate },
    editable: cycle.status !== "FINAL",
    doc: state.doc,
    version: state.version,
    flags: state.flags,
    // источники отдаём только те, что нужны редактору: попавшие в пункты и не вошедшие
    sources: state.sources.filter((s) => used.has(s.id)),
    notIncluded: notIncluded(state.doc, state.sources),
    submission: summary,
    title: state.title,
    directorate: dir,
    unmappedTracks: unmapped,
    defs: state.defs,
  });
}

// Сохранение черновика. version — версия, с которой правили: если её уже обновили, 409 (клиент покажет и не потеряет правки).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const cycle = await prisma.cycle.findUnique({ where: { id } });
  if (!cycle || !canEditMemo(actor, cycle)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (cycle.status === "FINAL") return NextResponse.json({ error: "BAD_STATE" }, { status: 409 });

  const body = (await request.json().catch(() => null)) as { doc?: unknown; version?: number; meetingDate?: string | null } | null;
  const doc = parseMemoDoc(body?.doc);
  if (!doc || typeof body?.version !== "number") return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const bullets = doc.sections.reduce((n, s) => n + s.bullets.length, 0);
  if (
    doc.sections.length > MEMO_LIMITS.sections ||
    bullets > MEMO_LIMITS.bullets ||
    (doc.title && doc.title.length > MEMO_LIMITS.titleLength) ||
    doc.sections.some((s) => s.title.length > MEMO_LIMITS.titleLength || s.bullets.some((b) => b.text.length > MEMO_LIMITS.textLength))
  ) {
    return NextResponse.json({ error: "INVALID_INPUT", message: "Справка слишком большая." }, { status: 400 });
  }
  let meetingDate: Date | null | undefined;
  if (body.meetingDate !== undefined) {
    meetingDate = body.meetingDate ? new Date(body.meetingDate) : null;
    if (meetingDate && Number.isNaN(meetingDate.getTime())) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const res = await prisma.cycle.updateMany({
    where: { id, memoVersion: body.version, status: { not: "FINAL" } },
    data: { memoDraft: doc as unknown as Prisma.InputJsonValue, memoVersion: { increment: 1 }, ...(meetingDate !== undefined ? { meetingDate } : {}) },
  });
  if (res.count !== 1) {
    const current = await prisma.cycle.findUnique({ where: { id }, select: { memoVersion: true } });
    return NextResponse.json({ error: "CONFLICT", currentVersion: current?.memoVersion }, { status: 409 });
  }
  return NextResponse.json({ ok: true, version: body.version + 1 });
}
