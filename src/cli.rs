use clap::{Parser, Subcommand};

#[derive(Parser)]
pub struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    Init {
        with_config: bool,
    },
    Heartbeat {
        file: Option<String>,
        write: bool,
    },
    Report {
        project: Option<String>,
        since: Option<String>,
        until: Option<String>,
    },

    HookCommit,
    Schema,
}
