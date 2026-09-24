import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canEditMemo, loadMemo } from "@/lib/memo-load";
import { renderMemoDocx, renderMemoPdf } from "@/lib/memo-export";
import { withApiErrors } from "@/lib/api-guard";

// Справка файлом: ?format=pdf | docx — по образцу заказчика.
async function GETHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const cycle = await prisma.cycle.findUnique({ where: { id } });
  if (!cycle || !canEditMemo(actor, cycle)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "pdf" && format !== "docx") return NextResponse.json({ error: "INVALID_FORMAT" }, { status: 400 });
  const state = await loadMemo(cycle);
  const stamp = cycle.meetingDate ? cycle.meetingDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const buf = format === "pdf" ? await renderMemoPdf(state.title, state.doc) : await renderMemoDocx(state.title, state.doc);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="spravka-${stamp}.${format}"`,
    },
  });
}

export const GET = withApiErrors(GETHandler);
