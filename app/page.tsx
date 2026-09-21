import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

// Руководство работает только с финальными оперативками, остальные — с рабочей таблицей.
export default async function Home() {
  const session = await getSession();
  redirect(session?.role === "EXECUTIVE" ? "/operativka" : "/table");
}
