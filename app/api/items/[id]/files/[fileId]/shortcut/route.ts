import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { requireDirectorate } from "@/lib/scope";
import { canViewItems } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withApiErrors } from "@/lib/api-guard";
import { readFiles, shortcutBytes } from "@/lib/item-files";

// Ярлык Windows (.url) на файл общего диска: двойной щелчок открывает файл у того, у кого есть доступ к диску.
// Браузер не может открыть file:// со страницы сайта, поэтому отдаём маленький файл-ярлык. Сам файл сайт не видит и не хранит.
async function GETHandler(_request: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const actor = await requireActor();
  const { id, fileId } = await params;
  if (!canViewItems(actor.role)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const item = await prisma.operationalItem.findFirst({ where: { id, directorateId: requireDirectorate(actor) }, select: { files: true } });
  const file = item && readFiles(item.files).find((f) => f.id === fileId);
  if (!file) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const name = `${file.name.replace(/[\/:*?"<>|\r\n]+/g, "_").slice(0, 120) || "file"}.url`;
  return new NextResponse(Buffer.from(shortcutBytes(file.path)), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="file.url"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = withApiErrors(GETHandler);
