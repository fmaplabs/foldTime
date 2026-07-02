# Stage 8: `errors.rs` — never fail loudly

The wrapper that makes `heartbeat` and `hook-commit` incapable of disrupting
the editor or blocking a commit, no matter what goes wrong internally.

## Concepts

- `std::panic::catch_unwind`
- Closures
- `anyhow` error context
- Process exit codes

## Tasks

- [ ] A function to append one line (timestamp + message) to the error-log
  file from `paths.rs`
- [ ] `run_silently<F>(f: F)` where `F: FnOnce() -> anyhow::Result<()>`:
  - runs `f` inside `std::panic::catch_unwind` (note: the closure needs to be
    `UnwindSafe` — this may shape how you capture state going in)
  - on `Err(e)`: log `e` (with its `anyhow` context chain) to the error log
  - on a caught panic: log the panic payload to the error log
  - either way: never propagates the failure to the caller — decide
    explicitly whether that means "return normally and let `main` exit 0" or
    "call `std::process::exit(0)` itself," since that choice affects how
    testable this function is
- [ ] Unit tests: closure returns `Ok(())` → no log entry written; closure
  returns `Err(...)` → log entry contains the error message; closure panics →
  log entry written **and** the test process itself doesn't crash (i.e.
  `catch_unwind` actually caught it)

## Resources

- [`std::panic::catch_unwind`](https://doc.rust-lang.org/std/panic/fn.catch_unwind.html)
- [`std::panic::UnwindSafe`](https://doc.rust-lang.org/std/panic/trait.UnwindSafe.html)
- [`anyhow` docs.rs](https://docs.rs/anyhow/latest/anyhow/) — `Context` trait for `.context("...")`
- [`std::process::exit`](https://doc.rust-lang.org/std/process/fn.exit.html)
- [The Rust Book ch. 13.1 — Closures](https://doc.rust-lang.org/book/ch13-01-closures.html)
