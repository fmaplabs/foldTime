import Stripe from "stripe";

// Raw Stripe SDK for ad-hoc invoicing — the @convex-dev/stripe component only
// reads Stripe objects (via webhooks) and manages subscriptions/checkout; it
// can't create Invoices + InvoiceItems. Runs in Convex's default runtime with
// no "use node" (the SDK auto-selects a fetch HTTP client), mirroring the
// component's own webhook handler.
export function getStripe(): Stripe {
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key) {
		throw new Error("STRIPE_SECRET_KEY is not set");
	}
	return new Stripe(key);
}
