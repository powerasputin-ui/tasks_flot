"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Me = { id: string; name: string; email: string; role: "RESPONSIBLE" | "CURATOR" | "MANAGER" } | null;

const ROLE_LABEL: Record<string, string> = {
  RESPONSIBLE: "Ответственный",
  CURATOR: "Куратор",
  MANAGER: "Руководитель",
};

const NAV_ITEMS = [{ href: "/tracks", label: "Треки" }];

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (pathname === "/login") return;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => setMe(d.user))
      .catch(() => setMe(null));
  }, [pathname]);

  if (pathname === "/login") return null;

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-white/80 backdrop-blur-md">
      <div className="flex w-full items-center justify-between px-6 py-3">
        <div className="flex items-center gap-8">
          <Link href="/tracks" className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-neutral-900">
            <Image src="/logo.svg" alt="" width={44} height={44} className="shrink-0" />
            ГШП ТРЕКЕР
          </Link>
          <nav className="flex gap-1 text-[13px]">
            {(me?.role === "MANAGER" || me?.role === "CURATOR"
              ? [{ href: "/dashboard", label: "Dashboard" }, ...NAV_ITEMS, { href: "/weekly-digest", label: "Дайджест недели" }]
              : NAV_ITEMS
            ).map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative rounded-md px-2.5 py-1.5 transition-colors duration-150 ${
                    active ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-800"
                  }`}
                >
                  {item.label}
                  <span
                    className={`absolute inset-x-2.5 -bottom-[13px] h-[2px] rounded-full bg-neutral-900 transition-transform duration-200 ${
                      active ? "scale-x-100" : "scale-x-0"
                    }`}
                  />
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-[13px] text-neutral-500">
          {me && (
            <span className="hidden sm:inline">
              {me.name} <span className="text-neutral-300">·</span> {ROLE_LABEL[me.role]}
            </span>
          )}
          {me?.role === "CURATOR" && (
            <Link
              href="/settings"
              title="Настройки"
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ${
                pathname.startsWith("/settings") ? "bg-neutral-100 text-neutral-900" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
              }`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </Link>
          )}
          <button onClick={logout} disabled={loggingOut} className="btn-ghost">
            {loggingOut ? "Выход…" : "Выйти"}
          </button>
        </div>
      </div>
    </header>
  );
}
