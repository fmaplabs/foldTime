import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const DEVICE_A = "device-a";
const DEVICE_B = "device-b";

function row(uuid: string, overrides: Record<string, unknown> = {}) {
  return {
    uuid,
    ts: 1_000,
    project: "foo",
    task: "main",
    isWrite: false,
    ...overrides,
  };
}

function pushArgs(deviceId: string, rows: ReturnType<typeof row>[]) {
  return { deviceId, deviceName: `${deviceId}-name`, rows };
}

// Fake only Date so each push's server-side syncedAt is deterministic —
// distinct set times produce distinct cursor groups, equal times produce ties.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("push", () => {
  test("is idempotent: retrying a batch changes syncedAt but not the row count", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({ subject: "user-1" });

    vi.setSystemTime(10_000);
    const first = await asUser.mutation(api.sync.push, pushArgs(DEVICE_A, [row("u1"), row("u2")]));
    expect(first).toEqual({ upserted: 2, syncedAt: 10_000 });

    vi.setSystemTime(20_000);
    const second = await asUser.mutation(
      api.sync.push,
      pushArgs(DEVICE_A, [row("u1"), row("u2", { commitHash: "abc123" })]),
    );
    expect(second.syncedAt).toBe(20_000);

    const docs = await t.run(async (ctx) => ctx.db.query("heartbeats").collect());
    expect(docs).toHaveLength(2);
    for (const doc of docs) {
      expect(doc.syncedAt).toBe(20_000);
    }
    expect(docs.find((d) => d.uuid === "u2")?.commitHash).toBe("abc123");
  });

  test("registers the device and bumps lastSeenAt", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({ subject: "user-1" });

    vi.setSystemTime(10_000);
    await asUser.mutation(api.sync.push, pushArgs(DEVICE_A, [row("u1")]));
    vi.setSystemTime(20_000);
    await asUser.mutation(api.sync.push, pushArgs(DEVICE_A, []));

    const devices = await t.run(async (ctx) => ctx.db.query("devices").collect());
    expect(devices).toHaveLength(1);
    expect(devices[0].deviceId).toBe(DEVICE_A);
    expect(devices[0].lastSeenAt).toBe(20_000);
  });

  test("rejects unauthenticated calls", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(api.sync.push, pushArgs(DEVICE_A, [row("u1")])),
    ).rejects.toThrow("Not authenticated");
  });
});

describe("pull", () => {
  test("pages through multiple syncedAt groups via nextCursor", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({ subject: "user-1" });

    vi.setSystemTime(10_000);
    await asUser.mutation(api.sync.push, pushArgs(DEVICE_A, [row("u1"), row("u2")]));
    vi.setSystemTime(20_000);
    await asUser.mutation(api.sync.push, pushArgs(DEVICE_A, [row("u3")]));

    const page1 = await asUser.query(api.sync.pull, {
      cursor: 0,
      limit: 2,
      excludeDeviceId: DEVICE_B,
    });
    expect(page1.rows.map((r) => r.uuid).sort()).toEqual(["u1", "u2"]);
    expect(page1.nextCursor).toBe(10_000);
    expect(page1.isDone).toBe(false);

    const page2 = await asUser.query(api.sync.pull, {
      cursor: page1.nextCursor,
      limit: 2,
      excludeDeviceId: DEVICE_B,
    });
    expect(page2.rows.map((r) => r.uuid)).toEqual(["u3"]);
    expect(page2.nextCursor).toBe(20_000);
    expect(page2.isDone).toBe(true);
  });

  test("extends a full page through an equal-syncedAt tie instead of splitting it", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({ subject: "user-1" });

    // One push = one syncedAt shared by 5 rows; page limit is 2.
    vi.setSystemTime(10_000);
    await asUser.mutation(
      api.sync.push,
      pushArgs(DEVICE_A, ["u1", "u2", "u3", "u4", "u5"].map((u) => row(u))),
    );

    const page = await asUser.query(api.sync.pull, {
      cursor: 0,
      limit: 2,
      excludeDeviceId: DEVICE_B,
    });
    // Splitting the group would strand u3..u5 behind a strictly-greater
    // cursor forever — the whole tie must come back in one page.
    expect(page.rows.map((r) => r.uuid).sort()).toEqual(["u1", "u2", "u3", "u4", "u5"]);
    expect(page.nextCursor).toBe(10_000);

    const rest = await asUser.query(api.sync.pull, {
      cursor: page.nextCursor,
      limit: 2,
      excludeDeviceId: DEVICE_B,
    });
    expect(rest.rows).toEqual([]);
    expect(rest.isDone).toBe(true);
  });

  test("excludeDeviceId drops rows but still advances the cursor past them", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({ subject: "user-1" });

    vi.setSystemTime(10_000);
    await asUser.mutation(api.sync.push, pushArgs(DEVICE_A, [row("u1"), row("u2")]));

    // Device A pulls right after its own push: nothing to apply, but the
    // cursor must move past its own rows or it would re-scan them forever.
    const page = await asUser.query(api.sync.pull, {
      cursor: 0,
      limit: 500,
      excludeDeviceId: DEVICE_A,
    });
    expect(page.rows).toEqual([]);
    expect(page.nextCursor).toBe(10_000);
    expect(page.isDone).toBe(true);
  });

  test("returns wire-shaped rows including the owning deviceId", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({ subject: "user-1" });

    vi.setSystemTime(10_000);
    await asUser.mutation(
      api.sync.push,
      pushArgs(DEVICE_A, [row("u1", { file: "src/lib.rs", isWrite: true, commitHash: "abc" })]),
    );

    const page = await asUser.query(api.sync.pull, {
      cursor: 0,
      limit: 10,
      excludeDeviceId: DEVICE_B,
    });
    expect(page.rows).toEqual([
      {
        uuid: "u1",
        ts: 1_000,
        project: "foo",
        task: "main",
        file: "src/lib.rs",
        isWrite: true,
        commitHash: "abc",
        deviceId: DEVICE_A,
      },
    ]);
  });

  test("users never see each other's rows", async () => {
    const t = convexTest(schema);
    const asAlice = t.withIdentity({ subject: "alice" });
    const asBob = t.withIdentity({ subject: "bob" });

    vi.setSystemTime(10_000);
    await asAlice.mutation(api.sync.push, pushArgs(DEVICE_A, [row("u1")]));

    const bobsView = await asBob.query(api.sync.pull, {
      cursor: 0,
      limit: 500,
      excludeDeviceId: DEVICE_B,
    });
    expect(bobsView.rows).toEqual([]);
    expect(bobsView.nextCursor).toBe(0);
    expect(bobsView.isDone).toBe(true);
  });

  test("rejects unauthenticated calls", async () => {
    const t = convexTest(schema);
    await expect(
      t.query(api.sync.pull, { cursor: 0, limit: 10, excludeDeviceId: DEVICE_A }),
    ).rejects.toThrow("Not authenticated");
  });
});
