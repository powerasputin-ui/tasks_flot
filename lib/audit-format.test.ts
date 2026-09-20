import { describe, expect, it } from "vitest";
import { clipText, describeAuditAction, formatAuditValue, isLongChange } from "@/lib/audit-format";

const maps = { statusId: new Map([["s1", "В работе"]]), responsibleId: new Map([["u1", "Сухов В.А."]]) };

describe("formatAuditValue", () => {
  it("подставляет имена из справочников вместо id", () => {
    expect(formatAuditValue("statusId", "s1", maps)).toBe("В работе");
    expect(formatAuditValue("responsibleId", "u1", maps)).toBe("Сухов В.А.");
  });

  it("неизвестный id и пустое значение дают «—»", () => {
    expect(formatAuditValue("statusId", "zzz", maps)).toBe("—");
    expect(formatAuditValue("statusId", null, maps)).toBe("—");
    expect(formatAuditValue("comment", "", maps)).toBe("—");
  });

  it("форматирует Опер и произвольный текст", () => {
    expect(formatAuditValue("operFlag", "true")).toBe("да");
    expect(formatAuditValue("operFlag", "false")).toBe("нет");
    expect(formatAuditValue("title", "Переговоры")).toBe("Переговоры");
  });

  it("срок выводится датой", () => {
    expect(formatAuditValue("deadline", "2026-09-19T00:00:00.000Z")).toMatch(/\d{2}\.\d{2}\.\d{4}/);
  });
});

describe("describeAuditAction", () => {
  it("правка поля называет поле, служебные действия — словами", () => {
    expect(describeAuditAction("STATUS_CHANGE", "statusId")).toBe("изменил(а) «Статус»");
    expect(describeAuditAction("CREATE", null)).toBe("создал(а) позицию");
    expect(describeAuditAction("ARCHIVE", null)).toBe("отправил(а) в архив");
    expect(describeAuditAction("RESTORE", null)).toBe("вернул(а) из архива");
  });
});

describe("clipText / isLongChange", () => {
  it("короткий текст не меняется, длинный обрезается с многоточием", () => {
    expect(clipText("abc", 5)).toBe("abc");
    expect(clipText("abcdefgh", 5)).toBe("abcde…");
  });

  it("длинным считается значение дольше порога или с переводом строки", () => {
    expect(isLongChange("—", "Завершено")).toBe(false);
    expect(isLongChange("—", "x".repeat(41))).toBe(true);
    expect(isLongChange("строка 1\nстрока 2", "—")).toBe(true);
    expect(isLongChange(null, null)).toBe(false);
  });
});
