import { describe, expect, it } from "vitest";
import { guessRootPath, joinWinPath } from "@/lib/fs-access";

describe("joinWinPath", () => {
  it("корень + положение файла внутри корня → путь Windows", () => {
    expect(joinWinPath("\\\\10.10.51.51\\флот", ["07 ОФФШОР", "MPSV", "Tidebon v1.3.pptx"])).toBe("\\\\10.10.51.51\\флот\\07 ОФФШОР\\MPSV\\Tidebon v1.3.pptx");
  });
  it("лишние слэши в конце корня и диск без папки не ломают путь", () => {
    expect(joinWinPath("Z:\\Отдел\\", ["a.xlsx"])).toBe("Z:\\Отдел\\a.xlsx");
    expect(joinWinPath("Z:\\", ["a.xlsx"])).toBe("Z:\\a.xlsx");
    expect(joinWinPath("  \\\\srv\\share  ", ["x", "y.txt"])).toBe("\\\\srv\\share\\x\\y.txt");
  });
});

describe("guessRootPath", () => {
  it("папка-диск угадывается, остальное человек вписывает сам", () => {
    expect(guessRootPath("Z:\\")).toBe("Z:\\");
    expect(guessRootPath("z:")).toBe("Z:\\");
    expect(guessRootPath("Отдел флота")).toBe("");
  });
});
