import { describe, expect, it } from "vitest";
import { jsonWithHeartbeat } from "@/lib/heartbeat-json";

describe("jsonWithHeartbeat: долгий ответ не молчит", () => {
  it("пока работа идёт, уходят пробелы; в конце — JSON, который читается как обычно", async () => {
    const res = jsonWithHeartbeat(new Promise((r) => setTimeout(() => r({ ok: 1, title: "Сводка" }), 60)), 15);
    const text = await res.text();
    expect(text.match(/^ +/)?.[0].length).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(text)).toEqual({ ok: 1, title: "Сводка" });
    expect(res.headers.get("content-type")).toContain("application/json");
  });
  it("работа упала — понятная ошибка тем же JSON", async () => {
    const res = jsonWithHeartbeat(Promise.reject(new Error("boom")), 15);
    expect(await res.json()).toMatchObject({ error: "PROVIDER" });
  });
});
