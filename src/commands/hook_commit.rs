use std::env;

use anyhow::{Context, Result};

use crate::{db, errors, git, paths, project};

/// Called by the installed post-commit hook: stamp HEAD's sha onto every
/// still-untagged heartbeat for this project/task. Runs under
/// `run_silently` so a broken foldtime install can never disturb a commit.
pub fn run() {
    errors::run_silently(tag_heartbeats_with_head);
}

fn tag_heartbeats_with_head() -> Result<()> {
    let cwd = env::current_dir().context("resolving current directory")?;
    let identity = project::resolve_identity(&cwd)?;
    let sha = git::head_sha(&cwd)?;

    let home = paths::ensure_foldtime_home()?;
    let conn = db::open_db(&paths::db_path(&home)).context("opening heartbeat db")?;
    db::tag_untagged_heartbeats(&conn, &identity.project, &identity.task, &sha)
        .context("tagging heartbeats")?;
    Ok(())
}
