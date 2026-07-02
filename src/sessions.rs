use std::collections::HashSet;

#[derive(Debug, PartialEq)]
pub struct Heartbeat {
    pub ts: i64,
    pub project: String,
    pub task: String,
    pub commit_hash: Option<String>,
}

#[derive(Debug, PartialEq)]
pub struct Session {
    pub project: String,
    pub task: String,
    pub start: i64,
    pub end: i64,
    pub count: i64,
    pub commits: HashSet<String>,
}

/// Collapse a slice of heartbeats (assumed sorted by `ts` ascending) into
/// sessions, breaking whenever the gap exceeds `idle_threshold_ms`, the gap is
/// negative (clock skew), or the project/task changes.
pub fn collapse_into_sessions(heartbeats: &[Heartbeat], idle_threshold_ms: i64) -> Vec<Session> {
    let mut sessions: Vec<Session> = Vec::new();

    for hb in heartbeats {
        let should_break = match sessions.last() {
            Some(cur) => breaks_session(cur, hb, idle_threshold_ms),
            None => true, // nothing open yet → open the first session
        };

        if should_break {
            sessions.push(start_session(hb));
        } else {
            let cur = sessions.last_mut().expect("break=false implies an open session");
            cur.end = hb.ts;
            cur.count += 1;
            if let Some(c) = &hb.commit_hash {
                cur.commits.insert(c.clone());
            }
        }
    }

    sessions
}

/// Should `hb` close the current session and start a new one?
/// Breaks on clock skew (negative gap), idle gap over threshold, or a
/// project/task context switch.
fn breaks_session(cur: &Session, hb: &Heartbeat, idle_threshold_ms: i64) -> bool {
    let gap = hb.ts - cur.end;
    gap < 0 // clock skew — don't trust it
        || gap > idle_threshold_ms
        || hb.project != cur.project
        || hb.task != cur.task
}

/// Open a fresh session seeded from a heartbeat: zero duration, count 1, and
/// its commit hash (if any) as the first entry in the set.
fn start_session(hb: &Heartbeat) -> Session {
    let mut commits = HashSet::new();
    if let Some(c) = &hb.commit_hash {
        commits.insert(c.clone());
    }
    Session {
        project: hb.project.clone(),
        task: hb.task.clone(),
        start: hb.ts,
        end: hb.ts,
        count: 1,
        commits,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Terse constructor so the tests read as data, not struct-literal noise.
    fn hb(ts: i64, project: &str, task: &str, commit: Option<&str>) -> Heartbeat {
        Heartbeat {
            ts,
            project: project.to_string(),
            task: task.to_string(),
            commit_hash: commit.map(str::to_string),
        }
    }

    #[test]
    fn empty_input_yields_no_sessions() {
        let sessions = collapse_into_sessions(&[], 60_000);
        assert_eq!(sessions, vec![]);
    }

    #[test]
    fn single_heartbeat_yields_one_session_of_zero_duration() {
        let sessions = collapse_into_sessions(&[hb(1_000, "foo", "code", None)], 60_000);

        assert_eq!(sessions.len(), 1);
        let s = &sessions[0];
        assert_eq!(s.start, 1_000);
        assert_eq!(s.end, 1_000);
        assert_eq!(s.count, 1);
        assert_eq!(s.project, "foo");
        assert_eq!(s.task, "code");
        assert!(s.commits.is_empty());
    }

    #[test]
    fn consecutive_heartbeats_extend_one_session_and_collect_commits() {
        let hbs = [
            hb(1_000, "foo", "code", Some("aaa")),
            hb(2_000, "foo", "code", None),
            hb(3_000, "foo", "code", Some("bbb")),
            hb(3_500, "foo", "code", Some("aaa")), // duplicate — must dedupe
        ];
        let sessions = collapse_into_sessions(&hbs, 60_000);

        assert_eq!(sessions.len(), 1);
        let s = &sessions[0];
        assert_eq!(s.start, 1_000);
        assert_eq!(s.end, 3_500);
        assert_eq!(s.count, 4);
        assert_eq!(
            s.commits,
            HashSet::from(["aaa".to_string(), "bbb".to_string()])
        );
    }

    #[test]
    fn gap_over_threshold_splits_into_two_sessions() {
        let hbs = [
            hb(0, "foo", "code", None),
            hb(60_001, "foo", "code", None), // gap 60_001 > 60_000 threshold
        ];
        let sessions = collapse_into_sessions(&hbs, 60_000);

        assert_eq!(sessions.len(), 2);
        assert_eq!((sessions[0].start, sessions[0].end), (0, 0));
        assert_eq!((sessions[1].start, sessions[1].end), (60_001, 60_001));
    }

    #[test]
    fn gap_exactly_at_threshold_stays_merged() {
        let hbs = [
            hb(0, "foo", "code", None),
            hb(60_000, "foo", "code", None), // gap == threshold → boundary is `>`, stays merged
        ];
        let sessions = collapse_into_sessions(&hbs, 60_000);

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].start, 0);
        assert_eq!(sessions[0].end, 60_000);
        assert_eq!(sessions[0].count, 2);
    }

    #[test]
    fn project_change_splits_even_within_threshold() {
        let hbs = [
            hb(0, "foo", "code", None),
            hb(1_000, "bar", "code", None), // tiny gap, but different project
        ];
        let sessions = collapse_into_sessions(&hbs, 60_000);

        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].project, "foo");
        assert_eq!(sessions[1].project, "bar");
    }

    #[test]
    fn task_change_splits_even_within_threshold() {
        let hbs = [
            hb(0, "foo", "code", None),
            hb(1_000, "foo", "docs", None), // tiny gap, but different task
        ];
        let sessions = collapse_into_sessions(&hbs, 60_000);

        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].task, "code");
        assert_eq!(sessions[1].task, "docs");
    }

    #[test]
    fn negative_gap_from_clock_skew_forces_a_split() {
        let hbs = [
            hb(10_000, "foo", "code", None),
            hb(9_000, "foo", "code", None), // earlier than previous → clock skew, don't trust it
        ];
        let sessions = collapse_into_sessions(&hbs, 60_000);

        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].start, 10_000);
        assert_eq!(sessions[1].start, 9_000);
    }
}
