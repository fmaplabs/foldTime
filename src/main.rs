use clap::Parser;
use foldtime::cli::{
    Cli,
    Commands::{Heartbeat, HookCommit, Init, Report, Schema},
};
use foldtime::commands;

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Init { with_config } => commands::init::run(with_config),
        // heartbeat and hook-commit run silently: they always return () and
        // exit 0 — failures land in ~/.foldtime/error.log instead.
        Heartbeat { file, write } => {
            commands::heartbeat::run(file, write);
            Ok(())
        }
        HookCommit => {
            commands::hook_commit::run();
            Ok(())
        }
        Report {
            project,
            since,
            until,
            idle_threshold_minutes,
        } => commands::report::run(project, since, until, idle_threshold_minutes),
        Schema => commands::schema::run(),
    }
}
