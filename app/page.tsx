import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";

// ЗГД работает с итогами дирекций, остальные — с рабочей таблицей (директор — с «Оперативкой» через меню).
export default async function Home() {
  const actor = await requireActor().catch(() => null);
  redirect(actor?.role === "EXECUTIVE" ? "/operativka" : "/table");
}
