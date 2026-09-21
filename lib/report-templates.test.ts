import { describe, expect, it } from "vitest";
import { canEditTemplate, canShareTemplates, canUseReports, canViewTemplate } from "@/lib/report-templates";

const A = "dirA";
const head = { id: "h1", role: "HEAD" as const, directorateId: A };
const director = { id: "d1", role: "DIRECTOR" as const, directorateId: A };
const otherDirector = { id: "d3", role: "DIRECTOR" as const, directorateId: A };
const foreignDirector = { id: "d2", role: "DIRECTOR" as const, directorateId: "dirB" };
const admin = { id: "a1", role: "ADMIN" as const, directorateId: A };
const tech = { id: "t1", role: "SYSTEM_ADMIN" as const, directorateId: A };
const executive = { id: "m1", role: "EXECUTIVE" as const, directorateId: null };

describe("права на шаблоны отчётов", () => {
  it("строить отчёты и хранить шаблоны могут директор и админ; руководитель (заполняет таблицу) и ЗГД — нет", () => {
    for (const r of ["DIRECTOR", "ADMIN", "SYSTEM_ADMIN"] as const) expect(canUseReports(r)).toBe(true);
    expect(canUseReports("HEAD")).toBe(false);
    expect(canUseReports("EXECUTIVE")).toBe(false);
  });

  it("общие («для всех») создают директор и админ", () => {
    for (const r of ["DIRECTOR", "ADMIN", "SYSTEM_ADMIN"] as const) expect(canShareTemplates(r)).toBe(true);
    expect(canShareTemplates("HEAD")).toBe(false);
  });

  it("личный шаблон видит и правит только владелец", () => {
    const t = { ownerId: "d1", scope: "PERSONAL" as const, directorateId: A };
    expect(canViewTemplate(director, t)).toBe(true);
    expect(canEditTemplate(director, t)).toBe(true);
    expect(canViewTemplate(otherDirector, t)).toBe(false);
    expect(canEditTemplate(otherDirector, t)).toBe(false);
    expect(canViewTemplate(admin, t)).toBe(false); // даже админ чужой личный не видит
  });

  it("общий шаблон видят директор и админ своей дирекции и правят; руководителю и чужой дирекции он не виден", () => {
    const t = { ownerId: "d1", scope: "SHARED" as const, directorateId: A };
    expect(canViewTemplate(otherDirector, t)).toBe(true);
    expect(canEditTemplate(otherDirector, t)).toBe(true);
    expect(canEditTemplate(admin, t)).toBe(true);
    expect(canEditTemplate(tech, t)).toBe(true);
    // руководитель и ЗГД отчётов не строят
    expect(canViewTemplate(head, t)).toBe(false);
    expect(canViewTemplate(executive, t)).toBe(false);
    // другая дирекция
    expect(canViewTemplate(foreignDirector, t)).toBe(false);
    expect(canEditTemplate(foreignDirector, t)).toBe(false);
  });
});
