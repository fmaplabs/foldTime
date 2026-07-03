import { beforeEach, describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

declare global {
	interface ImportMeta {
		glob: (pattern: string) => Record<string, () => Promise<unknown>>;
	}
}

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

const USER = "user-1";
const HUGE_IDLE = 1_000_000_000; // keep test heartbeats in a single session

// Seed settings + a client + a project assigned to it. Returns their ids.
async function seedProject(
	t: ReturnType<typeof convexTest>,
	opts: { assignClient?: boolean } = {},
) {
	const assignClient = opts.assignClient ?? true;
	return await t.run(async (ctx) => {
		await ctx.db.insert("settings", {
			userId: USER,
			defaultRateCents: 10_000, // $100/hr
			currency: "usd",
			idleThresholdMs: HUGE_IDLE,
		});
		const clientId = await ctx.db.insert("clients", {
			userId: USER,
			name: "Acme",
			email: "ap@acme.test",
		});
		const projectId = await ctx.db.insert("projects", {
			userId: USER,
			name: "foo",
			clientId: assignClient ? clientId : undefined,
		});
		return { clientId, projectId };
	});
}

async function addHeartbeat(
	t: ReturnType<typeof convexTest>,
	args: { ts: number; syncedAt: number; deviceId?: string; uuid: string },
) {
	await t.run(async (ctx) => {
		await ctx.db.insert("heartbeats", {
			userId: USER,
			deviceId: args.deviceId ?? "device-a",
			uuid: args.uuid,
			ts: args.ts,
			project: "foo",
			task: "code",
			isWrite: false,
			syncedAt: args.syncedAt,
		});
	});
}

let t: ReturnType<typeof convexTest>;
beforeEach(() => {
	t = convexTest(schema, modules);
});

describe("previewUnbilled", () => {
	test("sums one hour across a session at the resolved rate", async () => {
		const { projectId } = await seedProject(t);
		await addHeartbeat(t, { ts: 0, syncedAt: 1000, uuid: "a" });
		await addHeartbeat(t, { ts: 3_600_000, syncedAt: 1000, uuid: "b" });

		const preview = await t
			.withIdentity({ subject: USER })
			.query(api.invoices.previewUnbilled, { projectId });
		expect(preview.hours).toBeCloseTo(1, 5);
		expect(preview.amountCents).toBe(10_000);
		expect(preview.hasClient).toBe(true);
		expect(preview.heartbeatCount).toBe(2);
	});
});

describe("claimUnbilled", () => {
	test("creates a draft invoice, advances the watermark, and won't re-bill", async () => {
		const { projectId } = await seedProject(t);
		await addHeartbeat(t, { ts: 0, syncedAt: 1000, uuid: "a" });
		await addHeartbeat(t, { ts: 3_600_000, syncedAt: 1000, uuid: "b" });

		const claim = await t
			.withIdentity({ subject: USER })
			.mutation(internal.invoices.claimUnbilled, { projectId });
		expect(claim.empty).toBe(false);
		if (claim.empty) return;
		expect(claim.fromCursor).toBe(0);
		expect(claim.toCursor).toBe(1000);
		expect(claim.rateCents).toBe(10_000);

		// Watermark advanced; a draft invoice exists.
		const { project, invoices } = await t.run(async (ctx) => ({
			project: await ctx.db.get(projectId),
			invoices: await ctx.db.query("invoices").collect(),
		}));
		expect(project?.lastBilledSyncedAt).toBe(1000);
		expect(invoices).toHaveLength(1);
		expect(invoices[0].status).toBe("draft");

		// Nothing new synced → a second claim is empty (no double-bill).
		const again = await t
			.withIdentity({ subject: USER })
			.mutation(internal.invoices.claimUnbilled, { projectId });
		expect(again.empty).toBe(true);

		// A newer heartbeat opens a fresh window above the watermark.
		await addHeartbeat(t, { ts: 7_200_000, syncedAt: 2000, uuid: "c" });
		const third = await t
			.withIdentity({ subject: USER })
			.mutation(internal.invoices.claimUnbilled, { projectId });
		expect(third.empty).toBe(false);
		if (third.empty) return;
		expect(third.fromCursor).toBe(1000);
		expect(third.toCursor).toBe(2000);
	});

	test("refuses to claim a project with no client", async () => {
		const { projectId } = await seedProject(t, { assignClient: false });
		await addHeartbeat(t, { ts: 0, syncedAt: 1000, uuid: "a" });
		await expect(
			t
				.withIdentity({ subject: USER })
				.mutation(internal.invoices.claimUnbilled, { projectId }),
		).rejects.toThrow("Assign this project to a client");
	});
});

describe("failInvoice", () => {
	test("rolls the watermark back when nothing newer advanced it", async () => {
		const { projectId } = await seedProject(t);
		await addHeartbeat(t, { ts: 0, syncedAt: 1000, uuid: "a" });

		const claim = await t
			.withIdentity({ subject: USER })
			.mutation(internal.invoices.claimUnbilled, { projectId });
		if (claim.empty) throw new Error("expected non-empty claim");

		await t.mutation(internal.invoices.failInvoice, {
			invoiceId: claim.invoiceId,
			projectId,
			fromCursor: claim.fromCursor,
			toCursor: claim.toCursor,
		});

		const { project, invoice } = await t.run(async (ctx) => ({
			project: await ctx.db.get(projectId),
			invoice: await ctx.db.get(claim.invoiceId),
		}));
		// fromCursor was 0 → watermark cleared, so the window can be re-billed.
		expect(project?.lastBilledSyncedAt).toBeUndefined();
		expect(invoice?.status).toBe("failed");
	});
});

describe("syncFromStripe", () => {
	test("marks paid via ledgerInvoiceId and sets paidAt", async () => {
		const { clientId, projectId } = await seedProject(t);
		const invoiceId = await t.run(async (ctx) =>
			ctx.db.insert("invoices", {
				userId: USER,
				clientId,
				projectId,
				status: "open",
				rateCentsSnapshot: 10_000,
				currency: "usd",
				hours: 1,
				amountCents: 10_000,
				periodStartSyncedAt: 0,
				periodEndSyncedAt: 1000,
				createdAt: 1,
				stripeInvoiceId: "in_test123",
			}),
		);

		await t.mutation(internal.invoices.syncFromStripe, {
			ledgerInvoiceId: invoiceId,
			stripeInvoiceId: "in_test123",
			stripeStatus: "paid",
			hostedInvoiceUrl: "https://pay.stripe.test/x",
			invoicePdfUrl: "https://pay.stripe.test/x.pdf",
		});

		const invoice = await t.run(async (ctx) => ctx.db.get(invoiceId));
		expect(invoice?.status).toBe("paid");
		expect(invoice?.paidAt).toBeGreaterThan(0);
		expect(invoice?.invoicePdfUrl).toBe("https://pay.stripe.test/x.pdf");
	});

	test("falls back to the stripe-invoice index when metadata is absent", async () => {
		const { clientId, projectId } = await seedProject(t);
		await t.run(async (ctx) =>
			ctx.db.insert("invoices", {
				userId: USER,
				clientId,
				projectId,
				status: "open",
				rateCentsSnapshot: 10_000,
				currency: "usd",
				hours: 1,
				amountCents: 10_000,
				periodStartSyncedAt: 0,
				periodEndSyncedAt: 1000,
				createdAt: 1,
				stripeInvoiceId: "in_fallback",
			}),
		);

		await t.mutation(internal.invoices.syncFromStripe, {
			ledgerInvoiceId: undefined,
			stripeInvoiceId: "in_fallback",
			stripeStatus: "void",
		});

		const all = await t.run(async (ctx) => ctx.db.query("invoices").collect());
		const invoice = all.find((i) => i.stripeInvoiceId === "in_fallback");
		expect(invoice?.status).toBe("void");
	});
});
