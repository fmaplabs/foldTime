use std::env;

use anyhow::{Context, Result};
use chrono::{Local, NaiveDate, TimeZone};

use crate::sessions::Session;
use crate::{config, db, git, paths, sessions, settings};

pub fn run(
    project: Option<String>,
    since: Option<String>,
    until: Option<String>,
    idle_threshold_minutes: Option<u32>,
) -> Result<()> {
    let since_ms = since.as_deref().map(parse_local_day_start).transpose()?;
    // `--until 2026-01-31` should include the 31st: use the *next* day's
    // start as the exclusive upper bound.
    let until_ms = until
        .as_deref()
        .map(parse_local_day_start_after)
        .transpose()?;

    let home = paths::ensure_foldtime_home()?;
    let settings = settings::load_or_init(&home)?;
    let conn =
        db::open_db(&paths::db_path(&home), &settings.device_id).context("opening heartbeat db")?;
    let heartbeats =
        db::query_heartbeats(&conn, project.as_deref(), None, since_ms, until_ms)
            .context("querying heartbeats")?;

    // Idle threshold: CLI flag > the current repo's config (if we're in a
    // repo at all) > built-in default.
    let repo_config = env::current_dir()
        .ok()
        .and_then(|cwd| git::repo_root(&cwd).ok())
        .map(|root| config::load_config(&root))
        .unwrap_or_default();
    let threshold_min = config::resolve_idle_threshold_minutes(idle_threshold_minutes, &repo_config);

    let sessions =
        sessions::collapse_into_sessions(&heartbeats, i64::from(threshold_min) * 60_000);
    print_table(&sessions);
    Ok(())
}

fn parse_local_day_start(day: &str) -> Result<i64> {
    local_day_start_ms(parse_day(day)?)
}

fn parse_local_day_start_after(day: &str) -> Result<i64> {
    let next = parse_day(day)?
        .succ_opt()
        .with_context(|| format!("no day after {day}"))?;
    local_day_start_ms(next)
}

fn parse_day(day: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .with_context(|| format!("invalid date {day:?} — expected YYYY-MM-DD"))
}

fn local_day_start_ms(day: NaiveDate) -> Result<i64> {
    let midnight = day.and_hms_opt(0, 0, 0).expect("midnight always exists");
    let local = Local
        .from_local_datetime(&midnight)
        .earliest() // DST gap at midnight → first valid instant
        .with_context(|| format!("could not resolve local midnight of {day}"))?;
    Ok(local.timestamp_millis())
}

fn print_table(sessions: &[Session]) {
    if sessions.is_empty() {
        println!("no heartbeats recorded for this period");
        return;
    }

    let project_width = column_width("project", sessions.iter().map(|s| s.project.len()));
    let task_width = column_width("task", sessions.iter().map(|s| s.task.len()));

    println!(
        "{:<project_width$}  {:<task_width$}  {:>8}  {:>7}",
        "project", "task", "duration", "commits"
    );
    for session in sessions {
        println!(
            "{:<project_width$}  {:<task_width$}  {:>8}  {:>7}",
            session.project,
            session.task,
            format_duration_ms(session.end - session.start),
            session.commits.len()
        );
    }

    let total_ms: i64 = sessions.iter().map(|s| s.end - s.start).sum();
    println!(
        "\ntotal: {} across {} session(s)",
        format_duration_ms(total_ms),
        sessions.len()
    );
}

fn column_width(header: &str, lens: impl Iterator<Item = usize>) -> usize {
    lens.chain([header.len()]).max().unwrap_or(0)
}

fn format_duration_ms(ms: i64) -> String {
    let minutes = ms / 60_000;
    let (hours, minutes) = (minutes / 60, minutes % 60);
    if hours > 0 {
        format!("{hours}h {minutes:02}m")
    } else {
        format!("{minutes}m")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations_format_as_hours_and_minutes() {
        assert_eq!(format_duration_ms(0), "0m");
        assert_eq!(format_duration_ms(59_000), "0m"); // sub-minute floors to 0
        assert_eq!(format_duration_ms(25 * 60_000), "25m");
        assert_eq!(format_duration_ms(95 * 60_000), "1h 35m");
        assert_eq!(format_duration_ms(600 * 60_000), "10h 00m");
    }

    #[test]
    fn dates_must_be_iso_days() {
        assert!(parse_day("2026-01-31").is_ok());
        assert!(parse_day("01/31/2026").is_err());
        assert!(parse_day("2026-13-01").is_err());
    }

    #[test]
    fn until_bound_is_the_start_of_the_next_day() {
        let day_start = parse_local_day_start("2026-01-31").unwrap();
        let bound = parse_local_day_start_after("2026-01-31").unwrap();
        assert_eq!(bound - day_start, 24 * 60 * 60 * 1000);
    }
}
