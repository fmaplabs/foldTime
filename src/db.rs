use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, params};

use crate::sessions::Heartbeat;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS heartbeats (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,
    project     TEXT NOT NULL,
    task        TEXT NOT NULL,
    file        TEXT,
    is_write    INTEGER NOT NULL DEFAULT 0,
    commit_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_project_task_ts
    ON heartbeats (project, task, ts);
CREATE INDEX IF NOT EXISTS idx_heartbeats_commit_hash
    ON heartbeats (commit_hash);
";

/// Open (creating if necessary) the heartbeat database and make sure the
/// schema exists. WAL + a busy timeout let an editor heartbeat and a
/// post-commit hook write concurrently without either erroring out.
pub fn open_db(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    // `PRAGMA journal_mode=WAL` returns the resulting mode as a row, so it
    // has to be run as a query — `execute` would reject the returned row.
    let _mode: String = conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

pub fn insert_heartbeat(
    conn: &Connection,
    ts: i64,
    project: &str,
    task: &str,
    file: Option<&str>,
    is_write: bool,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO heartbeats (ts, project, task, file, is_write) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![ts, project, task, file, is_write],
    )?;
    Ok(())
}

/// Fetch heartbeats matching the given filters (each `None` means "don't
/// filter"), ordered by `ts ASC` — the order `collapse_into_sessions` expects.
/// `since` is inclusive, `until` exclusive.
pub fn query_heartbeats(
    conn: &Connection,
    project: Option<&str>,
    task: Option<&str>,
    since: Option<i64>,
    until: Option<i64>,
) -> rusqlite::Result<Vec<Heartbeat>> {
    let mut stmt = conn.prepare(
        "SELECT ts, project, task, commit_hash FROM heartbeats
         WHERE (?1 IS NULL OR project = ?1)
           AND (?2 IS NULL OR task = ?2)
           AND (?3 IS NULL OR ts >= ?3)
           AND (?4 IS NULL OR ts < ?4)
         ORDER BY ts ASC",
    )?;
    let rows = stmt.query_map(params![project, task, since, until], |row| {
        Ok(Heartbeat {
            ts: row.get(0)?,
            project: row.get(1)?,
            task: row.get(2)?,
            commit_hash: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// Stamp `commit_hash` onto every not-yet-tagged heartbeat for this
/// project/task — called by the post-commit hook. Returns how many rows were
/// tagged.
pub fn tag_untagged_heartbeats(
    conn: &Connection,
    project: &str,
    task: &str,
    commit_hash: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE heartbeats SET commit_hash = ?3
         WHERE project = ?1 AND task = ?2 AND commit_hash IS NULL",
        params![project, task, commit_hash],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn
    }

    #[test]
    fn insert_then_query_round_trips() {
        let conn = test_db();
        insert_heartbeat(&conn, 1_000, "foo", "main", Some("src/lib.rs"), true).unwrap();

        let hbs = query_heartbeats(&conn, None, None, None, None).unwrap();
        assert_eq!(hbs.len(), 1);
        assert_eq!(hbs[0].ts, 1_000);
        assert_eq!(hbs[0].project, "foo");
        assert_eq!(hbs[0].task, "main");
        assert_eq!(hbs[0].commit_hash, None);
    }

    #[test]
    fn query_orders_by_ts_ascending() {
        let conn = test_db();
        for ts in [3_000, 1_000, 2_000] {
            insert_heartbeat(&conn, ts, "foo", "main", None, false).unwrap();
        }

        let hbs = query_heartbeats(&conn, None, None, None, None).unwrap();
        let timestamps: Vec<i64> = hbs.iter().map(|hb| hb.ts).collect();
        assert_eq!(timestamps, vec![1_000, 2_000, 3_000]);
    }

    #[test]
    fn query_filters_by_project_task_and_time_window() {
        let conn = test_db();
        insert_heartbeat(&conn, 1_000, "foo", "main", None, false).unwrap();
        insert_heartbeat(&conn, 2_000, "foo", "feature", None, false).unwrap();
        insert_heartbeat(&conn, 3_000, "bar", "main", None, false).unwrap();

        let foo = query_heartbeats(&conn, Some("foo"), None, None, None).unwrap();
        assert_eq!(foo.len(), 2);

        let foo_main = query_heartbeats(&conn, Some("foo"), Some("main"), None, None).unwrap();
        assert_eq!(foo_main.len(), 1);
        assert_eq!(foo_main[0].ts, 1_000);

        // since inclusive, until exclusive
        let windowed = query_heartbeats(&conn, None, None, Some(2_000), Some(3_000)).unwrap();
        assert_eq!(windowed.len(), 1);
        assert_eq!(windowed[0].ts, 2_000);
    }

    #[test]
    fn tagging_only_touches_untagged_rows_for_that_project_and_task() {
        let conn = test_db();
        insert_heartbeat(&conn, 1_000, "foo", "main", None, false).unwrap();
        insert_heartbeat(&conn, 2_000, "foo", "main", None, false).unwrap();
        insert_heartbeat(&conn, 3_000, "foo", "feature", None, false).unwrap();
        insert_heartbeat(&conn, 4_000, "bar", "main", None, false).unwrap();

        let tagged = tag_untagged_heartbeats(&conn, "foo", "main", "abc123").unwrap();
        assert_eq!(tagged, 2);

        // A second commit must not re-tag rows the first one claimed.
        insert_heartbeat(&conn, 5_000, "foo", "main", None, false).unwrap();
        let tagged = tag_untagged_heartbeats(&conn, "foo", "main", "def456").unwrap();
        assert_eq!(tagged, 1);

        let hbs = query_heartbeats(&conn, None, None, None, None).unwrap();
        let hashes: Vec<Option<&str>> = hbs.iter().map(|hb| hb.commit_hash.as_deref()).collect();
        assert_eq!(
            hashes,
            vec![
                Some("abc123"),
                Some("abc123"),
                None, // foo/feature untouched
                None, // bar/main untouched
                Some("def456"),
            ]
        );
    }

    // WAL is a no-op for in-memory connections (they always report "memory"),
    // so asserting it there would be meaningless — verify against a real file.
    #[test]
    fn open_db_puts_a_file_backed_db_into_wal_mode() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_db(&tmp.path().join("foldtime.db")).unwrap();

        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
    }

    #[test]
    fn open_db_is_idempotent_and_keeps_existing_rows() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("foldtime.db");

        let conn = open_db(&path).unwrap();
        insert_heartbeat(&conn, 1_000, "foo", "main", None, false).unwrap();
        drop(conn);

        let conn = open_db(&path).unwrap(); // re-running DDL must not clobber
        let hbs = query_heartbeats(&conn, None, None, None, None).unwrap();
        assert_eq!(hbs.len(), 1);
    }
}
