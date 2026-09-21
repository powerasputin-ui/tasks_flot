import { describe, expect, it } from "vitest";
import { canEditTemplate, canShareTemplates, canUseReports, canViewTemplate } from "@/lib/report-templates";

const head = { id: "h1", role: "HEAD" as const };
const other = { id: "h2", role: "HEAD" as const };
const curator = { id: "c1", role: "CURATOR" as const };
const admin = { id: "a1", role: "SYSTEM_ADMIN" as const };
const mgmt = { id: "m1", role: "MANAGEMENT" as const };

describe("права на шаблоны отчётов", () => {
  it("строить отчёты и хранить шаблоны могут руководитель, куратор, администратор; руководство — нет", () => {
    expect(canUseReports("HEAD")).toBe(true);
    expect(canUseReports("CURATOR")).toBe(true);
    expect(canUseReports("SYSTEM_ADMIN")).toBe(true);
    expect(canUseReports("MANAGEMENT")).toBe(false);
  });

  it("общие («для всех») создаёт только куратор или администратор", () => {
    expect(canShareTemplates("CURATOR")).toBe(true);
    expect(canShareTemplates("SYSTEM_ADMIN")).toBe(true);
    expect(canShareTemplates("HEAD")).toBe(false);
  });

  it("личный шаблон видит и правит только владелец", () => {
    const t = { ownerId: "h1", scope: "PERSONAL" as const };
    expect(canViewTemplate(head, t)).toBe(true);
    expect(canEditTemplate(head, t)).toBe(true);
    expect(canViewTemplate(other, t)).toBe(false);
    expect(canEditTemplate(other, t)).toBe(false);
    expect(canViewTemplate(curator, t)).toBe(false); // даже куратор чужой личный не видит
  });

  it("общий шаблон видят все, а править и удалять его могут только куратор и администратор", () => {
    const t = { ownerId: "h1", scope: "SHARED" as const };
    expect(canViewTemplate(other, t)).toBe(true);
    expect(canEditTemplate(other, t)).toBe(false);
    expect(canEditTemplate(head, t)).toBe(false); // владелец-руководитель уже не может править общий
    expect(canEditTemplate(curator, t)).toBe(true);
    expect(canEditTemplate(admin, t)).toBe(true);
    expect(canViewTemplate(mgmt, t)).toBe(false);
  });
});
