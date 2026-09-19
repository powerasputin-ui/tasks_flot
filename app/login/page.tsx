"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError("Неверный e-mail или пароль");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Нет связи с сервером. Повторите попытку.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-[radial-gradient(ellipse_at_top,_#e6f0fa,_#f4f6f9_60%)] px-4 py-10">
      <form onSubmit={handleSubmit} className="surface animate-fade-in w-full max-w-sm p-8 shadow-lg">
        <div className="mb-7 flex flex-col items-center text-center">
          <Image src="/logo.svg" alt="ГШП" width={64} height={64} priority />
          <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-on-surface">ГШП Оперативка</h1>
          <p className="mt-1 text-[13px] text-on-surface-variant">Войдите, чтобы продолжить</p>
        </div>

        <label className="mb-1 block text-[12px] font-medium text-on-surface-variant">E-mail</label>
        <input
          type="email"
          required
          autoFocus
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input mb-4 w-full"
        />

        <label className="mb-1 block text-[12px] font-medium text-on-surface-variant">Пароль</label>
        <div className="relative mb-4">
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input w-full pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-outline hover:text-on-surface"
            title={showPassword ? "Скрыть пароль" : "Показать пароль"}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {error && (
          <p className="animate-fade-in mb-4 flex items-center gap-2 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-[13px] text-status-red">
            <AlertCircle size={15} className="shrink-0" />
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="btn-primary h-10 w-full">
          {loading ? "Вход…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
