// The single place billable rates are resolved. Three levels, most specific
// first: a per-project override, else the client's rate, else the global
// default. All values are integer minor units (cents) per hour.
export function resolveRateCents(
	project: { rateCents?: number } | null | undefined,
	client: { rateCents?: number } | null | undefined,
	settings: { defaultRateCents: number },
): number {
	return (
		project?.rateCents ?? client?.rateCents ?? settings.defaultRateCents
	);
}
