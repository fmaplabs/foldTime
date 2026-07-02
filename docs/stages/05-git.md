# Stage 5: `git.rs` — shelling out to git

Wrap the system `git` binary via `std::process::Command` rather than a
libgit2 binding — gets worktree/`core.hooksPath`/submodule correctness for
free.

## Concepts

- `std::process::Command`
- `String` vs `&str`
- Parsing/trimming subprocess output
- Propagating subprocess failures as `Result`

## Tasks

- [ ] `repo_root(cwd: &Path) -> Result<PathBuf>` via `git rev-parse --show-toplevel`
- [ ] `current_branch(cwd: &Path) -> Result<String>` via `git symbolic-ref
  --short -q HEAD` — this fails cleanly (non-zero exit) on detached HEAD
  rather than returning an ambiguous `"HEAD"`; decide how the detached case
  gets represented (plan: `detached@<short-sha>`, using a separate `git
  rev-parse --short HEAD` call)
- [ ] `hooks_dir(cwd: &Path) -> Result<PathBuf>` via `git rev-parse --git-path hooks`
  (this respects a repo's `core.hooksPath` override, which hand-parsing
  `.git/` would have to reimplement)
- [ ] `head_sha(cwd: &Path) -> Result<String>` via `git rev-parse HEAD`
- [ ] A shared helper to run a `Command`, check its exit status, and turn a
  non-zero exit into an `Err` with the captured stderr — all four functions
  above should funnel through it rather than duplicating exit-status checks
- [ ] Unit tests against real throwaway repos: `tempfile::tempdir()` + shelled
  `git init` + `git commit` (you'll need `-c user.email=... -c
  user.name=...` or equivalent env vars so this doesn't depend on your global
  git config being present in CI); include an explicit detached-HEAD test
  (`git checkout <sha>` after committing)

## Resources

- [`std::process::Command`](https://doc.rust-lang.org/std/process/struct.Command.html)
- [`std::process::Output`](https://doc.rust-lang.org/std/process/struct.Output.html)
- [The Rust Book ch. 8.2 — Storing UTF-8 Encoded Text with Strings](https://doc.rust-lang.org/book/ch08-02-strings.html) (`String` vs `&str`)
- [`git rev-parse`](https://git-scm.com/docs/git-rev-parse) — `--show-toplevel`, `--git-path`, and bare `HEAD` all documented here
- [`git symbolic-ref`](https://git-scm.com/docs/git-symbolic-ref)
- [`githooks`](https://git-scm.com/docs/githooks) — the `post-commit` contract you'll rely on in Stage 9
- [`tempfile` docs.rs](https://docs.rs/tempfile/latest/tempfile/)
