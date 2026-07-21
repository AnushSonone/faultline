use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(name = "faultline-cli")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Print version
    Version,
    /// Validate a manifest (TA-003+)
    Validate {
        #[arg(long)]
        path: Option<String>,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Version => {
            println!("faultline-cli {}", env!("CARGO_PKG_VERSION"));
        }
        Commands::Validate { path } => {
            println!("validate stub path={path:?} (TA-003)");
        }
    }
    Ok(())
}
