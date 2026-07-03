// Heartbeat time is measured in milliseconds. Hours are the billable unit.

export function msToHours(ms: number): number {
	return ms / 3_600_000;
}

// Decimal hours, e.g. "2.50h" — how invoices quantify billed time.
export function formatHours(ms: number): string {
	return `${msToHours(ms).toFixed(2)}h`;
}

// Human duration, e.g. "1h 35m" — matches the CLI's report formatting. Sub-
// minute rounds to "0m".
export function formatDurationMs(ms: number): string {
	const totalMinutes = Math.floor(ms / 60_000);
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	if (h === 0) return `${m}m`;
	if (m === 0) return `${h}h`;
	return `${h}h ${m}m`;
}
