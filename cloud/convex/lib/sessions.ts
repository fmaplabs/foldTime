// Deriving billable hours from raw heartbeats. Ported from the Rust reference
// (src/sessions.rs); the boundary semantics must stay identical so the cloud
// and the CLI agree. Billing then unions sessions across devices so overlapping
// wall-clock time (laptop + desktop at once) is charged only once.

export type SessionHeartbeat = { ts: number; project: string; task: string };
export type DeviceHeartbeat = SessionHeartbeat & { deviceId: string };
export type Session = {
	project: string;
	task: string;
	start: number;
	end: number;
};
export type Interval = { start: number; end: number };

// Collapse heartbeats (ASSUMED sorted by `ts` ascending) into sessions. A new
// session starts on a negative gap (clock skew — don't trust it), an idle gap
// over the threshold, or a project/task change. A lone heartbeat is a
// zero-duration session.
export function collapseIntoSessions(
	heartbeats: readonly SessionHeartbeat[],
	idleThresholdMs: number,
): Session[] {
	const sessions: Session[] = [];
	for (const hb of heartbeats) {
		const cur = sessions[sessions.length - 1];
		if (cur === undefined || breaksSession(cur, hb, idleThresholdMs)) {
			sessions.push({
				project: hb.project,
				task: hb.task,
				start: hb.ts,
				end: hb.ts,
			});
		} else {
			cur.end = hb.ts;
		}
	}
	return sessions;
}

function breaksSession(
	cur: Session,
	hb: SessionHeartbeat,
	idleThresholdMs: number,
): boolean {
	const gap = hb.ts - cur.end;
	return (
		gap < 0 || // clock skew
		gap > idleThresholdMs ||
		hb.project !== cur.project ||
		hb.task !== cur.task
	);
}

// Total length covered by a set of intervals, counting overlaps once.
export function unionLengthMs(intervals: readonly Interval[]): number {
	if (intervals.length === 0) return 0;
	const sorted = [...intervals].sort((a, b) => a.start - b.start);
	let total = 0;
	let curStart = sorted[0].start;
	let curEnd = sorted[0].end;
	for (let i = 1; i < sorted.length; i++) {
		const iv = sorted[i];
		if (iv.start <= curEnd) {
			// overlapping or touching — extend the open interval
			if (iv.end > curEnd) curEnd = iv.end;
		} else {
			total += curEnd - curStart;
			curStart = iv.start;
			curEnd = iv.end;
		}
	}
	return total + (curEnd - curStart);
}

// Billable milliseconds across all devices: sessionize each device's stream
// independently (so its own clock-skew guard stays meaningful), then union the
// resulting intervals so concurrent multi-device time is billed once.
export function billableMs(
	heartbeats: readonly DeviceHeartbeat[],
	idleThresholdMs: number,
): number {
	const byDevice = new Map<string, SessionHeartbeat[]>();
	for (const hb of heartbeats) {
		let stream = byDevice.get(hb.deviceId);
		if (stream === undefined) {
			stream = [];
			byDevice.set(hb.deviceId, stream);
		}
		stream.push({ ts: hb.ts, project: hb.project, task: hb.task });
	}

	const intervals: Interval[] = [];
	for (const stream of byDevice.values()) {
		stream.sort((a, b) => a.ts - b.ts);
		for (const s of collapseIntoSessions(stream, idleThresholdMs)) {
			intervals.push({ start: s.start, end: s.end });
		}
	}
	return unionLengthMs(intervals);
}
