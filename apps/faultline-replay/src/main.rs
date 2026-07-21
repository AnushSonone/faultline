use anyhow::Result;
use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "faultline-replay", about = "Deterministic incident replay")]
struct Args {
    /// Path to normalized incident directory
    #[arg(long)]
    incident: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();
    println!(
        "faultline-replay scaffold ready (incident={:?})",
        args.incident
    );
    println!("crate={}", faultline_replay::crate_name());
    Ok(())
}
