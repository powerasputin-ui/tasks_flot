import { afterEach, describe, expect, it } from "vitest";
import { AiError, type AiConfig } from "@/lib/ai";
import { sharedAiConfig, withAiFallback } from "@/lib/ai-server";

const KEYS = ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL", "AI_FALLBACK_API_KEY", "AI_FALLBACK_BASE_URL", "AI_FALLBACK_MODEL"];
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("общее подключение ИИ для организации", () => {
  it("без переменных — не подключено; с ключом — Groq GPT-OSS 120B по умолчанию; с запасным — NVIDIA Nemotron", () => {
    expect(sharedAiConfig()).toBeNull();
    process.env.AI_API_KEY = "gsk_x";
    expect(sharedAiConfig()).toMatchObject({ baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", apiKey: "gsk_x" });
    process.env.AI_FALLBACK_API_KEY = "nvapi-y";
    expect(sharedAiConfig()?.fallback).toMatchObject({ baseUrl: "https://integrate.api.nvidia.com/v1", model: "nvidia/nemotron-3-super-120b-a12b" });
  });
  it("недопустимый адрес из переменной не принимается", () => {
    process.env.AI_API_KEY = "k";
    process.env.AI_BASE_URL = "ftp://x";
    expect(sharedAiConfig()).toBeNull();
  });
});

describe("запасной провайдер", () => {
  const groq: AiConfig & { fallback?: AiConfig } = { provider: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "g", apiKey: "a", fallback: { provider: "openai", baseUrl: "https://integrate.api.nvidia.com/v1", model: "n", apiKey: "b" } };
  it("лимит или сбой у основного — ответ от запасного", async () => {
    const used: string[] = [];
    const out = await withAiFallback(groq, 100, async (c) => {
      used.push(c.model);
      if (c.model === "g") throw new AiError("RATE_LIMIT", "лимит");
      return "ок";
    });
    expect(out).toBe("ок");
    expect(used).toEqual(["g", "n"]);
  });
  it("ключ основного отклонён — отвечает запасной; отказали все — видна ошибка первого", async () => {
    expect(await withAiFallback(groq, 100, async (c) => { if (c.model === "g") throw new AiError("BAD_KEY", "ключ Groq"); return "ок"; })).toBe("ок");
    await expect(withAiFallback(groq, 100, async (c) => { throw new AiError("BAD_KEY", `ключ ${c.model}`); })).rejects.toThrow("ключ g");
  });
  it("ключ из переменной очищается от лишнего", async () => {
    const { cleanEnvKey } = await import("@/lib/ai-server");
    expect(cleanEnvKey(" GROQ=gsk_abc\n")).toBe("gsk_abc");
    expect(cleanEnvKey('"nvapi-x"')).toBe("nvapi-x");
    expect(cleanEnvKey("gsk_plain")).toBe("gsk_plain");
  });
  it("справки не влезают в окно основного — сразу запасной с большим окном", async () => {
    const used: string[] = [];
    await withAiFallback(groq, 50000, async (c) => { used.push(c.model); return 1; });
    expect(used).toEqual(["n"]);
  });
});
