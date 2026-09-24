import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { consolidatedToDoc, type Consolidated } from "@/lib/ai-shared";
import { isExecutive } from "@/lib/ai-server";
import { renderMemoDocx, renderMemoPdf } from "@/lib/memo-export";
import { withApiErrors } from "@/lib/api-guard";
import { enforceRateLimit } from "@/lib/rate-limit";

// Сводная справка файлом: клиент присылает уже собранную сводку, сервер только оформляет её как обычную справку.
async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!isExecutive(actor)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const limited = await enforceRateLimit(`ai-export:${actor.id}`, 30, 600000, "выгрузок");
  if (limited) return limited;
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "pdf" && format !== "docx") return NextResponse.json({ error: "INVALID_FORMAT" }, { status: 400 });
  const c = (await request.json().catch(() => null)) as Consolidated | null;
  if (!c || !Array.isArray(c.topics) || typeof c.title !== "string") return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const title = c.title.slice(0, 300);
  const doc = consolidatedToDoc({
    title,
    summary: String(c.summary ?? "").slice(0, 4000),
    aiUsed: !!c.aiUsed,
    topics: c.topics.slice(0, 60).map((t) => ({
      title: String(t.title).slice(0, 300),
      items: (Array.isArray(t.items) ? t.items : []).slice(0, 200).map((i) => ({ text: String(i.text).slice(0, 3000), directorate: String(i.directorate ?? "").slice(0, 200), versionId: "", bulletId: "" })),
    })),
  });
  const buf = format === "pdf" ? await renderMemoPdf(title, doc) : await renderMemoDocx(title, doc);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="svodnaya-spravka.${format}"`,
    },
  });
}

export const POST = withApiErrors(POSTHandler);
