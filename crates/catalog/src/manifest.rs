use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use faultline_common::FaultlineError;

use crate::FileChecksum;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Manifest {
    pub schema_version: u16,
    pub dataset_id: String,
    pub dataset_version: String,
    pub incident_id: String,
    pub system: String,
    pub start_time_ns: i64,
    pub end_time_ns: i64,
    pub signals: Vec<String>,
    pub event_counts: std::collections::BTreeMap<String, u64>,
    pub files: Vec<FileChecksum>,
}

impl Manifest {
    pub fn load(path: &Path) -> Result<Self, FaultlineError> {
        let text = fs::read_to_string(path)
            .map_err(|e| FaultlineError::Io(format!("read {}: {e}", path.display())))?;
        serde_json::from_str(&text)
            .map_err(|e| FaultlineError::Validation(format!("manifest parse: {e}")))
    }

    pub fn validate(&self) -> Result<(), FaultlineError> {
        if self.incident_id.is_empty() {
            return Err(FaultlineError::Validation(
                "manifest.incident_id required".into(),
            ));
        }
        if self.start_time_ns > self.end_time_ns {
            return Err(FaultlineError::Validation(
                "manifest start_time_ns > end_time_ns".into(),
            ));
        }
        if self.files.is_empty() {
            return Err(FaultlineError::Validation(
                "manifest.files must not be empty".into(),
            ));
        }
        for f in &self.files {
            if f.sha256.len() != 64 {
                return Err(FaultlineError::Validation(format!(
                    "checksum for {} must be sha256 hex",
                    f.path
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn sample() -> Manifest {
        Manifest {
            schema_version: 1,
            dataset_id: "demo".into(),
            dataset_version: "v1".into(),
            incident_id: "inc-1".into(),
            system: "online-boutique".into(),
            start_time_ns: 0,
            end_time_ns: 10,
            signals: vec!["metrics".into(), "spans".into()],
            event_counts: BTreeMap::from([("metrics".into(), 1), ("spans".into(), 1)]),
            files: vec![FileChecksum {
                path: "metrics/part-00000.parquet".into(),
                sha256: "a".repeat(64),
                rows: 1,
            }],
        }
    }

    #[test]
    fn valid_manifest() {
        sample().validate().unwrap();
    }

    #[test]
    fn rejects_bad_checksum() {
        let mut m = sample();
        m.files[0].sha256 = "nope".into();
        assert!(m.validate().is_err());
    }
}
