import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  directMessage: {
    create: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }));

import {
  getMyDirectMessages,
  markDirectMessageRead,
  sendDirectMessage,
} from "@/services/message-service";

describe("direct messaging", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects empty and oversized messages", async () => {
    await expect(sendDirectMessage("supervisor", "employee", "  ")).rejects.toMatchObject({ status: 400 });
    await expect(sendDirectMessage("supervisor", "employee", "x".repeat(501))).rejects.toMatchObject({ status: 400 });
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("allows supervisors to send only to employees", async () => {
    db.user.findUnique
      .mockResolvedValueOnce({ role: "SUPERVISOR" })
      .mockResolvedValueOnce({ id: "employee", role: "EMPLOYEE" });
    db.directMessage.create.mockResolvedValue({ id: "message-1", message: "Please call me" });

    await expect(sendDirectMessage("supervisor", "employee", " Please call me ")).resolves.toMatchObject({
      id: "message-1",
    });
    expect(db.directMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { senderId: "supervisor", recipientId: "employee", message: "Please call me" },
    }));
  });

  it("rejects non-supervisors and protects read ownership", async () => {
    db.user.findUnique.mockResolvedValueOnce({ role: "EMPLOYEE" });
    await expect(sendDirectMessage("employee", "other", "hello")).rejects.toMatchObject({ status: 403 });

    db.directMessage.findMany.mockResolvedValue([]);
    await getMyDirectMessages("employee");
    expect(db.directMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { recipientId: "employee" } }));

    db.directMessage.updateMany.mockResolvedValue({ count: 1 });
    await markDirectMessageRead("employee", "message-1");
    expect(db.directMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "message-1", recipientId: "employee", isRead: false },
    }));
  });
});
