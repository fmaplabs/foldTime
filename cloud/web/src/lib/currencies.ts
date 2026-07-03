// Client-side mirror of the server allowlist in convex/settings.ts
// (SUPPORTED_CURRENCIES). Keep the two in sync — v1 supports only two-decimal
// currencies so integer cents map 1:1 to Stripe's minor unit.
export const CURRENCIES = [
	"usd",
	"eur",
	"gbp",
	"cad",
	"aud",
	"nzd",
	"chf",
	"sek",
	"nok",
	"dkk",
	"sgd",
	"hkd",
	"inr",
	"brl",
	"mxn",
	"zar",
	"pln",
] as const;
