"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Eye, LogOut, Search, Settings, X } from "lucide-react";
import { NotificationsBell } from "@/components/NotificationsBell";
import { clearBootstrap, loadBootstrap } from "@/lib/client-bootstrap";
import { setPreview } from "@/lib/preview-as";
import { Avatar } from "@/components/ui/Avatar";
import { MenuItem, Popover } from "@/components/ui/Popover";

type Me = {
  id: string;
  name: string;
  email: string;
  role: "HEAD" | "DIRECTOR" | "ADMIN" | "EXECUTIVE" | "SYSTEM_ADMIN";
  memoEditor?: boolean;
} | null;

export const ROLE_LABEL: Record<string, string> = {
  HEAD: "Руководитель",
  DIRECTOR: "Директор",
  ADMIN: "Админ",
  EXECUTIVE: "ЗГД",
  SYSTEM_ADMIN: "Технический администратор",
};

// Меню по ролям (TZ_v4, раздел 8).
const ROLE_ORDER: Record<string, number> = { EXECUTIVE: 0, ADMIN: 1, DIRECTOR: 2, HEAD: 3, SYSTEM_ADMIN: 4 };

export const NAV_BY_ROLE: Record<string, Array<{ href: string; label: string }>> = {
  HEAD: [
    { href: "/table", label: "Таблица" },
    { href: "/archive", label: "Архив" },
  ],
  DIRECTOR: [
    { href: "/operativka", label: "Оперативка" },
    { href: "/table", label: "Общая таблица" },
    { href: "/archive", label: "Архив" },
  ],
  ADMIN: [
    { href: "/operativka", label: "Оперативка" },
    { href: "/table", label: "Общая таблица" },
    { href: "/archive", label: "Архив" },
  ],
  EXECUTIVE: [{ href: "/operativka", label: "Оперативка" }],
  SYSTEM_ADMIN: [
    { href: "/table", label: "Таблица" },
    { href: "/archive", label: "Архив" },
  ],
};

const SEARCH_PATHS = ["/table", "/archive"];

/** Поиск хранится в адресе (?q=…): таблица читает его оттуда, без связи между компонентами. */
function TopSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [value, setValue] = useState(urlQ);
  const lastPushed = useRef(urlQ);

  useEffect(() => {
    if (urlQ !== lastPushed.current) {
      lastPushed.current = urlQ;
      setValue(urlQ);
    }
  }, [urlQ]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (value === lastPushed.current) return;
      lastPushed.current = value;
      const next = new URLSearchParams(params.toString());
      if (value) next.set("q", value);
      else next.delete("q");
      router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative hidden w-72 md:block lg:ml-4 xl:w-96">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setValue("")}
        placeholder="Поиск: задача, комментарий, трек, ответственный, статус…"
        aria-label="Поиск по таблице"
        maxLength={200}
        className="input w-full pl-9 pr-9"
      />
      {value && (
        <button onClick={() => setValue("")} className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-outline hover:bg-surface-high hover:text-on-surface" title="Очистить поиск (Esc)" aria-label="Очистить поиск">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  // люди, глазами которых можно посмотреть систему (грузятся при открытии меню)
  const [people, setPeople] = useState<Array<{ id: string; name: string; role: string; directorateId: string | null }> | null>(null);
  const [viewAs, setViewAs] = useState<{ id: string; name: string; role: string; realName: string } | null>(null);
  const [directorate, setDirectorate] = useState<{ id: string; name: string } | null>(null);
  const [directorates, setDirectorates] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (pathname === "/login") {
      clearBootstrap(); // после входа под другим пользователем данные должны загрузиться заново
      return;
    }
    loadBootstrap().then((b) => {
      setMe((b?.user as Me) ?? null);
      setViewAs(b?.viewAs ?? null);
      setPreview(b?.viewAs ? { id: b.viewAs.id, name: b.viewAs.name, role: b.viewAs.role } : null);
      setDirectorate(b?.directorate ?? null);
      setDirectorates(b?.directorates ?? []);
    });
  }, [pathname]);

  // Админ выбирает дирекцию, в которой работает: выбор хранится на сервере (кука), после него страница загружается заново.
  async function chooseDirectorate(id: string) {
    await fetch("/api/directorates/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    clearBootstrap();
    window.location.reload();
  }

  async function loadPeople() {
    if (people) return;
    const r = await fetch("/api/users?all=1&everywhere=1").then((x) => (x.ok ? x.json() : null)).catch(() => null);
    setPeople((r?.users ?? []).filter((u: { isActive: boolean }) => u.isActive));
  }

  // «Посмотреть как»: режим включает сервер (кука), после чего данные и меню грузятся заново от имени выбранного человека
  async function startViewAs(userId: string | null) {
    await fetch("/api/view-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
    clearBootstrap();
    router.push("/");
    router.refresh();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearBootstrap();
    setPreview(null);
    router.push("/login");
    router.refresh();
  }

  if (pathname === "/login") {
    return <main className="min-h-0 flex-1 overflow-auto">{children}</main>;
  }

  // Режим просмотра доступен админу (любой человек) и директору (руководители его дирекции); в нём меню и данные — того, кого смотрят.
  const previewing = viewAs;
  const canPreview = !viewAs && (me?.role === "ADMIN" || me?.role === "SYSTEM_ADMIN" || me?.role === "DIRECTOR");
  const effRole = me?.role;
  const baseNav = effRole ? NAV_BY_ROLE[effRole] ?? [] : [];
  // назначенный админом составитель справки (руководитель) видит «Оперативку»
  const nav = effRole === "HEAD" && me?.memoEditor ? [baseNav[0], { href: "/operativka", label: "Оперативка" }, ...baseNav.slice(1)] : baseNav;

  return (
    <>
      {/* на очень узком экране лишнее обрезается по ширине (clip, а не auto: auto заодно обрезал бы выпадающие меню по высоте) */}
      <header className="z-30 flex h-16 shrink-0 items-center gap-4 overflow-x-clip border-b border-outline-variant bg-surface px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" title="ГШП Оперативка">
          <Image src="/logo.svg" alt="" width={36} height={36} className="shrink-0" priority />
          <span className="hidden text-[13px] font-bold tracking-tight text-on-surface lg:inline">ГШП ОПЕРАТИВКА</span>
        </Link>

        {directorate &&
          (directorates.length > 1 ? (
            <Popover
              width={340}
              trigger={({ toggle }) => (
                <button onClick={toggle} className="hidden max-w-64 items-center gap-1.5 rounded-md border border-outline-variant px-2.5 py-1.5 text-left transition-colors hover:bg-surface-high xl:flex" title="Сменить дирекцию">
                  <span className="truncate text-[12px] font-semibold text-on-surface">{directorate.name}</span>
                  <ChevronDown size={14} className="shrink-0 text-outline" />
                </button>
              )}
            >
              {(close) => (
                <div className="py-1">
                  <p className="label-caps px-3.5 pb-1 pt-1.5">Дирекция</p>
                  {directorates.map((d) => (
                    <MenuItem
                      key={d.id}
                      onClick={() => {
                        close();
                        if (d.id !== directorate.id) chooseDirectorate(d.id);
                      }}
                      icon={d.id === directorate.id ? <Check size={15} className="text-primary" /> : <span className="w-[15px]" />}
                    >
                      {d.name}
                    </MenuItem>
                  ))}
                </div>
              )}
            </Popover>
          ) : (
            <span className="hidden max-w-64 truncate text-[12px] text-on-surface-variant xl:inline" title={directorate.name}>
              {directorate.name}
            </span>
          ))}

        {SEARCH_PATHS.some((p) => pathname.startsWith(p)) && (
          <Suspense fallback={null}>
            <TopSearch />
          </Suspense>
        )}

        <nav className="flex h-full shrink-0 items-stretch gap-1 lg:ml-2">
          {nav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center border-b-2 px-3 text-[13px] font-semibold transition-colors ${
                  active ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Сюда страницы выносят свои действия (например, экспорт таблицы) через портал. */}
          <div id="header-actions" className="flex items-center" />
          {me && <NotificationsBell />}
          {(effRole === "SYSTEM_ADMIN" || effRole === "ADMIN" || effRole === "DIRECTOR") && (
            <Link
              href="/settings"
              title="Настройки"
              className={`btn-icon ${pathname.startsWith("/settings") ? "bg-primary-soft text-primary" : ""}`}
            >
              <Settings size={18} />
            </Link>
          )}
          <span className="mx-2 h-6 w-px bg-outline-variant" />
          {me && (
            <Popover
              align="right"
              width={260}
              trigger={({ toggle }) => (
                <button onClick={() => { loadPeople(); toggle(); }} className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-surface-high">
                  <Avatar name={me.name} />
                  <span className="hidden max-w-40 truncate text-[13px] font-semibold text-on-surface lg:inline">{me.name}</span>
                  <ChevronDown size={14} className="text-outline" />
                </button>
              )}
            >
              {() => (
                <div>
                  <div className="border-b border-outline-variant px-3.5 pb-2.5 pt-1.5">
                    <p className="text-[13px] font-semibold text-on-surface">{me.name}</p>
                    <p className="text-[12px] text-on-surface-variant">{ROLE_LABEL[me.role]}</p>
                  </div>
                  {previewing && (
                    <div className="border-b border-outline-variant py-1.5">
                      <MenuItem onClick={() => startViewAs(null)} icon={<Eye size={15} />}>
                        Выйти из режима просмотра
                      </MenuItem>
                    </div>
                  )}
                  {canPreview && (
                    <div className="border-b border-outline-variant py-1.5">
                      <p className="label-caps px-3.5 pb-1 pt-1">Посмотреть как…</p>
                      <div className="max-h-72 overflow-y-auto">
                        {!people && <p className="px-3.5 py-2 text-[12px] text-outline">Загрузка…</p>}
                        {people && people.filter((u) => u.id !== me?.id).length === 0 && <p className="px-3.5 py-2 text-[12px] text-outline">Других пользователей нет</p>}
                        {(people ?? [])
                          .filter((u) => u.id !== me?.id && (me?.role !== "DIRECTOR" || u.role === "HEAD"))
                          .sort((x, y) => (ROLE_ORDER[x.role] ?? 9) - (ROLE_ORDER[y.role] ?? 9) || x.name.localeCompare(y.name, "ru"))
                          .map((u) => (
                            <MenuItem key={u.id} onClick={() => startViewAs(u.id)} icon={<Avatar name={u.name} size={18} />}>
                              <span className="flex flex-col leading-tight">
                                <span>{u.name}</span>
                                <span className="text-[11px] text-on-surface-variant">{ROLE_LABEL[u.role] ?? u.role}</span>
                              </span>
                            </MenuItem>
                          ))}
                      </div>
                    </div>
                  )}
                  <MenuItem onClick={logout} icon={<LogOut size={15} />}>
                    Выйти
                  </MenuItem>
                </div>
              )}
            </Popover>
          )}
        </div>
      </header>
      {previewing && (
        <div className="flex flex-wrap items-center gap-3 border-b border-primary/20 bg-primary-soft px-4 py-2 text-[13px] text-primary">
          <Eye size={15} className="shrink-0" />
          <span className="min-w-0 flex-1">
            Режим просмотра: вы (<strong className="font-semibold">{previewing.realName}</strong>) видите систему глазами <strong className="font-semibold">{previewing.name}</strong> — {ROLE_LABEL[previewing.role] ?? previewing.role}. Изменения в этом режиме отключены.
          </span>
          <button onClick={() => startViewAs(null)} className="btn-ghost h-8 bg-surface">
            Выйти из режима
          </button>
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </>
  );
}
