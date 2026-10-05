import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRetry } from "@/lib/fetch-retry";

afterEach(() => vi.unstubAllGlobals());

describe("fetchRetry: повтор при обрыве после простоя", () => {
  it("обрыв связи — повторяет один раз и отдаёт второй ответ", async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect((await fetchRetry("/api/x", {}, 1)).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("504 от шлюза — повтор; 500 и 401 — без повтора (это не обрыв)", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("", { status: 504 })).mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect((await fetchRetry("/api/x", {}, 1)).status).toBe(200);
    for (const code of [500, 401]) {
      const g = vi.fn().mockResolvedValue(new Response("", { status: code }));
      vi.stubGlobal("fetch", g);
      expect((await fetchRetry("/api/x", {}, 1)).status).toBe(code);
      expect(g).toHaveBeenCalledTimes(1);
    }
  });
  it("запись (POST) не повторяет — иначе действие выполнилось бы дважды", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", f);
    await expect(fetchRetry("/api/x", { method: "POST" }, 1)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
