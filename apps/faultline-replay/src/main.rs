use anyhow::Result;
use clap::Parser;
use faultline_replay::load_incident;

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
    let path = args.incident.ok_or_else(|| {
        anyhow::anyhow!("--incident <path> required (normalized incident directory)")
    })?;
    let loaded = load_incident(&path)?;
    println!(
        "incident_id={} dataset={}/{} events={}",
        loaded.manifest.incident_id,
        loaded.manifest.dataset_id,
        loaded.manifest.dataset_version,
        loaded.envelopes.len()
    );
    for (signal, count) in &loaded.manifest.event_counts {
        println!("  {signal}: {count}");
    }
    Ok(())
}
