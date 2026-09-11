use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};
use faultline_cli::evaluate::{
    discover_incidents_in, evaluate, render_markdown, EvaluateOptions, DEFAULT_DETECTOR,
};

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
    /// Validate an incident directory's manifest.json and labels.json (TA-003)
    Validate {
        #[arg(long)]
        path: String,
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
        /// Exact incident ids (comma-separated). Overrides --prefix discovery;
        /// every id must exist.
        #[arg(long, value_delimiter = ',')]
        incidents: Vec<String>,
        /// Detector preset: legacy, v2, v2-no-floor, v2-no-persistence,
        /// v2-window32. Only `legacy` exists in this build; once the detector
        /// rewrite merges the default becomes v2.
        #[arg(long, default_value = DEFAULT_DETECTOR)]
        detector: String,
        /// Write the full JSON report here.
        #[arg(long)]
        json: Option<PathBuf>,
        /// Write the markdown report here.
        #[arg(long)]
        markdown: Option<PathBuf>,
    },
    /// Replay stability of the live root-cause projection: step a cursor
    /// through each incident and report ranking churn, onset flicker, timing.
    ReplayStability {
        #[arg(long, default_value = "datasets/fixtures")]
        fixtures: PathBuf,
        /// Dataset subdirectory under fixtures (e.g. rcaeval-re2-ob/v2).
        #[arg(long)]
        dataset: String,
        /// Incident ids (comma-separated).
        #[arg(long, value_delimiter = ',', required = true)]
        incidents: Vec<String>,
        /// Detector preset; must equal this build's FeatureConfig::default().
        #[arg(long, default_value = DEFAULT_DETECTOR)]
        detector: String,
        /// Cursor step in seconds.
        #[arg(long, default_value_t = 30)]
        step_s: u64,
        /// build_root_causes repetitions timed at the final cursor.
        #[arg(long, default_value_t = 11)]
        timing_repeats: usize,
        #[arg(long)]
        json: Option<PathBuf>,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Version => {
            println!("faultline-cli {}", env!("CARGO_PKG_VERSION"));
        }
        Commands::Validate { path } => {
            let (manifest, labels) =
                faultline_catalog::validate_incident_dir(std::path::Path::new(&path))
                    .map_err(|e| anyhow::anyhow!("{path}: {e}"))?;
            println!(
                "valid: incident_id={} system={} fault_type={}",
                manifest.incident_id, manifest.system, labels.fault_type
            );
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
            incidents,
            detector,
            json,
            markdown,
        } => {
            let dirs = if incidents.is_empty() {
                discover_incidents_in(&fixtures, &dataset, &prefix)
            } else {
                let mut dirs = Vec::new();
                for id in &incidents {
                    let dir = fixtures.join(&dataset).join(id);
                    if !dir.join("manifest.json").exists() {
                        anyhow::bail!("incident not found: {}", dir.display());
                    }
                    dirs.push(dir);
                }
                dirs.sort();
                dirs
            };
            if dirs.is_empty() {
                anyhow::bail!(
                    "no incidents matching prefix '{prefix}' under {}",
                    fixtures.join(&dataset).display()
                );
            }
            let label = if dataset.starts_with("rcaeval") {
                format!("{dataset} (REAL RCAEval data)")
            } else {
                format!("{dataset} (synthetic; NOT RCAEval)")
            };
            let opts = EvaluateOptions {
                detector,
                dataset_path: dataset,
                dataset_label: label,
            };
            let report = evaluate(&dirs, &opts).map_err(|e| anyhow::anyhow!(e))?;
            let md = render_markdown(&report);
            println!("{md}");
            if let Some(path) = json {
                std::fs::write(&path, serde_json::to_string_pretty(&report)? + "\n")?;
                eprintln!("json report: {}", path.display());
            }
            if let Some(path) = markdown {
                std::fs::write(&path, md)?;
                eprintln!("markdown report: {}", path.display());
            }
        }
        Commands::ReplayStability {
            fixtures,
            dataset,
            incidents,
            detector,
            step_s,
            timing_repeats,
            json,
        } => {
            let report = faultline_cli::replay_stability::replay_stability(
                &fixtures,
                &dataset,
                &incidents,
                &detector,
                step_s,
                timing_repeats,
            )
            .map_err(|e| anyhow::anyhow!(e))?;
            let text = serde_json::to_string_pretty(&report)?;
            if let Some(path) = json {
                std::fs::write(&path, text + "\n")?;
                eprintln!("json report: {}", path.display());
            } else {
                println!("{text}");
            }
        }
    }
    Ok(())
}
