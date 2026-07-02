# foldTime Learning Stages

Task + resource reference for building the foldTime core CLI, one Rust concept
at a time. See `docs/foldTime.md` for the original requirements and the
architecture/collaboration-model discussion for the full rationale behind the
ordering below.

**Collaboration model**: you write all the code. Before each stage, concepts
get primed in conversation (with the doc links collected here); after you
write it, it gets reviewed — correctness, idioms, borrow-checker issues — not
rewritten for you.

**How to use these files**: each stage file is a standalone checklist you can
work through independently of the chat history. Check items off as you go;
the "Resources" links are there for when a task doesn't make sense yet.

| # | Stage | Status |
|---|-------|--------|
| 1 | [Scaffold](01-scaffold.md) | In progress |
| 2 | [sessions.rs — pure session-collapsing algorithm](02-sessions.md) | Not started |
| 3 | [paths.rs — filesystem locations](03-paths.md) | Not started |
| 4 | [db.rs — SQLite storage](04-db.md) | Not started |
| 5 | [git.rs — shelling out to git](05-git.md) | Not started |
| 6 | [config.rs — .foldtime.json](06-config.md) | Not started |
| 7 | [project.rs — identity resolution](07-project.md) | Not started |
| 8 | [errors.rs — never fail loudly](08-errors.md) | Not started |
| 9 | [cli.rs + commands/ — real implementations](09-commands.md) | Not started |
| 10 | [integration_init_hook.rs — end-to-end test](10-integration-test.md) | Not started |
| 11 | [Polish](11-polish.md) | Not started |

## Sequencing note

This order is **not** build-dependency order — it's ordered for gradual
concept introduction: pure logic (no I/O) first, then increasingly risky
integration points (filesystem, SQLite, subprocesses, panics), and assembly
last. Stage 9 is where everything gets wired together, which is why it comes
so late despite `cli.rs` itself starting in Stage 1.
