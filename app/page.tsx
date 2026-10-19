import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";

// Стартовая страница — «Мой день» (что требует внимания сегодня), как «Your work» в Jira; у системного админа его нет — таблица.
export default async function Home() {
  const actor = await requireActor().catch(() => null);
  redirect(actor?.role === "SYSTEM_ADMIN" ? "/table" : "/today");
}
