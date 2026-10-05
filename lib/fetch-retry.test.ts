import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFirstByteRetry, fetchRetry } from "@/lib/fetch-retry";

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
  it("зависший запрос обрывается по таймеру и повторяется; отмену самим человеком не повторяет", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => {
      calls++;
      if (calls === 1) return new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("timeout", "TimeoutError"))));
      return Promise.resolve(new Response("ok", { status: 200 }));
    });
    expect((await fetchRetry("/api/x", {}, 1, 30)).status).toBe(200);
    expect(calls).toBe(2);
    const ctl = new AbortController();
    let n = 0;
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => { n++; return new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))); });
    const p = fetchRetry("/api/x", { signal: ctl.signal }, 1, 5000);
    ctl.abort();
    await expect(p).rejects.toThrow();
    expect(n).toBe(1);
  });
  it("запись (POST) не повторяет — иначе действие выполнилось бы дважды", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", f);
    await expect(fetchRetry("/api/x", { method: "POST" }, 1)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("fetchFirstByteRetry: ИИ не висит на зависшем экземпляре", () => {
  it("не начал отвечать вовремя — повтор; кнопка «Стоп» — без повтора", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => {
      calls++;
      if (calls === 1) return new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("t", "TimeoutError"))));
      return Promise.resolve(new Response("ответ", { status: 200 }));
    });
    expect(await (await fetchFirstByteRetry("/api/ai/chat", { method: "POST" }, 20)).text()).toBe("ответ");
    expect(calls).toBe(2);
    const stop = new AbortController();
    let n = 0;
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => { n++; return new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("a", "AbortError")))); });
    const p = fetchFirstByteRetry("/api/ai/chat", { method: "POST", signal: stop.signal }, 5000);
    stop.abort();
    await expect(p).rejects.toThrow();
    expect(n).toBe(1);
  });
});
