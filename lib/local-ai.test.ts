import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkModelFiles, LOCAL_MAX_BYTES, orderParts } from "@/lib/local-ai";

const GB = 1024 ** 3;

describe("локальная модель: выбор файлов", () => {
  it("один .gguf до ~3 ГБ — можно", () => {
    expect(checkModelFiles([{ name: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf", size: 2.5 * GB }])).toBeNull();
  });
  it("не .gguf, пусто, слишком большая — понятная ошибка", () => {
    expect(checkModelFiles([])).toMatch(/не выбран/);
    expect(checkModelFiles([{ name: "model.safetensors", size: 1 }])).toMatch(/\.gguf/);
    expect(checkModelFiles([{ name: "Qwen3-8B-Q4_K_M.gguf", size: 5 * GB }])).toMatch(/не поместится/);
    expect(checkModelFiles([{ name: "a.gguf", size: LOCAL_MAX_BYTES + 1 }])).toMatch(/до ~3 ГБ/);
  });
  it("части одной модели — все и по порядку", () => {
    const parts = [3, 1, 2].map((i) => ({ name: `m-0000${i}-of-00003.gguf`, size: 0.5 * GB }));
    expect(checkModelFiles(parts)).toBeNull();
    expect(orderParts(parts).map((p) => p.name)).toEqual(["m-00001-of-00003.gguf", "m-00002-of-00003.gguf", "m-00003-of-00003.gguf"]);
    expect(checkModelFiles(parts.slice(0, 2))).toMatch(/2 из 3/);
    expect(checkModelFiles([{ name: "a.gguf", size: 1 }, { name: "b.gguf", size: 1 }])).toMatch(/все части одной модели/);
  });
  it("движок в public/ — тот же, что у установленной библиотеки (обновили пакет — скопируйте .wasm)", () => {
    const a = readFileSync("public/wllama/wllama.wasm");
    const b = readFileSync("node_modules/@wllama/wllama/esm/wasm/wllama.wasm");
    expect(statSync("public/wllama/wllama.wasm").size).toBe(b.length);
    expect(a.equals(b)).toBe(true);
  });
});
