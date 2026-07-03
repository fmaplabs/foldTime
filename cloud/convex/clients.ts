import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUserId } from "./lib/auth";

// What the UI needs — deliberately omits stripeCustomerId / archived.
const clientView = v.object({
	_id: v.id("clients"),
	name: v.string(),
	email: v.string(),
	rateCents: v.optional(v.number()),
});

function assertRate(rateCents: number | null | undefined) {
	if (
		typeof rateCents === "number" &&
		(!Number.isInteger(rateCents) || rateCents < 0)
	) {
		throw new Error("rateCents must be a non-negative integer");
	}
}

export const list = query({
	args: {},
	returns: v.array(clientView),
	handler: async (ctx) => {
		const userId = await requireUserId(ctx);
		const clients = await ctx.db
			.query("clients")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.take(500);
		return clients
			.filter((c) => !c.archived)
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((c) => ({
				_id: c._id,
				name: c.name,
				email: c.email,
				rateCents: c.rateCents,
			}));
	},
});

export const create = mutation({
	args: {
		name: v.string(),
		email: v.string(),
		rateCents: v.optional(v.number()),
	},
	returns: v.id("clients"),
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		if (args.name.trim() === "") throw new Error("name is required");
		assertRate(args.rateCents);
		return await ctx.db.insert("clients", {
			userId,
			name: args.name.trim(),
			email: args.email.trim(),
			rateCents: args.rateCents,
		});
	},
});

export const update = mutation({
	args: {
		id: v.id("clients"),
		name: v.optional(v.string()),
		email: v.optional(v.string()),
		// null clears the override so the client falls back to the global default.
		rateCents: v.optional(v.union(v.number(), v.null())),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const client = await ctx.db.get(args.id);
		if (client === null || client.userId !== userId) {
			throw new Error("Client not found");
		}
		assertRate(args.rateCents);

		const patch: Partial<{
			name: string;
			email: string;
			rateCents: number | undefined;
		}> = {};
		if (args.name !== undefined) patch.name = args.name.trim();
		if (args.email !== undefined) patch.email = args.email.trim();
		if (args.rateCents !== undefined) {
			patch.rateCents = args.rateCents === null ? undefined : args.rateCents;
		}
		await ctx.db.patch(args.id, patch);
		return null;
	},
});

export const archive = mutation({
	args: { id: v.id("clients") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const client = await ctx.db.get(args.id);
		if (client === null || client.userId !== userId) {
			throw new Error("Client not found");
		}
		await ctx.db.patch(args.id, { archived: true });
		return null;
	},
});

export type ClientInfo = {
	name: string;
	email: string;
	rateCents?: number;
	stripeCustomerId?: string;
};

// This user's clients as an id→info map, for joins (projects/invoices/revenue)
// without an N+1 of `ctx.db.get`. Bounded to the same cap as `list`.
export async function loadClientMap(
	ctx: QueryCtx,
	userId: string,
): Promise<Map<Id<"clients">, ClientInfo>> {
	const clients = await ctx.db
		.query("clients")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.take(500);
	const map = new Map<Id<"clients">, ClientInfo>();
	for (const c of clients) {
		map.set(c._id, {
			name: c.name,
			email: c.email,
			rateCents: c.rateCents,
			stripeCustomerId: c.stripeCustomerId,
		});
	}
	return map;
}
