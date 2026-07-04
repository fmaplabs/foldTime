import { describe, expect, test } from "vitest";
import { billableMs, collapseIntoSessions } from "./sessions";

// Mirrors the Rust reference implementation in src/sessions.rs — the boundary
// semantics must match exactly so cloud hours agree with the CLI's report.
describe("collapseIntoSessions (parity with src/sessions.rs)", () => {
	const hb = (ts: number, project = "foo", task = "code") => ({
		ts,
		project,
		task,
	});

	test("empty input yields no sessions", () => {
		expect(collapseIntoSessions([], 60_000)).toEqual([]);
	});

	test("single heartbeat yields one zero-duration session", () => {
		const s = collapseIntoSessions([hb(1_000)], 60_000);
		expect(s).toHaveLength(1);
		expect(s[0]).toMatchObject({ start: 1_000, end: 1_000, project: "foo", task: "code" });
	});

	test("consecutive heartbeats extend one session", () => {
		const s = collapseIntoSessions([hb(1_000), hb(2_000), hb(3_500)], 60_000);
		expect(s).toHaveLength(1);
		expect(s[0]).toMatchObject({ start: 1_000, end: 3_500 });
	});

	test("gap over threshold splits into two sessions", () => {
		const s = collapseIntoSessions([hb(0), hb(60_001)], 60_000);
		expect(s).toHaveLength(2);
		expect([s[0].start, s[0].end]).toEqual([0, 0]);
		expect([s[1].start, s[1].end]).toEqual([60_001, 60_001]);
	});

	test("gap exactly at threshold stays merged (boundary is strictly >)", () => {
		const s = collapseIntoSessions([hb(0), hb(60_000)], 60_000);
		expect(s).toHaveLength(1);
		expect([s[0].start, s[0].end]).toEqual([0, 60_000]);
	});

	test("project change splits even within threshold", () => {
		const s = collapseIntoSessions([hb(0, "foo"), hb(1_000, "bar")], 60_000);
		expect(s).toHaveLength(2);
		expect(s[0].project).toBe("foo");
		expect(s[1].project).toBe("bar");
	});

	test("task change splits even within threshold", () => {
		const s = collapseIntoSessions(
			[hb(0, "foo", "code"), hb(1_000, "foo", "docs")],
			60_000,
		);
		expect(s).toHaveLength(2);
		expect(s[0].task).toBe("code");
		expect(s[1].task).toBe("docs");
	});

	test("negative gap from clock skew forces a split", () => {
		const s = collapseIntoSessions([hb(10_000), hb(9_000)], 60_000);
		expect(s).toHaveLength(2);
		expect(s[0].start).toBe(10_000);
		expect(s[1].start).toBe(9_000);
	});
});

describe("billableMs (per-device sessionize, interval union across devices)", () => {
	const hb = (deviceId: string, ts: number, project = "foo", task = "code") => ({
		deviceId,
		ts,
		project,
		task,
	});

	test("empty input bills nothing", () => {
		expect(billableMs([], 60_000)).toBe(0);
	});

	test("a lone heartbeat is zero duration", () => {
		expect(billableMs([hb("a", 1_000)], 60_000)).toBe(0);
	});

	test("one device, one continuous session bills end-minus-start", () => {
		const ms = billableMs([hb("a", 0), hb("a", 30_000), hb("a", 90_000)], 120_000);
		expect(ms).toBe(90_000);
	});

	test("two devices working the SAME wall-clock window bill it once (union)", () => {
		// Both devices span [0, 60_000]; summing per-device would double it.
		const ms = billableMs(
			[hb("a", 0), hb("a", 60_000), hb("b", 0), hb("b", 60_000)],
			120_000,
		);
		expect(ms).toBe(60_000);
	});

	test("two devices in DISJOINT windows sum", () => {
		const ms = billableMs(
			[hb("a", 0), hb("a", 10_000), hb("b", 100_000), hb("b", 130_000)],
			120_000,
		);
		expect(ms).toBe(10_000 + 30_000);
	});

	test("partially overlapping device windows count the union length", () => {
		// a: [0, 60_000], b: [30_000, 90_000] → union [0, 90_000] = 90_000
		const ms = billableMs(
			[hb("a", 0), hb("a", 60_000), hb("b", 30_000), hb("b", 90_000)],
			120_000,
		);
		expect(ms).toBe(90_000);
	});

	test("device heartbeats given out of order are still sessionized correctly", () => {
		// Same device, unsorted input; sorting must happen before collapsing so a
		// real backward step isn't misread as clock skew.
		const ms = billableMs([hb("a", 60_000), hb("a", 0), hb("a", 30_000)], 120_000);
		expect(ms).toBe(60_000);
	});
});
