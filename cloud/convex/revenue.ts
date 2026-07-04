import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { loadEffectiveSettings } from "./settings";
import { loadClientMap } from "./clients";
import { resolveRateCents } from "./lib/rates";

const MS_PER_HOUR = 3_600_000;
const DAY_MS = 86_400_000;

// UTC month/year boundaries derived from a timestamp. `monthsAgo` may be
// negative to get a future month start (used for the upper bound of a bucket).
function monthStart(ms: number, monthsAgo = 0): number {
	const d = new Date(ms);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsAgo, 1);
}
function yearStart(ms: number): number {
	return Date.UTC(new Date(ms).getUTCFullYear(), 0, 1);
}
const monthLabel = new Intl.DateTimeFormat("en-US", {
	month: "short",
	timeZone: "UTC",
});

export const summary = query({
	args: {},
	returns: v.object({
		currency: v.string(),
		thisMonthCents: v.number(),
		yearToDateCents: v.number(),
		unbilledPipelineCents: v.number(),
		projectedAnnualCents: v.number(),
	}),
	handler: async (ctx) => {
		const userId = await requireUserId(ctx);
		const settings = await loadEffectiveSettings(ctx, userId);
		const now = Date.now();
		const monthStartMs = monthStart(now);
		const yearStartMs = yearStart(now);
		const trailingStart = now - 90 * DAY_MS;

		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.take(1000);

		let thisMonth = 0;
		let ytd = 0;
		let trailing90 = 0;
		for (const inv of invoices) {
			if (inv.status !== "paid" || inv.paidAt === undefined) continue;
			if (inv.paidAt >= monthStartMs) thisMonth += inv.amountCents;
			if (inv.paidAt >= yearStartMs) ytd += inv.amountCents;
			if (inv.paidAt >= trailingStart) trailing90 += inv.amountCents;
		}
		// Annualize the trailing 90 days into a forward run-rate.
		const projectedAnnual = Math.round(trailing90 * (365 / 90));

		// Pipeline: value of tracked-but-uninvoiced time, from each project's
		// cached unbilled estimate × its resolved rate.
		const clientMap = await loadClientMap(ctx, userId);
		const projects = await ctx.db
			.query("projects")
			.withIndex("by_user_name", (q) => q.eq("userId", userId))
			.take(500);
		let pipeline = 0;
		for (const p of projects) {
			if (p.archived) continue;
			const ms = p.unbilledMsCache ?? 0;
			if (ms <= 0) continue;
			const client = p.clientId ? clientMap.get(p.clientId) : undefined;
			const rate = resolveRateCents(p, client, settings);
			pipeline += Math.round((ms / MS_PER_HOUR) * rate);
		}

		return {
			currency: settings.currency,
			thisMonthCents: thisMonth,
			yearToDateCents: ytd,
			unbilledPipelineCents: pipeline,
			projectedAnnualCents: projectedAnnual,
		};
	},
});

export const monthlySeries = query({
	args: {},
	returns: v.object({
		currency: v.string(),
		months: v.array(v.object({ label: v.string(), cents: v.number() })),
	}),
	handler: async (ctx) => {
		const userId = await requireUserId(ctx);
		const settings = await loadEffectiveSettings(ctx, userId);
		const now = Date.now();

		// 12 buckets, oldest first, ending with the current month.
		const buckets = [];
		for (let i = 11; i >= 0; i--) {
			const start = monthStart(now, i);
			const end = monthStart(now, i - 1); // next month's start
			buckets.push({ start, end, label: monthLabel.format(new Date(start)), cents: 0 });
		}

		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.take(1000);
		for (const inv of invoices) {
			if (inv.status !== "paid" || inv.paidAt === undefined) continue;
			for (const b of buckets) {
				if (inv.paidAt >= b.start && inv.paidAt < b.end) {
					b.cents += inv.amountCents;
					break;
				}
			}
		}

		return {
			currency: settings.currency,
			months: buckets.map((b) => ({ label: b.label, cents: b.cents })),
		};
	},
});
