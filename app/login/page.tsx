"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        setError("Неверный email или пароль");
        return;
      }
      router.push("/tracks");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_#f5f6f8,_#fafafa)] px-4">
      <form
        onSubmit={handleSubmit}
        className="surface animate-fade-in w-full max-w-sm p-8"
      >
        <div className="mb-6">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-900 text-sm font-semibold text-white">
            Ф
          </div>
          <h1 className="text-[15px] font-semibold text-neutral-900">ГШП Трекер</h1>
          <p className="mt-0.5 text-[13px] text-neutral-500">Войдите, чтобы продолжить</p>
        </div>

        <label className="mb-1.5 block text-[12px] font-medium text-neutral-600">Email</label>
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input mb-4 w-full"
        />

        <label className="mb-1.5 block text-[12px] font-medium text-neutral-600">Пароль</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input mb-4 w-full"
        />

        {error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-600 animate-fade-in">{error}</p>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Вход…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
