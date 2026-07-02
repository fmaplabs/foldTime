use std::env;

use anyhow::{Context, Result};
use chrono::Utc;

use crate::{db, errors, paths, project};

/// Record one heartbeat for the repo containing the current directory.
/// Runs under `run_silently`: outside a repo (or on any other failure) this
/// is a no-op that exits 0, so editor plugins can fire it unconditionally.
pub fn run(file: Option<String>, is_write: bool) {
    errors::run_silently(|| record_heartbeat(file.as_deref(), is_write));
}

fn record_heartbeat(file: Option<&str>, is_write: bool) -> Result<()> {
    let cwd = env::current_dir().context("resolving current directory")?;
    let identity = project::resolve_identity(&cwd)?;

    let home = paths::ensure_foldtime_home()?;
    let conn = db::open_db(&paths::db_path(&home)).context("opening heartbeat db")?;
    db::insert_heartbeat(
        &conn,
        Utc::now().timestamp_millis(),
        &identity.project,
        &identity.task,
        file,
        is_write,
    )
    .context("inserting heartbeat")?;
    Ok(())
}
