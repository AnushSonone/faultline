use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};
use faultline_cli::evaluate::{discover_incidents_in, evaluate_suite_labeled, render_markdown};

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
    /// Engine benchmark suite (TA-049): row baseline vs Arrow batch sizes.
    BenchEngine {
        #[arg(long, default_value_t = 200_000)]
        rows: usize,
        #[arg(long, default_value_t = 5)]
        runs: usize,
        #[arg(long)]
        json: Option<PathBuf>,
    },
    /// Checkpoint/recovery benchmark (TA-050).
    BenchRecovery {
        #[arg(long, default_value = "datasets/fixtures/synthetic-ob/v1/rec-mem-001")]
        fixture: PathBuf,
        #[arg(long, default_value_t = 20)]
        iterations: usize,
        #[arg(long)]
        json: Option<PathBuf>,
    },
    /// RCA evaluation suite (TA-048): blind ranking vs labels, ablations.
    Evaluate {
        /// Fixtures root (contains synthetic-ob/v1/...).
        #[arg(long, default_value = "datasets/fixtures")]
        fixtures: PathBuf,
        /// Incident id prefix to evaluate.
        #[arg(long, default_value = "eval-")]
        prefix: String,
        /// Dataset subdirectory under fixtures (e.g. rcaeval-re2-ob/v2).
        #[arg(long, default_value = "synthetic-ob/v1")]
        dataset: String,
        /// Write the full JSON report here.
        #[arg(long)]
        json: Option<PathBuf>,
        /// Write the markdown report here.
        #[arg(long)]
        markdown: Option<PathBuf>,
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
        Commands::BenchEngine { rows, runs, json } => {
            let report = faultline_cli::bench::bench_engine(rows, runs);
            println!("{}", serde_json::to_string_pretty(&report)?);
            if let Some(path) = json {
                std::fs::write(&path, serde_json::to_string_pretty(&report)?)?;
            }
        }
        Commands::BenchRecovery {
            fixture,
            iterations,
            json,
        } => {
            let report = faultline_cli::bench::bench_recovery(&fixture, iterations)
                .map_err(|e| anyhow::anyhow!(e))?;
            println!("{}", serde_json::to_string_pretty(&report)?);
            if let Some(path) = json {
                std::fs::write(&path, serde_json::to_string_pretty(&report)?)?;
            }
        }
        Commands::Evaluate {
            fixtures,
            prefix,
            dataset,
            json,
            markdown,
        } => {
            let dirs = discover_incidents_in(&fixtures, &dataset, &prefix);
            if dirs.is_empty() {
                anyhow::bail!(
                    "no incidents matching prefix '{prefix}' under {}",
                    fixtures.display()
                );
            }
            let label = if dataset.starts_with("rcaeval") {
                format!("{dataset} (REAL RCAEval data)")
            } else {
                format!("{dataset} (synthetic; NOT RCAEval)")
            };
            let report = evaluate_suite_labeled(&dirs, &label).map_err(|e| anyhow::anyhow!(e))?;
            let md = render_markdown(&report);
            println!("{md}");
            if let Some(path) = json {
                std::fs::write(&path, serde_json::to_string_pretty(&report)?)?;
                eprintln!("json report: {}", path.display());
            }
            if let Some(path) = markdown {
                std::fs::write(&path, md)?;
                eprintln!("markdown report: {}", path.display());
            }
        }
    }
    Ok(())
}
