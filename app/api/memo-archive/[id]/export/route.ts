import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canViewVersion } from "@/lib/memo-versions";
import { parseMemoDoc } from "@/lib/memo";
import { renderMemoDocx, renderMemoPdf } from "@/lib/memo-export";
import { withApiErrors } from "@/lib/api-guard";

// Отправленная справка файлом: ?format=pdf | docx
async function GETHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const v = await prisma.memoVersion.findUnique({ where: { id } });
  if (!v || !canViewVersion(actor, v)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "pdf" && format !== "docx") return NextResponse.json({ error: "INVALID_FORMAT" }, { status: 400 });
  const doc = parseMemoDoc(v.doc) ?? { sections: [] };
  const buf = format === "pdf" ? await renderMemoPdf(v.title, doc) : await renderMemoDocx(v.title, doc);
  const stamp = (v.meetingDate ?? v.sentAt).toISOString().slice(0, 10);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="spravka-${stamp}-red${v.revision}.${format}"`,
    },
  });
}

export const GET = withApiErrors(GETHandler);
