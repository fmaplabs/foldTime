//! Black-box test of the compiled binary: a real temp repo, a real
//! `foldtime init`, a real `git commit` firing the real installed hook, and
//! direct SQLite assertions on the temp database it all wrote to.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// Cargo sets CARGO_BIN_EXE_<name> for integration tests — the path to the
/// compiled binary under test.
const BIN: &str = env!("CARGO_BIN_EXE_foldtime");

struct TestEnv {
    _tmp: tempfile::TempDir, // held for its Drop; deletes everything below
    repo: PathBuf,
    home: PathBuf,
}

fn setup() -> TestEnv {
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path().join("repo");
    let home = tmp.path().join("foldtime-home");
    fs::create_dir_all(&repo).unwrap();
    let env = TestEnv {
        _tmp: tmp,
        repo,
        home,
    };
    git(&env, &["init", "--initial-branch=main"]);
    env
}

/// Every process in the test — git or foldtime (whose hook runs git, and
/// which itself shells out to git) — gets the same hermetic environment:
/// the temp FOLDTIME_HOME, no user/system git config, a pinned identity,
/// and the compiled binary's directory on PATH so the hook can find it.
fn command(env: &TestEnv, program: &str, args: &[&str]) -> Command {
    let bin_dir = Path::new(BIN).parent().unwrap();
    let path_var = format!(
        "{}:{}",
        bin_dir.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(&env.repo)
        .env("FOLDTIME_HOME", &env.home)
        .env("PATH", path_var)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Test")
        .env("GIT_AUTHOR_EMAIL", "test@example.com")
        .env("GIT_COMMITTER_NAME", "Test")
        .env("GIT_COMMITTER_EMAIL", "test@example.com");
    cmd
}

fn git(env: &TestEnv, args: &[&str]) -> String {
    let output = command(env, "git", args).output().unwrap();
    assert!(
        output.status.success(),
        "`git {}` failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim_end().to_string()
}

fn foldtime(env: &TestEnv, args: &[&str]) -> Output {
    command(env, BIN, args).output().unwrap()
}

#[test]
fn init_installs_hook_and_a_real_commit_tags_heartbeats() {
    let env = setup();

    // --- foldtime init --with-config ---
    let out = foldtime(&env, &["init", "--with-config"]);
    assert!(
        out.status.success(),
        "init failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let hook = env.repo.join(".git/hooks/post-commit");
    assert!(hook.exists(), "post-commit hook was not created");
    let mode = fs::metadata(&hook).unwrap().permissions().mode();
    assert_ne!(mode & 0o111, 0, "hook is not executable (mode {mode:o})");

    assert!(env.repo.join(".foldtime.json").exists());
    assert!(env.repo.join(".foldtime.schema.json").exists());

    // Scaffolded config parses and points at the sibling schema.
    let config: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(env.repo.join(".foldtime.json")).unwrap())
            .unwrap();
    assert_eq!(config["$schema"], "./.foldtime.schema.json");
    assert_eq!(config["project"], "repo");

    // --- re-running init must detect the hook, not duplicate it ---
    let out = foldtime(&env, &["init"]);
    assert!(out.status.success());
    let contents = fs::read_to_string(&hook).unwrap();
    assert_eq!(
        contents.matches("foldtime hook-commit").count(),
        1,
        "re-running init duplicated the hook invocation:\n{contents}"
    );

    // --- heartbeats land in the temp DB, untagged ---
    for _ in 0..2 {
        let out = foldtime(&env, &["heartbeat", "--file", "src/main.rs"]);
        assert!(out.status.success());
    }

    // --- a real commit fires the real hook, which tags them ---
    fs::write(env.repo.join("file.txt"), "hello").unwrap();
    git(&env, &["add", "."]);
    git(&env, &["commit", "-m", "test commit"]);
    let head = git(&env, &["rev-parse", "HEAD"]);

    let conn = rusqlite::Connection::open(env.home.join("foldtime.db")).unwrap();
    let rows: Vec<(String, Option<String>)> = conn
        .prepare("SELECT project, commit_hash FROM heartbeats ORDER BY ts")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();

    assert_eq!(rows.len(), 2, "expected the 2 recorded heartbeats");
    for (project, commit_hash) in &rows {
        assert_eq!(project, "repo");
        assert_eq!(
            commit_hash.as_deref(),
            Some(head.as_str()),
            "heartbeat was not tagged by the post-commit hook"
        );
    }
}

#[test]
fn heartbeat_outside_a_repo_exits_zero_and_records_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    let not_a_repo = tmp.path().join("plain-dir");
    let home = tmp.path().join("foldtime-home");
    fs::create_dir_all(&not_a_repo).unwrap();

    let out = Command::new(BIN)
        .args(["heartbeat"])
        .current_dir(&not_a_repo)
        .env("FOLDTIME_HOME", &home)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .output()
        .unwrap();

    // Never fail loudly: exit 0, nothing on stderr, no heartbeat stored.
    assert!(out.status.success(), "heartbeat outside a repo must exit 0");
    assert!(
        out.stderr.is_empty(),
        "stderr should be silent, got: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        !home.join("foldtime.db").exists(),
        "no db should be created for a failed heartbeat"
    );
    // ...but the failure is recorded in the error log.
    let log = fs::read_to_string(home.join("error.log")).unwrap();
    assert!(log.contains("git"), "expected a git failure in the log, got: {log}");
}
