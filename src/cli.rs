use clap::{Parser, Subcommand};

#[derive(Parser)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    Init {
        #[arg(long)]
        with_config: bool,
    },
    Heartbeat {
        #[arg(long)]
        file: Option<String>,

        #[arg(long)]
        write: bool,
    },
    Report {
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        since: Option<String>,
        #[arg(long)]
        until: Option<String>,
        #[arg(long)]
        idle_threshold_minutes: Option<u32>,
    },

    HookCommit,
    Schema,

    Login,
    Logout,
    Sync {
        /// Push local heartbeats without pulling other machines' rows.
        #[arg(long)]
        push_only: bool,
    },
}
