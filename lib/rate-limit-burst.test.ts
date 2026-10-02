import { describe, expect, it } from "vitest";
import { burstLimited, clientIp } from "@/lib/rate-limit";

describe("burstLimited: вал запросов отсекается до базы", () => {
  it("пропускает лимит, дальше 429 с Retry-After; другой ключ не затронут", () => {
    const key = `t:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(burstLimited(key, 3, 60_000)).toBeNull();
    const r = burstLimited(key, 3, 60_000);
    expect(r?.status).toBe(429);
    expect(Number(r?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(burstLimited(`${key}:other`, 3, 60_000)).toBeNull();
  });
});

describe("clientIp", () => {
  const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
  it("на Vercel берёт адрес, который проставила платформа, а не подставленный клиентом X-Forwarded-For", () => {
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6", "x-vercel-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "5.5.5.5" }))).toBe("5.5.5.5");
    expect(clientIp(req({ "x-forwarded-for": "7.7.7.7, 8.8.8.8" }))).toBe("7.7.7.7");
    expect(clientIp(req({}))).toBe("local");
  });
});
