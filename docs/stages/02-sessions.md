# Stage 2: `sessions.rs` — the pure session-collapsing algorithm

The best first "real" Rust file: all core language ideas (structs, ownership,
iteration, testing), zero I/O. No filesystem, no SQLite, no subprocesses.

## Concepts

- Structs
- `Vec<T>` and slices (`&[T]`)
- `Option<T>`
- Basic ownership/borrowing
- Iterators
- `#[test]` / `assert_eq!`

## Tasks

- [ ] Define a `Heartbeat` struct: at minimum `ts: i64` (unix ms), `project:
  String`, `task: String`, `commit_hash: Option<String>` — enough fields for
  the algorithm to run on, independent of how `db.rs` will eventually
  represent rows
- [ ] Define a `Session` struct: `project`, `task`, `start: i64`, `end: i64`,
  a heartbeat count, and a collected set/list of `commit_hash`es seen
- [ ] Implement `collapse_into_sessions(heartbeats: &[Heartbeat], idle_threshold_ms: i64) -> Vec<Session>`,
  assuming input is pre-sorted by `ts` ascending
- [ ] Walk the slice, closing the current session and starting a new one when:
  - `gap > idle_threshold_ms`
  - `gap < 0` (clock skew — treat as a forced break, don't trust it)
  - `project` or `task` changes
- [ ] Otherwise extend the current session: `end = hb.ts`, increment count,
  union in `commit_hash` if present
- [ ] Unit tests, explicitly:
  - empty input → empty output
  - single heartbeat → one session, duration 0
  - gap exactly at threshold → **stays merged** (boundary is `>`, not `>=`)
  - project/task change with a sub-threshold gap → must split
  - negative gap (clock skew) → must split
  - multiple commits within one session → all collected
- [ ] `cargo test` green for this module

## Resources

- [The Rust Book ch. 5 — Using Structs](https://doc.rust-lang.org/book/ch05-00-structs.html)
- [The Rust Book ch. 4 — Understanding Ownership](https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html)
- [The Rust Book ch. 4.3 — The Slice Type](https://doc.rust-lang.org/book/ch04-03-slices.html)
- [The Rust Book ch. 8.1 — Storing Lists of Values with Vectors](https://doc.rust-lang.org/book/ch08-01-vectors.html)
- [`std::option::Option` docs](https://doc.rust-lang.org/std/option/enum.Option.html)
- [The Rust Book ch. 13.2 — Processing a Series of Items with Iterators](https://doc.rust-lang.org/book/ch13-02-iterators.html)
- [`std::slice::Windows`](https://doc.rust-lang.org/std/slice/struct.Windows.html) — one idiomatic way to look at consecutive-pair gaps (`heartbeats.windows(2)`)
- [The Rust Book ch. 11 — Writing Automated Tests](https://doc.rust-lang.org/book/ch11-00-testing.html)
