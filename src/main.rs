use clap::Parser;
use foldtime::cli::{
    Cli,
    Commands::{Heartbeat, HookCommit, Init, Report, Schema},
};
fn main() {
    let cli = Cli::parse();
    match cli.command {
        Init { with_config } => {
            println!("init: with_config={with_config}");
        }
        Heartbeat { file, write } => {
            println!("heartbeat: file={file:?}, write={write}");
        }
        Report {
            project,
            since,
            until,
        } => {
            println!("report project={project:?}, since={since:?}, until={until:?}")
        }
        HookCommit => println!("hook-commit"),

        Schema => println!("hook-commit"),
    }
}
