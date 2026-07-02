use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};

/// Run `git <args>` in `cwd`, returning trimmed stdout on success and an
/// `Err` carrying the captured stderr on a non-zero exit.
fn run_git(cwd: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .with_context(|| format!("failed to run `git {}`", args.join(" ")))?;
    if !output.status.success() {
        bail!(
            "`git {}` failed ({}): {}",
            args.join(" "),
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_string())
}

pub fn repo_root(cwd: &Path) -> Result<PathBuf> {
    Ok(PathBuf::from(run_git(cwd, &["rev-parse", "--show-toplevel"])?))
}

/// The current branch name, or `detached@<short-sha>` on a detached HEAD.
/// `symbolic-ref -q` exits non-zero (quietly) when HEAD isn't on a branch,
/// which is less ambiguous than parsing a literal `"HEAD"` out of stdout.
pub fn current_branch(cwd: &Path) -> Result<String> {
    match run_git(cwd, &["symbolic-ref", "--short", "-q", "HEAD"]) {
        Ok(branch) => Ok(branch),
        Err(_) => {
            let short_sha = run_git(cwd, &["rev-parse", "--short", "HEAD"])
                .context("resolving detached HEAD")?;
            Ok(format!("detached@{short_sha}"))
        }
    }
}

/// The repo's hooks directory. `--git-path` respects `core.hooksPath`,
/// worktrees, and submodules — all things hand-building `.git/hooks` breaks on.
pub fn hooks_dir(cwd: &Path) -> Result<PathBuf> {
    let path = run_git(cwd, &["rev-parse", "--git-path", "hooks"])?;
    // --git-path output is relative to cwd when possible; `join` is a no-op
    // prefix-wise if git handed back an absolute path.
    Ok(cwd.join(path))
}

pub fn head_sha(cwd: &Path) -> Result<String> {
    run_git(cwd, &["rev-parse", "HEAD"])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(cwd: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .status()
            .unwrap();
        assert!(status.success(), "`git {}` failed", args.join(" "));
    }

    fn init_repo(dir: &Path) {
        git(dir, &["init", "--initial-branch=main"]);
    }

    /// Commit with identity/signing pinned via -c so tests don't depend on
    /// the machine's global git config.
    fn commit(dir: &Path, msg: &str) {
        git(
            dir,
            &[
                "-c", "user.email=test@example.com",
                "-c", "user.name=Test",
                "-c", "commit.gpgsign=false",
                "commit", "--allow-empty", "-m", msg,
            ],
        );
    }

    #[test]
    fn repo_root_finds_toplevel_from_a_subdirectory() {
        let tmp = tempfile::tempdir().unwrap();
        init_repo(tmp.path());
        let sub = tmp.path().join("a").join("b");
        std::fs::create_dir_all(&sub).unwrap();

        let root = repo_root(&sub).unwrap();
        // git resolves symlinks (e.g. /tmp) — canonicalize before comparing.
        assert_eq!(root, tmp.path().canonicalize().unwrap());
    }

    #[test]
    fn repo_root_outside_a_repo_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        // Guard against the tempdir's *parents* being inside some repo:
        // GIT_CEILING_DIRECTORIES can't help here since tempdirs are already
        // outside the project — a plain tempdir is not a repo.
        let err = repo_root(tmp.path()).unwrap_err();
        assert!(err.to_string().contains("rev-parse"));
    }

    #[test]
    fn current_branch_reports_the_checked_out_branch() {
        let tmp = tempfile::tempdir().unwrap();
        init_repo(tmp.path());
        commit(tmp.path(), "initial");

        assert_eq!(current_branch(tmp.path()).unwrap(), "main");
    }

    #[test]
    fn detached_head_is_reported_as_detached_at_short_sha() {
        let tmp = tempfile::tempdir().unwrap();
        init_repo(tmp.path());
        commit(tmp.path(), "initial");
        git(tmp.path(), &["checkout", "--detach"]);

        let branch = current_branch(tmp.path()).unwrap();
        let short = run_git(tmp.path(), &["rev-parse", "--short", "HEAD"]).unwrap();
        assert_eq!(branch, format!("detached@{short}"));
    }

    #[test]
    fn hooks_dir_defaults_to_dot_git_hooks() {
        let tmp = tempfile::tempdir().unwrap();
        init_repo(tmp.path());

        let hooks = hooks_dir(tmp.path()).unwrap();
        assert_eq!(
            hooks.canonicalize().unwrap(),
            tmp.path().join(".git").join("hooks").canonicalize().unwrap()
        );
    }

    #[test]
    fn hooks_dir_respects_core_hooks_path_override() {
        let tmp = tempfile::tempdir().unwrap();
        init_repo(tmp.path());
        std::fs::create_dir(tmp.path().join(".myhooks")).unwrap();
        git(tmp.path(), &["config", "core.hooksPath", ".myhooks"]);

        let hooks = hooks_dir(tmp.path()).unwrap();
        assert!(hooks.ends_with(".myhooks"), "got {}", hooks.display());
    }

    #[test]
    fn head_sha_returns_the_full_forty_char_hash() {
        let tmp = tempfile::tempdir().unwrap();
        init_repo(tmp.path());
        commit(tmp.path(), "initial");

        let sha = head_sha(tmp.path()).unwrap();
        assert_eq!(sha.len(), 40);
        assert!(sha.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
