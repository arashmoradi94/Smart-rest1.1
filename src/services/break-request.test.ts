import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";

process.env.DATABASE_URL = "file:./tmp-test-br.db";

let reqSvc: typeof import("@/services/break-request-service");
let shiftSvc: typeof import("@/services/shift-service");
let db: typeof import("@/lib/db");
let ids: Record<string, string> = {};

const T0 = new Date("2026-09-04T08:00:00.000Z");
const at = (base: Date, offsetMin: number) => new Date(base.getTime() + offsetMin * 60_000);

beforeAll(async () => {
  for (const ext of ["", "-wal", "-shm"]) {
    if (fs.existsSync(`dev.db${ext}`)) fs.copyFileSync(`dev.db${ext}`, `tmp-test-br.db${ext}`);
  }
  db = await import("@/lib/db");
  // Deterministic baseline
  await db.prisma.shift.updateMany({ where: { status: "ACTIVE" }, data: { status: "ENDED", endedAt: new Date() } });
  await db.prisma.break.updateMany({
    where: { actualStart: { not: null }, actualEnd: null },
    data: { actualEnd: new Date(), status: "COMPLETED" },
  });
  await db.prisma.breakRequest.deleteMany({});
  await db.prisma.groupBreak.updateMany({ data: { status: "CANCELLED" } });
  await db.prisma.user.updateMany({ data: { status: "OFFLINE", onCall: false } });
  reqSvc = await import("@/services/break-request-service");
  shiftSvc = await import("@/services/shift-service");
  const users = await db.prisma.user.findMany();
  ids = Object.fromEntries(users.map((u) => [u.username, u.id]));
  for (const name of ["ali", "sara", "nima", "admin"]) {
    if (!ids[name]) {
      const u = await db.prisma.user.create({
        data: { name, username: name, passwordHash: "x", role: name === "admin" ? "ADMIN" : "EMPLOYEE" },
      });
      ids[name] = u.id;
    }
  }
});

afterAll(async () => {
  await db.prisma.$disconnect();
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      if (fs.existsSync(`tmp-test-br.db${ext}`)) fs.rmSync(`tmp-test-br.db${ext}`);
    } catch {
      // Windows may hold the file briefly
    }
  }
});

describe("Break request between same-shift employees (acceptance item 2)", () => {
  it("creates a valid PENDING record with sender/recipient/timestamp/status", async () => {
    await shiftSvc.startShift(ids.ali, T0);
    await shiftSvc.startShift(ids.sara, T0);
    const res = await reqSvc.sendBreakRequest(ids.ali, ids.sara);
    expect(res.ok).toBe(true);
    const row = await db.prisma.breakRequest.findFirst({
      where: { senderId: ids.ali, recipientId: ids.sara },
    });
    expect(row).toMatchObject({ status: "PENDING", respondedAt: null });
    expect(row!.createdAt).toBeTruthy();
  });

  it("recipient receives the request in their list; sender sees it as outgoing", async () => {
    const [inbox, outbox] = await Promise.all([
      reqSvc.listBreakRequests(ids.sara),
      reqSvc.listBreakRequests(ids.ali),
    ]);
    expect(inbox.incoming.length).toBe(1);
    expect(inbox.incoming[0]).toMatchObject({ fromId: ids.ali });
    expect(outbox.outgoing.length).toBe(1);
    expect(outbox.outgoing[0]).toMatchObject({ toId: ids.sara });
  });

  it("sender cannot accept or reject the request on the recipient's behalf (forged ids rejected)", async () => {
    const row = await db.prisma.breakRequest.findFirst({
      where: { senderId: ids.ali, recipientId: ids.sara, status: "PENDING" },
    });
    await expect(reqSvc.respondBreakRequest(ids.ali, row!.id, true)).rejects.toMatchObject({ status: 404 });
    // a third user must not see or answer it either
    await expect(reqSvc.respondBreakRequest(ids.nima, row!.id, false)).rejects.toMatchObject({ status: 404 });
    // still PENDING after the forged attempts
    expect((await db.prisma.breakRequest.findUnique({ where: { id: row!.id } }))?.status).toBe("PENDING");
  });

  it("duplicate pending request between the same pair is rejected", async () => {
    await expect(reqSvc.sendBreakRequest(ids.ali, ids.sara)).rejects.toMatchObject({ status: 409 });
    // the reverse direction is also a duplicate while pending
    await expect(reqSvc.sendBreakRequest(ids.sara, ids.ali)).rejects.toMatchObject({ status: 409 });
  });

  it("recipient can REJECT: request is no longer active, nothing scheduled", async () => {
    const row = await db.prisma.breakRequest.findFirst({
      where: { senderId: ids.ali, recipientId: ids.sara, status: "PENDING" },
    });
    const res = await reqSvc.respondBreakRequest(ids.sara, row!.id, false);
    expect(res).toMatchObject({ ok: true, accepted: false });
    const after = await db.prisma.breakRequest.findUnique({ where: { id: row!.id } });
    expect(after?.status).toBe("REJECTED");
    expect(after?.respondedAt).toBeTruthy();
    // rejected → a fresh request between the two is allowed again
    await expect(reqSvc.sendBreakRequest(ids.sara, ids.ali)).resolves.toMatchObject({ ok: true });
    const inbox = await reqSvc.listBreakRequests(ids.ali);
    expect(inbox.incoming.length).toBe(1);
    await reqSvc.respondBreakRequest(ids.ali, inbox.incoming[0].id, false);
  });

  it("recipient can ACCEPT: status consistent for both sides, persisted", async () => {
    await reqSvc.sendBreakRequest(ids.ali, ids.sara);
    const inbox = await reqSvc.listBreakRequests(ids.sara);
    expect(inbox.incoming.length).toBe(1);
    const res = await reqSvc.respondBreakRequest(ids.sara, inbox.incoming[0].id, true);
    expect(res).toMatchObject({ ok: true, accepted: true });
    // consistent state for A and B: nothing pending on either side
    const [a, b] = await Promise.all([
      reqSvc.listBreakRequests(ids.ali),
      reqSvc.listBreakRequests(ids.sara),
    ]);
    expect(a.outgoing.length).toBe(0);
    expect(b.incoming.length).toBe(0);
    const row = await db.prisma.breakRequest.findFirst({
      where: { senderId: ids.ali, recipientId: ids.sara, status: "ACCEPTED" },
    });
    expect(row?.respondedAt).toBeTruthy();
  });

  it("persistence: a pending request survives independent re-reads (refresh-safe)", async () => {
    // sara → ali, then re-read twice: identical data, nothing lost
    await reqSvc.sendBreakRequest(ids.sara, ids.ali);
    const first = await reqSvc.listBreakRequests(ids.ali);
    const second = await reqSvc.listBreakRequests(ids.ali);
    expect(second).toEqual(first);
    expect(first.incoming.length).toBe(1);
    // answered → the decision itself is durable
    await reqSvc.respondBreakRequest(ids.ali, first.incoming[0].id, false);
    const after = await reqSvc.listBreakRequests(ids.ali);
    expect(after.incoming.length).toBe(0);
    const row = await db.prisma.breakRequest.findFirst({
      where: { senderId: ids.sara, recipientId: ids.ali },
      orderBy: { createdAt: "desc" },
    });
    expect(row?.status).toBe("REJECTED");
  });

  it("unauthorized recipient (no active shift) → request rejected server-side", async () => {
    // nima is OFFLINE with no shift: the API must refuse even if the client
    // posts their id directly.
    await expect(reqSvc.sendBreakRequest(ids.ali, ids.nima)).rejects.toMatchObject({ status: 409 });
  });

  it("admin (non-employee) can never be a recipient → rejected", async () => {
    await expect(reqSvc.sendBreakRequest(ids.ali, ids.admin)).rejects.toMatchObject({ status: 403 });
  });

  it("sender without an active shift cannot create a request", async () => {
    await expect(reqSvc.sendBreakRequest(ids.nima, ids.ali)).rejects.toMatchObject({ status: 409 });
  });

  it("same-shift coworker list contains only on-shift employees (not self, not admin)", async () => {
    const list = await reqSvc.listSameShiftCoworkers(ids.ali);
    const listIds = list.map((u) => u.id);
    expect(listIds).toContain(ids.sara);
    expect(listIds).not.toContain(ids.ali);
    expect(listIds).not.toContain(ids.admin);
    expect(listIds).not.toContain(ids.nima); // no shift
  });

  it("accept is re-checked against the shift: ended shift → 409, request stays PENDING", async () => {
    await shiftSvc.startShift(ids.nima, at(T0, 10));
    await reqSvc.sendBreakRequest(ids.nima, ids.ali);
    const inbox = await reqSvc.listBreakRequests(ids.ali);
    const reqId = inbox.incoming[0].id;
    // ali ends their shift → the pair no longer shares a shift
    await shiftSvc.endShift(ids.ali, at(T0, 15));
    await expect(reqSvc.respondBreakRequest(ids.ali, reqId, true)).rejects.toMatchObject({ status: 409 });
    expect((await db.prisma.breakRequest.findUnique({ where: { id: reqId } }))?.status).toBe("PENDING");
    // sender withdraws it cleanly
    await reqSvc.cancelBreakRequest(ids.nima, reqId);
    expect((await db.prisma.breakRequest.findUnique({ where: { id: reqId } }))?.status).toBe("CANCELLED");
    await shiftSvc.endShift(ids.nima, at(T0, 200));
  });
});
