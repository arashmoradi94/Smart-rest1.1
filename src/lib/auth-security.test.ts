import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, findUniqueMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    auth: authMock,
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
    },
  },
}));

import { requireAdmin, requireAuth, requireSupervisor } from "@/lib/auth";

describe("auth security hardening", () => {
  beforeEach(() => {
    authMock.mockReset();
    findUniqueMock.mockReset();
  });

  it("rejects deleted or stale authenticated users", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "deleted-user",
        name: "Deleted User",
        username: "deleted",
        role: "ADMIN",
      },
    });
    findUniqueMock.mockResolvedValue(null);

    await expect(requireAuth()).rejects.toThrow("Unauthorized");
  });

  it("rejects stale session roles that do not match the database", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
        name: "Employee Name",
        username: "employee",
        role: "ADMIN",
      },
    });
    findUniqueMock.mockResolvedValue({
      id: "user-1",
      name: "Employee Name",
      username: "employee",
      role: "EMPLOYEE",
    });

    await expect(requireSupervisor()).rejects.toThrow("Forbidden");
    await expect(requireAdmin()).rejects.toThrow("Forbidden");
  });

  it("accepts the current database role for valid users", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-2",
        name: "Supervisor Name",
        username: "supervisor",
        role: "SUPERVISOR",
      },
    });
    findUniqueMock.mockResolvedValue({
      id: "user-2",
      name: "Supervisor Name",
      username: "supervisor",
      role: "SUPERVISOR",
    });

    await expect(requireSupervisor()).resolves.toMatchObject({ id: "user-2", role: "SUPERVISOR" });
  });
});
