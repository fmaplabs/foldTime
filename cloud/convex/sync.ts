import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUserId } from "./lib/auth";

// A heartbeat as it travels over the wire — mirrors the CLI's SyncRow.
const syncRow = v.object({
  uuid: v.string(),
  ts: v.number(),
  project: v.string(),
  task: v.string(),
  file: v.optional(v.string()),
  isWrite: v.boolean(),
  commitHash: v.optional(v.string()),
});

const pulledRow = v.object({
  uuid: v.string(),
  ts: v.number(),
  project: v.string(),
  task: v.string(),
  file: v.optional(v.string()),
  isWrite: v.boolean(),
  commitHash: v.optional(v.string()),
  deviceId: v.string(),
});

// Upsert a batch of this device's rows. Idempotent: the CLI may retry a
// batch whose response it never saw. One `syncedAt` for the whole call keeps
// each push a single cursor "tick" for pullers.
export const push = mutation({
  args: {
    deviceId: v.string(),
    deviceName: v.string(),
    rows: v.array(syncRow),
  },
  returns: v.object({ upserted: v.number(), syncedAt: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const syncedAt = Date.now();

    for (const row of args.rows) {
      const existing = await ctx.db
        .query("heartbeats")
        .withIndex("by_user_uuid", (q) =>
          q.eq("userId", userId).eq("uuid", row.uuid),
        )
        .unique();
      if (existing === null) {
        await ctx.db.insert("heartbeats", {
          userId,
          deviceId: args.deviceId,
          ...row,
          syncedAt,
        });
      } else {
        await ctx.db.patch(existing._id, {
          ...row,
          deviceId: args.deviceId,
          syncedAt,
        });
      }
    }

    // Auto-register a `projects` row for each distinct project name we see, so
    // the web app can discover and bill projects without scanning heartbeats.
    // Deduped per batch to keep this cheap on the hot sync path.
    const seenProjects = new Set<string>();
    for (const row of args.rows) {
      if (seenProjects.has(row.project)) continue;
      seenProjects.add(row.project);
      const project = await ctx.db
        .query("projects")
        .withIndex("by_user_name", (q) =>
          q.eq("userId", userId).eq("name", row.project),
        )
        .unique();
      if (project === null) {
        await ctx.db.insert("projects", { userId, name: row.project });
      }
    }

    const device = await ctx.db
      .query("devices")
      .withIndex("by_user_device", (q) =>
        q.eq("userId", userId).eq("deviceId", args.deviceId),
      )
      .unique();
    if (device === null) {
      await ctx.db.insert("devices", {
        userId,
        deviceId: args.deviceId,
        name: args.deviceName,
        lastSeenAt: syncedAt,
      });
    } else {
      await ctx.db.patch(device._id, {
        name: args.deviceName,
        lastSeenAt: syncedAt,
      });
    }

    return { upserted: args.rows.length, syncedAt };
  },
});

// One page of rows with syncedAt > cursor, oldest first.
//
// The cursor contract is strictly-greater, so a page boundary must never
// split a group of rows sharing one syncedAt: if the raw page is full, it is
// extended through the whole equal-syncedAt group at its end (bounded by the
// size of one push batch). `excludeDeviceId` rows are dropped only AFTER
// nextCursor is computed, so a device pulling right after its own push still
// advances past its own rows.
export const pull = query({
  args: {
    cursor: v.number(),
    limit: v.number(),
    excludeDeviceId: v.string(),
  },
  returns: v.object({
    rows: v.array(pulledRow),
    nextCursor: v.number(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 500);

    const page = await ctx.db
      .query("heartbeats")
      .withIndex("by_user_synced", (q) =>
        q.eq("userId", userId).gt("syncedAt", args.cursor),
      )
      .order("asc")
      .take(limit + 1);

    let kept;
    let nextCursor;
    let isDone;
    if (page.length <= limit) {
      kept = page;
      nextCursor = page.length > 0 ? page[page.length - 1].syncedAt : args.cursor;
      isDone = true;
    } else {
      const boundary = page[limit - 1].syncedAt;
      const tieGroup = await ctx.db
        .query("heartbeats")
        .withIndex("by_user_synced", (q) =>
          q.eq("userId", userId).eq("syncedAt", boundary),
        )
        .collect();
      kept = page.filter((row) => row.syncedAt < boundary).concat(tieGroup);
      nextCursor = boundary;
      isDone = false;
    }

    const rows = kept
      .filter((row) => row.deviceId !== args.excludeDeviceId)
      .map((row) => ({
        uuid: row.uuid,
        ts: row.ts,
        project: row.project,
        task: row.task,
        file: row.file,
        isWrite: row.isWrite,
        commitHash: row.commitHash,
        deviceId: row.deviceId,
      }));

    return { rows, nextCursor, isDone };
  },
});
