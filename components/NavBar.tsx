"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Me = { id: string; name: string; email: string; role: "RESPONSIBLE" | "CURATOR" | "MANAGER" } | null;

const ROLE_LABEL: Record<string, string> = {
  RESPONSIBLE: "Ответственный",
  CURATOR: "Куратор",
  MANAGER: "Руководитель",
};

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);

  useEffect(() => {
    if (pathname === "/login") return;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => setMe(d.user))
      .catch(() => setMe(null));
  }, [pathname]);

  if (pathname === "/login") return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-8">
          <Link href="/tracks" className="text-sm font-semibold tracking-tight">
            ГШП ФЛОТ-ТРЕКЕР
          </Link>
          <nav className="flex gap-5 text-sm text-neutral-600">
            <Link href="/tracks" className={pathname.startsWith("/tracks") ? "text-neutral-900 font-medium" : ""}>
              Треки
            </Link>
            <Link href="/tasks" className={pathname.startsWith("/tasks") ? "text-neutral-900 font-medium" : ""}>
              Задачи
            </Link>
            <Link
              href="/vessel-options"
              className={pathname.startsWith("/vessel-options") ? "text-neutral-900 font-medium" : ""}
            >
              Варианты судов
            </Link>
            {me?.role === "CURATOR" && (
              <Link href="/settings" className={pathname.startsWith("/settings") ? "text-neutral-900 font-medium" : ""}>
                Справочники
              </Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          {me && (
            <span>
              {me.name} · {ROLE_LABEL[me.role]}
            </span>
          )}
          <button onClick={logout} className="rounded-md border border-neutral-300 px-3 py-1 hover:bg-neutral-100">
            Выйти
          </button>
        </div>
      </div>
    </header>
  );
}
