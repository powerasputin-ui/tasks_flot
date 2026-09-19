import { describe, expect, it } from "vitest";
import {
  canAssignResponsible,
  canCreateItem,
  canEditItem,
  canExportWorkTable,
  canManageDirectory,
  canViewItems,
  type Actor,
} from "@/lib/permissions";

const head: Actor = { id: "u1", role: "HEAD" };
const curator: Actor = { id: "u2", role: "CURATOR" };
const management: Actor = { id: "u3", role: "MANAGEMENT" };
const admin: Actor = { id: "u4", role: "SYSTEM_ADMIN" };

describe("просмотр и правка позиций", () => {
  it("руководитель видит все позиции, но правит только свои (где он ответственный)", () => {
    expect(canViewItems("HEAD")).toBe(true);
    expect(canEditItem(head, { responsibleId: "u1" })).toBe(true);
    expect(canEditItem(head, { responsibleId: "u9" })).toBe(false);
    expect(canEditItem(head, { responsibleId: null })).toBe(false);
  });

  it("куратор правит любые позиции, включая без ответственного", () => {
    expect(canEditItem(curator, { responsibleId: "u1" })).toBe(true);
    expect(canEditItem(curator, { responsibleId: null })).toBe(true);
  });

  it("руководство не видит рабочие позиции (только финал, этап 4)", () => {
    expect(canViewItems("MANAGEMENT")).toBe(false);
    expect(canEditItem(management, { responsibleId: "u3" })).toBe(false);
  });

  it("админ читает позиции, но не правит и не создаёт", () => {
    expect(canViewItems("SYSTEM_ADMIN")).toBe(true);
    expect(canEditItem(admin, { responsibleId: "u4" })).toBe(false);
    expect(canCreateItem("SYSTEM_ADMIN")).toBe(false);
  });

  it("создают позиции руководитель и куратор", () => {
    expect(canCreateItem("HEAD")).toBe(true);
    expect(canCreateItem("CURATOR")).toBe(true);
    expect(canCreateItem("MANAGEMENT")).toBe(false);
  });
});

describe("назначение ответственного", () => {
  it("куратор назначает кого угодно, руководитель — только себя", () => {
    expect(canAssignResponsible(curator, "u9")).toBe(true);
    expect(canAssignResponsible(curator, null)).toBe(true);
    expect(canAssignResponsible(head, "u1")).toBe(true);
    expect(canAssignResponsible(head, "u9")).toBe(false);
    expect(canAssignResponsible(head, null)).toBe(false);
  });
});

describe("справочники и экспорт", () => {
  it("пользователи и справочники — только SYSTEM_ADMIN", () => {
    expect(canManageDirectory("SYSTEM_ADMIN")).toBe(true);
    expect(canManageDirectory("CURATOR")).toBe(false);
    expect(canManageDirectory("HEAD")).toBe(false);
  });

  it("экспорт рабочей таблицы: руководитель и куратор", () => {
    expect(canExportWorkTable("HEAD")).toBe(true);
    expect(canExportWorkTable("CURATOR")).toBe(true);
    expect(canExportWorkTable("SYSTEM_ADMIN")).toBe(false);
    expect(canExportWorkTable("MANAGEMENT")).toBe(false);
  });
});
