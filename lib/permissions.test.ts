import { describe, expect, it } from "vitest";
import {
  canViewItem,
  canEditItem,
  canCreateItem,
  canManageDirectory,
  canAccessWorkTable,
  canExportWorkTable,
  itemVisibilityWhere,
  type Actor,
} from "@/lib/permissions";

const head = (departmentId: string | null = "d1"): Actor => ({ id: "u1", role: "DEPARTMENT_HEAD", departmentId });
const curator: Actor = { id: "u2", role: "CURATOR", departmentId: "d9" };
const management: Actor = { id: "u3", role: "MANAGEMENT", departmentId: null };
const admin: Actor = { id: "u4", role: "SYSTEM_ADMIN", departmentId: null };

describe("доступ к позициям (TZ_v4, раздел 6)", () => {
  it("руководитель отдела видит и правит только свой отдел", () => {
    expect(canViewItem(head(), { departmentId: "d1" })).toBe(true);
    expect(canViewItem(head(), { departmentId: "d2" })).toBe(false);
    expect(canEditItem(head(), { departmentId: "d1" })).toBe(true);
    expect(canEditItem(head(), { departmentId: "d2" })).toBe(false);
  });

  it("руководитель без подразделения не видит и не правит ничего", () => {
    expect(canViewItem(head(null), { departmentId: "d1" })).toBe(false);
    expect(canEditItem(head(null), { departmentId: "d1" })).toBe(false);
    expect(itemVisibilityWhere(head(null))).toBeNull();
  });

  it("куратор видит и правит любые отделы, включая создание", () => {
    expect(canViewItem(curator, { departmentId: "d1" })).toBe(true);
    expect(canEditItem(curator, { departmentId: "d2" })).toBe(true);
    expect(canCreateItem(curator, "d3")).toBe(true);
    expect(itemVisibilityWhere(curator)).toEqual({});
  });

  it("руководство не видит рабочие позиции (только финал, этап 4)", () => {
    expect(canViewItem(management, { departmentId: "d1" })).toBe(false);
    expect(canEditItem(management, { departmentId: "d1" })).toBe(false);
    expect(itemVisibilityWhere(management)).toBeNull();
  });

  it("админ читает все позиции, но не правит", () => {
    expect(canViewItem(admin, { departmentId: "d1" })).toBe(true);
    expect(canEditItem(admin, { departmentId: "d1" })).toBe(false);
    expect(canCreateItem(admin, "d1")).toBe(false);
  });

  it("руководитель создаёт позиции только в своём отделе", () => {
    expect(canCreateItem(head(), "d1")).toBe(true);
    expect(canCreateItem(head(), "d2")).toBe(false);
  });
});

describe("справочники и таблица", () => {
  it("пользователи/подразделения/справочники — только SYSTEM_ADMIN", () => {
    expect(canManageDirectory("SYSTEM_ADMIN")).toBe(true);
    expect(canManageDirectory("CURATOR")).toBe(false);
    expect(canManageDirectory("DEPARTMENT_HEAD")).toBe(false);
    expect(canManageDirectory("MANAGEMENT")).toBe(false);
  });

  it("рабочая таблица недоступна руководству; экспорт — руководителю отдела и куратору", () => {
    expect(canAccessWorkTable("MANAGEMENT")).toBe(false);
    expect(canAccessWorkTable("DEPARTMENT_HEAD")).toBe(true);
    expect(canExportWorkTable("CURATOR")).toBe(true);
    expect(canExportWorkTable("SYSTEM_ADMIN")).toBe(false);
  });

  it("видимость: руководитель ограничен своим отделом в запросе к БД", () => {
    expect(itemVisibilityWhere(head("d5"))).toEqual({ departmentId: "d5" });
    expect(itemVisibilityWhere(admin)).toEqual({});
  });
});
