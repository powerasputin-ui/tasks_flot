import { describe, expect, it } from "vitest";
import { canEditTemplate, canShareTemplates, canUseReports, canViewTemplate } from "@/lib/report-templates";

const A = "dirA";
const head = { id: "h1", role: "HEAD" as const, directorateId: A };
const other = { id: "h2", role: "HEAD" as const, directorateId: A };
const foreign = { id: "h3", role: "HEAD" as const, directorateId: "dirB" };
const director = { id: "d1", role: "DIRECTOR" as const, directorateId: A };
const foreignDirector = { id: "d2", role: "DIRECTOR" as const, directorateId: "dirB" };
const admin = { id: "a1", role: "ADMIN" as const, directorateId: A };
const tech = { id: "t1", role: "SYSTEM_ADMIN" as const, directorateId: A };
const executive = { id: "m1", role: "EXECUTIVE" as const, directorateId: null };

describe("права на шаблоны отчётов", () => {
  it("строить отчёты и хранить шаблоны могут руководитель, директор, админ; ЗГД — нет", () => {
    for (const r of ["HEAD", "DIRECTOR", "ADMIN", "SYSTEM_ADMIN"] as const) expect(canUseReports(r)).toBe(true);
    expect(canUseReports("EXECUTIVE")).toBe(false);
  });

  it("общие («для всех») создают директор и админ", () => {
    for (const r of ["DIRECTOR", "ADMIN", "SYSTEM_ADMIN"] as const) expect(canShareTemplates(r)).toBe(true);
    expect(canShareTemplates("HEAD")).toBe(false);
  });

  it("личный шаблон видит и правит только владелец", () => {
    const t = { ownerId: "h1", scope: "PERSONAL" as const, directorateId: A };
    expect(canViewTemplate(head, t)).toBe(true);
    expect(canEditTemplate(head, t)).toBe(true);
    expect(canViewTemplate(other, t)).toBe(false);
    expect(canEditTemplate(other, t)).toBe(false);
    expect(canViewTemplate(director, t)).toBe(false); // даже директор чужой личный не видит
  });

  it("общий шаблон видят все своей дирекции, правят директор и админ; чужой дирекции он не виден", () => {
    const t = { ownerId: "h1", scope: "SHARED" as const, directorateId: A };
    expect(canViewTemplate(other, t)).toBe(true);
    expect(canEditTemplate(other, t)).toBe(false);
    expect(canEditTemplate(head, t)).toBe(false); // владелец-руководитель уже не может править общий
    expect(canEditTemplate(director, t)).toBe(true);
    expect(canEditTemplate(admin, t)).toBe(true);
    expect(canEditTemplate(tech, t)).toBe(true);
    expect(canViewTemplate(executive, t)).toBe(false);
    // другая дирекция
    expect(canViewTemplate(foreign, t)).toBe(false);
    expect(canViewTemplate(foreignDirector, t)).toBe(false);
    expect(canEditTemplate(foreignDirector, t)).toBe(false);
  });
});
