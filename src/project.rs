use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::{config, git};

/// "What project/task am I in, right now?" — the answer every command needs.
#[derive(Debug, PartialEq)]
pub struct Identity {
    pub project: String,
    pub task: String,
    pub repo_root: PathBuf,
}

/// Resolve the identity for `cwd`. Not being in a git repo surfaces here as
/// a plain `Err` — whether that's fatal (`init`) or a silent no-op
/// (`heartbeat`) is the caller's policy, not this function's.
pub fn resolve_identity(cwd: &Path) -> Result<Identity> {
    let repo_root = git::repo_root(cwd)?;
    let task = git::current_branch(cwd)?;
    let config = config::load_config(&repo_root);

    let project = match config.project {
        Some(project) => project,
        None => repo_root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .context("repo root has no directory name")?,
    };

    Ok(Identity {
        project,
        task,
        repo_root,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn init_repo(dir: &Path) {
        let status = Command::new("git")
            .args(["init", "--initial-branch=main"])
            .current_dir(dir)
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[test]
    fn project_defaults_to_repo_root_dirname() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("my-cool-project");
        std::fs::create_dir(&repo).unwrap();
        init_repo(&repo);

        let identity = resolve_identity(&repo).unwrap();
        assert_eq!(identity.project, "my-cool-project");
        assert_eq!(identity.task, "main");
        assert_eq!(identity.repo_root, repo.canonicalize().unwrap());
    }

    #[test]
    fn config_override_beats_dirname() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("scratch-checkout-dir");
        std::fs::create_dir(&repo).unwrap();
        init_repo(&repo);
        std::fs::write(
            repo.join(config::CONFIG_FILE_NAME),
            r#"{"project": "acme-api"}"#,
        )
        .unwrap();

        let identity = resolve_identity(&repo).unwrap();
        assert_eq!(identity.project, "acme-api");
    }

    #[test]
    fn outside_a_repo_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(resolve_identity(tmp.path()).is_err());
    }
}
