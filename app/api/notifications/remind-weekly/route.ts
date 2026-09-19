import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { remindWeeklyUpdates } from "@/lib/notifications";

/**
 * Два способа запуска (решение заказчика — "все варианты"):
 *  1) вручную — кнопка Куратора на Dashboard;
 *  2) автоматически — внешний планировщик шлёт POST с заголовком
 *     `x-cron-secret`, равным переменной окружения CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const viaCron = !!secret && request.headers.get("x-cron-secret") === secret;
  if (!viaCron) {
    const session = await getSession();
    if (!session || session.role !== "CURATOR") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
  }
  const sent = await remindWeeklyUpdates();
  return NextResponse.json({ sent });
}
