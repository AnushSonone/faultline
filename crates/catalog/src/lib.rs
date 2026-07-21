//! Incident catalog: manifest and labels schemas.

use serde::{Deserialize, Serialize};
use std::path::Path;

use faultline_common::FaultlineError;

pub mod incident;
pub mod labels;
pub mod manifest;

pub use incident::IncidentRef;
pub use labels::Labels;
pub use manifest::Manifest;

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
