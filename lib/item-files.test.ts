import { describe, expect, it } from "vitest";
import { buildShortcut, fileBadge, filesText, normalizeFiles, parseFilePath, readFiles, shortcutBytes } from "@/lib/item-files";

const UNC = "\\\\10.10.51.51\\флот\\5. Развитие и приобретение флота\\07 ОФФШОРНЫЙ ФЛОТ\\MPSV TIDEBON 803\\MPSV Tidebon v1.3.pptx";

describe("parseFilePath", () => {
  it("сетевой путь: имя, тип, папка; кавычки из «Копировать как путь» убираются", () => {
    const p = parseFilePath(`  "${UNC}"  `);
    expect(p).toMatchObject({ ok: true, name: "MPSV Tidebon v1.3.pptx", ext: "pptx", kind: "unc", path: UNC });
    if (p.ok) expect(p.folder).toBe("\\\\10.10.51.51\\флот\\5. Развитие и приобретение флота\\07 ОФФШОРНЫЙ ФЛОТ\\MPSV TIDEBON 803");
  });
  it("диск, папка и веб-ссылка", () => {
    expect(parseFilePath("D:\\Отчёты\\март.xlsx")).toMatchObject({ ok: true, kind: "drive", ext: "xlsx", name: "март.xlsx" });
    expect(parseFilePath("\\\\srv\\share\\Папка\\")).toMatchObject({ ok: true, kind: "folder", name: "Папка", ext: "" });
    expect(parseFilePath("https://company.sharepoint.com/sites/a/Документ%20один.docx?web=1")).toMatchObject({ ok: true, kind: "web", name: "Документ один.docx" });
  });
  it("file:// превращается в обычный путь", () => {
    expect(parseFilePath("file://10.10.51.51/флот/a%20b/x.pdf")).toMatchObject({ ok: true, path: "\\\\10.10.51.51\\флот\\a b\\x.pdf" });
    expect(parseFilePath("file:///C:/Temp/x.pdf")).toMatchObject({ ok: true, path: "C:\\Temp\\x.pdf" });
  });
  it("не путь, исполняемые, недопустимые символы, слишком длинное — отказ", () => {
    for (const bad of ["", "   ", "привет", "флот/файл.xlsx", "C:", "\\\\srv", "\\\\srv\\share\\a.exe", "D:\\x\\run.BAT ", "D:\\x\\a?b.txt", "https://u:p@host/a.pdf", "javascript:alert(1)", "D:\\" + "а".repeat(600)])
      expect(parseFilePath(bad).ok, bad).toBe(false);
  });
});

describe("normalizeFiles", () => {
  const ids = () => {
    let n = 0;
    return () => `id${++n}`;
  };
  it("новые получают id, существующие сохраняют; повтор и лимит — ошибка", () => {
    const existing = [{ id: "keep", path: "D:\\a.txt", name: "a.txt" }];
    const r = normalizeFiles([{ id: "keep", path: "D:\\a.txt" }, { path: "D:\\b.txt" }], existing, ids());
    expect(r).toEqual({ ok: true, files: [{ id: "keep", path: "D:\\a.txt", name: "a.txt" }, { id: "id1", path: "D:\\b.txt", name: "b.txt" }] });
    expect(normalizeFiles([{ path: "D:\\a.txt" }, { path: "d:\\A.TXT" }], [], ids()).ok).toBe(false);
    expect(normalizeFiles(Array.from({ length: 11 }, (_, i) => ({ path: `D:\\f${i}.txt` })), [], ids()).ok).toBe(false);
  });
});

describe("ярлык и значки", () => {
  it("buildShortcut — путь как есть (проводник не раскодирует %-коды кириллицы), косые вместо обратных", () => {
    expect(buildShortcut(UNC)).toBe("[InternetShortcut]\r\nURL=file://10.10.51.51/флот/5. Развитие и приобретение флота/07 ОФФШОРНЫЙ ФЛОТ/MPSV TIDEBON 803/MPSV Tidebon v1.3.pptx\r\n");
    expect(buildShortcut("D:\\Отчёты\\март (1) #2.xlsx")).toContain("URL=file:///D:/Отчёты/март (1) #2.xlsx");
    expect(buildShortcut("https://x.y/z")).toContain("URL=https://x.y/z");
  });
  it("shortcutBytes — UTF-16 LE с BOM (иначе кириллица в .url не открывается)", () => {
    const b = shortcutBytes("D:\\Отчёты\\март.xlsx");
    expect([b[0], b[1]]).toEqual([0xff, 0xfe]);
    expect(Buffer.from(b.slice(2)).toString("utf16le")).toBe(buildShortcut("D:\\Отчёты\\март.xlsx"));
  });
  it("значок по расширению", () => {
    expect(fileBadge("pptx").label).toBe("PPT");
    expect(fileBadge("xyz").label).toBe("XYZ");
    expect(fileBadge("", "folder").label).toBe("ПАПКА");
  });
  it("readFiles/filesText терпят мусор из базы", () => {
    expect(readFiles(null)).toEqual([]);
    expect(readFiles([{ id: "1", path: "D:\\a", name: "a" }, { x: 1 }, null])).toHaveLength(1);
    expect(filesText([{ id: "1", path: "D:\\a", name: "a" }, { id: "2", path: "D:\\b", name: "b" }])).toBe("a; b");
    expect(filesText([])).toBeNull();
  });
});
