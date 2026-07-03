import { registerRoutes } from "@convex-dev/stripe";
import type {
	GenericActionCtx,
	GenericDataModel,
} from "convex/server";
import { httpRouter } from "convex/server";
import type Stripe from "stripe";
import { components, internal } from "./_generated/api";
import { authKit } from "./auth";

const http = httpRouter();

// Mounts the WorkOS webhook receiver at /workos/webhook so the component
// can sync user create/update/delete events into its user table.
authKit.registerRoutes(http);

// Reconcile a Stripe invoice event into our own `invoices` table (the source of
// truth). The component verifies the signature and syncs its internal tables
// first, then calls this. Keyed on the id we stamped into metadata, so a crash
// in `generate` after finalize (client already charged) still converges.
async function reconcileInvoice(
	ctx: GenericActionCtx<GenericDataModel>,
	event: Stripe.Event,
) {
	const invoice = event.data.object as Stripe.Invoice;
	await ctx.runMutation(internal.invoices.syncFromStripe, {
		ledgerInvoiceId: invoice.metadata?.ledgerInvoiceId ?? undefined,
		stripeInvoiceId: invoice.id ?? "",
		stripeStatus: invoice.status ?? null,
		hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
		invoicePdfUrl: invoice.invoice_pdf ?? undefined,
	});
}

// Single shared webhook endpoint (/stripe/webhook) and one STRIPE_WEBHOOK_SECRET.
registerRoutes(http, components.stripe, {
	events: {
		"invoice.finalized": reconcileInvoice,
		"invoice.paid": reconcileInvoice,
		"invoice.payment_failed": reconcileInvoice,
		"invoice.voided": reconcileInvoice,
	},
});

export default http;
