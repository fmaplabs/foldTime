// Money is stored and passed around as integer minor units (cents). Format for
// display and convert to/from the dollars a user types into a form.

export function formatCents(cents: number, currency = "usd"): string {
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(cents / 100);
}

// A rate shown compactly, e.g. "$100/hr".
export function formatRate(cents: number, currency = "usd"): string {
	return `${formatCents(cents, currency)}/hr`;
}

export function centsToInput(cents: number | undefined): string {
	return cents === undefined ? "" : (cents / 100).toFixed(2);
}

// Parse a dollars string from a form into integer cents. Returns undefined for
// blank/invalid input so callers can distinguish "clear" from "0".
export function inputToCents(value: string): number | undefined {
	const trimmed = value.trim();
	if (trimmed === "") return undefined;
	const dollars = Number.parseFloat(trimmed);
	if (Number.isNaN(dollars) || dollars < 0) return undefined;
	return Math.round(dollars * 100);
}
