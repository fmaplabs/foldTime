# foldTime

Commit-based time tracking for freelance software developers. Editor plugins
send heartbeats while you work; a git `post-commit` hook stamps each burst of
work with the commit that came out of it. Everything is stored locally in
SQLite (`~/.foldtime/foldtime.db`), so tracking works offline.

## Install

```sh
cargo install --path .
```

(or `cargo build --release` and copy `target/release/foldtime` somewhere on
your `PATH` — the post-commit hook invokes `foldtime` by name, so it must be
on `PATH` for tagging to work).

## Usage

Set up a repo (installs `.git/hooks/post-commit`; an existing hook is
appended to, never overwritten — re-running is a no-op):

```sh
foldtime init                 # hook only
foldtime init --with-config   # also scaffolds .foldtime.json + its schema
```

Record work (normally fired by an editor plugin, not by hand):

```sh
foldtime heartbeat --file src/api.rs          # a read/navigation event
foldtime heartbeat --file src/api.rs --write  # a write event
```

See where the time went:

```sh
foldtime report
foldtime report --project acme-api --since 2026-07-01 --until 2026-07-31
foldtime report --idle-threshold-minutes 30
```

Heartbeats collapse into sessions: a gap longer than the idle threshold
(default 15 minutes), or a switch of project/branch, starts a new session.
`--since`/`--until` are inclusive calendar days in local time.

## Per-repo config (`.foldtime.json`, optional)

```json
{
  "$schema": "./.foldtime.schema.json",
  "project": "acme-api",
  "idleThresholdMinutes": 15
}
```

- `project` — overrides the project name (default: the repo directory's name;
  the branch name is used as the task).
- `idleThresholdMinutes` — session-split threshold. Precedence: CLI flag >
  `.foldtime.json` > default (15).

`foldtime schema` prints the JSON Schema for this file (the same one
`init --with-config` writes next to it, which `$schema`-aware editors pick up
for validation and completion).

## Never fail loudly

`heartbeat` and `hook-commit` are designed to be safe to call from an editor
or a git hook: they always exit 0 and print nothing, no matter what goes
wrong (not in a repo, malformed config, locked database, even an internal
panic). Failures are appended to `~/.foldtime/error.log` instead — look
there if heartbeats seem to be disappearing.

`FOLDTIME_HOME` overrides the `~/.foldtime` data directory (used by the
integration tests; handy for keeping scratch experiments out of your real
data).
