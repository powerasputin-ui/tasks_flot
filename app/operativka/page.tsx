import { redirect } from "next/navigation";
import { OperativkaView } from "@/components/OperativkaView";
import { requireActor } from "@/lib/session";

export default async function OperativkaPage() {
  // Руководитель, который заполняет таблицу, «Оперативку» не видит: у него полоса цикла прямо в таблице.
  // Роль читается из базы (а не из токена входа), сами данные закрыты на сервере отдельно.
  const actor = await requireActor().catch(() => null);
  if (actor?.role === "HEAD") redirect("/table");
  return <OperativkaView />;
}
