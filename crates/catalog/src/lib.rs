//! Incident catalog: manifest and labels schemas.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use faultline_common::FaultlineError;

pub mod incident;
pub mod labels;
pub mod manifest;

pub use incident::IncidentRef;
pub use labels::Labels;
pub use manifest::Manifest;

/// An incident directory found under a fixtures root.
#[derive(Debug, Clone, PartialEq)]
pub struct DiscoveredIncident {
    pub incident_id: String,
    pub dataset_id: String,
    pub dataset_version: String,
    pub path: PathBuf,
}

/// Walk the `<root>/<dataset>/<version>/<incident>` fixture layout, plus direct
/// `<root>/<incident>` children (reported as dataset "local", version "v1"),
/// returning every directory holding a manifest.json, sorted by incident id.
pub fn discover_incidents(root: &Path) -> Vec<DiscoveredIncident> {
    let mut out: Vec<DiscoveredIncident> = Vec::new();
    let dirs = |p: &Path| -> Vec<std::fs::DirEntry> {
        std::fs::read_dir(p)
            .map(|entries| entries.flatten().filter(|e| e.path().is_dir()).collect())
            .unwrap_or_default()
    };
    for dataset in dirs(root) {
        let dataset_id = dataset.file_name().to_string_lossy().into_owned();
        for version in dirs(&dataset.path()) {
            let dataset_version = version.file_name().to_string_lossy().into_owned();
            for entry in dirs(&version.path()) {
                let path = entry.path();
                if path.join("manifest.json").exists() {
                    out.push(DiscoveredIncident {
                        incident_id: entry.file_name().to_string_lossy().into_owned(),
                        dataset_id: dataset_id.clone(),
                        dataset_version: dataset_version.clone(),
                        path,
                    });
                }
            }
        }
    }
    for entry in dirs(root) {
        let path = entry.path();
        if path.join("manifest.json").exists() {
            let incident_id = entry.file_name().to_string_lossy().into_owned();
            if !out.iter().any(|i| i.incident_id == incident_id) {
                out.push(DiscoveredIncident {
                    incident_id,
                    dataset_id: "local".into(),
                    dataset_version: "v1".into(),
                    path,
                });
            }
        }
    }
    out.sort_by(|a, b| a.incident_id.cmp(&b.incident_id));
    out
}

/// Validate manifest.json and labels.json in an incident directory.
pub fn validate_incident_dir(dir: &Path) -> Result<(Manifest, Labels), FaultlineError> {
    let manifest = Manifest::load(&dir.join("manifest.json"))?;
    manifest.validate()?;
    let labels = Labels::load(&dir.join("labels.json"))?;
    labels.validate()?;
    Ok((manifest, labels))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileChecksum {
    pub path: String,
    pub sha256: String,
    pub rows: u64,
}
