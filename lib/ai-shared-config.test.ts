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

describe("адрес по ключу", () => {
  it("ключ Groq с адресом OpenAI по умолчанию уходит в Groq; NVIDIA — в NVIDIA; свои адреса не трогаем", async () => {
    const { baseUrlForKey } = await import("@/lib/ai-server");
    expect(baseUrlForKey("gsk_x", "https://api.openai.com/v1")).toBe("https://api.groq.com/openai/v1");
    expect(baseUrlForKey("nvapi-x", "https://api.openai.com/v1")).toBe("https://integrate.api.nvidia.com/v1");
    expect(baseUrlForKey("sk-x", "https://api.openai.com/v1")).toBe("https://api.openai.com/v1");
    expect(baseUrlForKey("gsk_x", "https://api.groq.com/openai/v1")).toBe("https://api.groq.com/openai/v1");
  });
  it("отказали все звенья — в ошибке причина каждого", async () => {
    const cfg = { provider: "openai" as const, baseUrl: "https://api.groq.com/openai/v1", model: "g", apiKey: "a", fallback: { provider: "openai" as const, baseUrl: "https://integrate.api.nvidia.com/v1", model: "n", apiKey: "b" } };
    await expect(withAiFallback(cfg, 10, async (c) => { throw new AiError("BAD_KEY", `ключ ${c.model} не принят.`); })).rejects.toThrow("ключ g не принят. Запасной вариант тоже не сработал: ключ n не принят.");
  });
});

describe("выбор модели в чате", () => {
  const shared = { provider: "openai" as const, baseUrl: "https://api.groq.com/openai/v1", model: "g", apiKey: "a", shared: true, fallback: { provider: "openai" as const, baseUrl: "https://integrate.api.nvidia.com/v1", model: "n", apiKey: "b" } };
  it("«Авто» — как настроено, с переходом к большому окну; явный выбор — выбранная первой, вторая только при сбое", async () => {
    const { chainForEngine } = await import("@/lib/ai-server");
    expect(chainForEngine(shared, "auto")).toMatchObject({ preroute: true, chain: { model: "g" } });
    expect(chainForEngine(shared, "primary")).toMatchObject({ preroute: false, chain: { model: "g", fallback: { model: "n" } } });
    const nv = chainForEngine(shared, "fallback");
    expect(nv).toMatchObject({ preroute: false, chain: { model: "n", fallback: { model: "g" } } });
    expect((nv.chain.fallback as { fallback?: unknown }).fallback).toBeUndefined();
  });
  it("явно выбран Groq — большие справки не уводятся в NVIDIA (сжимаются под Groq)", async () => {
    const used: string[] = [];
    await withAiFallback(shared, 50000, async (c) => { used.push(c.model); return 1; }, false);
    expect(used).toEqual(["g"]);
  });
  it("со своим ключом выбора нет — работает его модель", async () => {
    const { chainForEngine } = await import("@/lib/ai-server");
    const own = { ...shared, shared: false };
    expect(chainForEngine(own, "fallback")).toMatchObject({ preroute: true, chain: { model: "g" } });
  });
});

describe("ключ в форме — не пароль, подставленный браузером", () => {
  it("looksLikeApiKey: настоящие ключи проходят, короткое и с пробелами — нет", async () => {
    const { looksLikeApiKey } = await import("@/lib/ai-server");
    expect(looksLikeApiKey("gsk_" + "a".repeat(48))).toBe(true);
    expect(looksLikeApiKey("nvapi-" + "B".repeat(60))).toBe(true);
    expect(looksLikeApiKey("Maykov2026!")).toBe(false);
    expect(looksLikeApiKey("gsk_abc def ghi jkl mno pqr")).toBe(false);
  });
});
