import { describe, expect, it } from "vitest";
import {
  canAssignResponsible,
  canCreateItem,
  canDeleteItem,
  canEditItem,
  canExportWorkTable,
  canManageDirectory,
  canManageTracks,
  canManageUser,
  canManageUsers,
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

describe("canDeleteItem", () => {
  const head: Actor = { id: "u1", role: "HEAD" };
  const curator: Actor = { id: "c1", role: "CURATOR" };

  it("руководитель удаляет только свои позиции", () => {
    expect(canDeleteItem(head, { responsibleId: "u1", createdById: "u1" })).toBe(true);
    expect(canDeleteItem(head, { responsibleId: "u2", createdById: "u1" })).toBe(false);
  });

  it("куратор не удаляет чужие позиции, но удаляет свои", () => {
    expect(canDeleteItem(curator, { responsibleId: "u1", createdById: "u1" })).toBe(false);
    expect(canDeleteItem(curator, { responsibleId: "c1", createdById: "c1" })).toBe(true);
    expect(canDeleteItem(curator, { responsibleId: null, createdById: "c1" })).toBe(true);
    expect(canDeleteItem(curator, { responsibleId: null, createdById: "u1" })).toBe(false);
  });

  it("остальным ролям удалять нельзя", () => {
    expect(canDeleteItem({ id: "a", role: "SYSTEM_ADMIN" }, { responsibleId: "a", createdById: "a" })).toBe(false);
    expect(canDeleteItem({ id: "m", role: "MANAGEMENT" }, { responsibleId: "m", createdById: "m" })).toBe(false);
  });
});

describe("управление пользователями", () => {
  const curator: Actor = { id: "c1", role: "CURATOR" };
  const admin: Actor = { id: "a1", role: "SYSTEM_ADMIN" };

  it("раздел пользователей открыт куратору и администратору", () => {
    expect(canManageUsers("CURATOR")).toBe(true);
    expect(canManageUsers("SYSTEM_ADMIN")).toBe(true);
    expect(canManageUsers("HEAD")).toBe(false);
    expect(canManageUsers("MANAGEMENT")).toBe(false);
  });

  it("куратор ведёт только ответственных (HEAD), админ — всех", () => {
    expect(canManageUser(curator, "HEAD")).toBe(true);
    expect(canManageUser(curator, "CURATOR")).toBe(false);
    expect(canManageUser(curator, "SYSTEM_ADMIN")).toBe(false);
    expect(canManageUser(admin, "CURATOR")).toBe(true);
    expect(canManageUser({ id: "u", role: "HEAD" }, "HEAD")).toBe(false);
  });
});

describe("треки", () => {
  it("треки ведут куратор и администратор", () => {
    expect(canManageTracks("CURATOR")).toBe(true);
    expect(canManageTracks("SYSTEM_ADMIN")).toBe(true);
    expect(canManageTracks("HEAD")).toBe(false);
    expect(canManageTracks("MANAGEMENT")).toBe(false);
  });
});
