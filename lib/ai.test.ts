import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AiError, buildContext, complete, decryptKey, encryptKey, keyHint, normalizeBaseUrl, parseConsolidated, simpleMerge, streamText, type AiConfig, type MemoForAi } from "@/lib/ai";
import { consolidatedToDoc } from "@/lib/ai-shared";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
});
afterEach(() => vi.unstubAllGlobals());

const bullet = (id: string, text: string, itemIds: string[] = []) => ({ id, text, itemIds, origin: "auto" as const, edited: false, hidden: false, sourceHash: "" });
const memo = (id: string, directorate: string, texts: string[]): MemoForAi => ({
  id,
  directorate,
  title: `Справка ${directorate}`,
  date: "14.09.2026",
  revision: 1,
  doc: { sections: [{ id: "s", title: "Раздел", kind: "section", bullets: texts.map((t, i) => bullet(`${id}-b${i}`, t, i === 0 ? ["i1"] : [])) }] },
  sources: [{ id: "i1", title: "Задача про судно", comment: null, ownerName: "Иванов", statusName: "В работе", deadline: null, trackName: null, segmentName: null }],
});

describe("ключ ИИ", () => {
  it("шифруется и расшифровывается; в шифртексте ключа нет; подсказка — только конец", () => {
    const enc = encryptKey("sk-secret-1234567890");
    expect(enc).not.toContain("secret");
    expect(decryptKey(enc)).toBe("sk-secret-1234567890");
    expect(encryptKey("sk-secret-1234567890")).not.toBe(enc); // каждый раз новый IV
    expect(keyHint("sk-secret-1234567890")).toBe("…7890");
    expect(keyHint("short")).toBe("…");
  });
  it("подмена шифртекста не расшифровывается", () => {
    const [iv, tag, data] = encryptKey("abc").split(".");
    expect(() => decryptKey([iv, tag, Buffer.from("x").toString("base64") + data].join("."))).toThrow();
  });
});

describe("normalizeBaseUrl", () => {
  it("по умолчанию адрес провайдера, слэши в конце убираются, чужие схемы отклоняются", () => {
    expect(normalizeBaseUrl("", "openai")).toBe("https://api.openai.com/v1");
    expect(normalizeBaseUrl(" http://localhost:11434/v1/// ", "openai")).toBe("http://localhost:11434/v1");
    expect(normalizeBaseUrl("ftp://x", "openai")).toBeNull();
    expect(normalizeBaseUrl("не адрес", "anthropic")).toBeNull();
  });
});

describe("контекст и сводка", () => {
  const memos = [memo("m1", "Флот", ["Пункт один", "Пункт два"]), memo("m2", "Порты", ["Пункт три"])];

  it("пункты нумеруются сквозно, у пункта виден источник", () => {
    const ctx = buildContext(memos);
    expect(ctx).toContain("[1] Пункт один");
    expect(ctx).toContain("[3] Пункт три");
    expect(ctx).toContain("дирекция: Порты");
    expect(ctx).toContain("источник: Задача про судно · Иванов · В работе");
  });

  it("ответ ИИ → темы; ссылки на несуществующие номера и пункты без источника отбрасываются", () => {
    const raw = 'Вот: ' + JSON.stringify({ summary: "Главное", topics: [{ title: "Суда", items: [{ text: "Судно готово", refs: [1] }, { text: "Выдумка", refs: [99] }, { text: "Без ссылки" }] }, { title: "Пустая", items: [{ text: "x", refs: [77] }] }] });
    const c = parseConsolidated(raw, memos, "Заголовок");
    expect(c.aiUsed).toBe(true);
    expect(c.summary).toBe("Главное");
    expect(c.topics).toHaveLength(1);
    expect(c.topics[0].items).toEqual([{ text: "Судно готово", directorate: "Флот", versionId: "m1", bulletId: "m1-b0" }]);
  });

  it("ответ не JSON или без единой пригодной темы — ошибка, а не пустая сводка", () => {
    expect(() => parseConsolidated("не json", memos, "т")).toThrow(AiError);
    expect(() => parseConsolidated(JSON.stringify({ topics: [{ title: "a", items: [{ text: "x", refs: [50] }] }] }), memos, "т")).toThrow(AiError);
  });

  it("простая склейка: раздел на дирекцию, скрытые пункты не попадают; как документ — с «Главным» и дирекцией у пунктов ИИ", () => {
    const hiddenMemo = memo("m3", "Танкеры", ["Виден", "Скрыт"]);
    hiddenMemo.doc.sections[0].bullets[1].hidden = true;
    const merged = simpleMerge([memos[0], hiddenMemo], "Сводка", "предупреждение");
    expect(merged.aiUsed).toBe(false);
    expect(merged.topics.map((t) => [t.title, t.items.length])).toEqual([["Флот", 2], ["Танкеры", 1]]);
    const doc = consolidatedToDoc({ title: "т", summary: "Кратко", aiUsed: true, topics: [{ title: "Суда", items: [{ text: "Судно готово", directorate: "Флот", versionId: "m1", bulletId: "b" }] }] });
    expect(doc.sections.map((s) => s.title)).toEqual(["Главное", "Суда"]);
    expect(doc.sections[1].bullets[0].text).toBe("Судно готово (Флот)");
  });
});

describe("запросы к провайдеру", () => {
  const openai: AiConfig = { provider: "openai", baseUrl: "https://api.example.com/v1", model: "m", apiKey: "KEY" };
  const claude: AiConfig = { provider: "anthropic", baseUrl: "https://api.anthropic.com", model: "c", apiKey: "KEY" };

  it("OpenAI-формат: адрес, заголовок ключа, system-сообщение; ответ берётся из choices", async () => {
    const f = vi.fn(async () => Response.json({ choices: [{ message: { content: "ок" } }] }));
    vi.stubGlobal("fetch", f);
    expect(await complete(openai, { system: "S", messages: [{ role: "user", content: "Q" }] })).toBe("ок");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer KEY");
    expect(JSON.parse(init.body as string).messages[0]).toEqual({ role: "system", content: "S" });
  });

  it("Anthropic-формат: /v1/messages, x-api-key, system отдельным полем", async () => {
    const f = vi.fn(async () => Response.json({ content: [{ text: "при" }, { text: "вет" }] }));
    vi.stubGlobal("fetch", f);
    expect(await complete(claude, { system: "S", messages: [{ role: "user", content: "Q" }] })).toBe("привет");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("KEY");
    expect(JSON.parse(init.body as string).system).toBe("S");
  });

  it("ошибки провайдера превращаются в понятные коды, ключ в сообщение не попадает", async () => {
    for (const [status, code] of [[401, "BAD_KEY"], [429, "RATE_LIMIT"], [404, "PROVIDER"], [500, "PROVIDER"]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("KEY leaked?", { status })));
      const e = await complete(openai, { system: "S", messages: [] }).catch((x) => x);
      expect(e).toBeInstanceOf(AiError);
      expect(e.code).toBe(code);
      if (status !== 500) expect(e.message).not.toContain("KEY");
    }
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect((await complete(openai, { system: "S", messages: [] }).catch((x) => x)).code).toBe("NETWORK");
  });

  it("поток: из событий обоих провайдеров достаётся только текст (в том числе кусок, разрезанный посреди строки)", async () => {
    const sse = (lines: string[]) => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); const all = lines.join("\n") + "\n"; c.enqueue(e.encode(all.slice(0, 25))); c.enqueue(e.encode(all.slice(25))); c.close(); } }));
    const read = async (s: ReadableStream<Uint8Array>) => { const r = s.getReader(); let out = ""; for (;;) { const { done, value } = await r.read(); if (done) return out; out += new TextDecoder().decode(value); } };

    vi.stubGlobal("fetch", vi.fn(async () => sse(['data: {"choices":[{"delta":{"content":"При"}}]}', 'data: {"choices":[{"delta":{"content":"вет"}}]}', "data: [DONE]"])));
    expect(await read(await streamText(openai, { system: "S", messages: [] }))).toBe("Привет");

    vi.stubGlobal("fetch", vi.fn(async () => sse(["event: message_start", 'data: {"type":"message_start"}', 'data: {"type":"content_block_delta","delta":{"text":"Здра"}}', 'data: {"type":"content_block_delta","delta":{"text":"вствуйте"}}'])));
    expect(await read(await streamText(claude, { system: "S", messages: [] }))).toBe("Здравствуйте");
  });
});

describe("normalizeBaseUrl: безопасность адреса", () => {
  it("адреса метаданных облака и логин/пароль в адресе запрещены всегда", () => {
    for (const u of ["http://169.254.169.254/latest", "http://[fe80::1]/v1", "http://metadata.google.internal/x", "http://100.100.100.200", "https://user:pass@api.example.com/v1"]) expect(normalizeBaseUrl(u, "openai")).toBeNull();
  });
  it("внутренние сети: в облачной сборке запрещены, в разработке и при AI_ALLOW_PRIVATE_URLS=1 — можно (локальный Ollama)", () => {
    const env = process.env as Record<string, string | undefined>;
    const was = { node: env.NODE_ENV, allow: env.AI_ALLOW_PRIVATE_URLS };
    try {
      env.NODE_ENV = "production";
      delete env.AI_ALLOW_PRIVATE_URLS;
      for (const u of ["http://localhost:11434/v1", "http://127.0.0.1/v1", "http://10.0.0.5/v1", "http://192.168.1.2/v1", "http://172.20.0.1/v1", "http://[::1]/v1", "http://intranet.internal/v1"]) expect(normalizeBaseUrl(u, "openai")).toBeNull();
      expect(normalizeBaseUrl("https://api.openai.com/v1", "openai")).toBe("https://api.openai.com/v1");
      expect(normalizeBaseUrl("http://172.32.0.1/v1", "openai")).not.toBeNull(); // 172.32 — уже не частная сеть
      env.AI_ALLOW_PRIVATE_URLS = "1";
      expect(normalizeBaseUrl("http://localhost:11434/v1", "openai")).toBe("http://localhost:11434/v1");
      env.NODE_ENV = "development";
      delete env.AI_ALLOW_PRIVATE_URLS;
      expect(normalizeBaseUrl("http://localhost:11434/v1", "openai")).toBe("http://localhost:11434/v1");
    } finally {
      env.NODE_ENV = was.node;
      if (was.allow === undefined) delete env.AI_ALLOW_PRIVATE_URLS;
      else env.AI_ALLOW_PRIVATE_URLS = was.allow;
    }
  });
});
