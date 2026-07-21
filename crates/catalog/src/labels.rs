use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use faultline_common::FaultlineError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Labels {
    #[serde(default)]
    pub incident_id: String,
    pub root_cause_services: Vec<String>,
    #[serde(default)]
    pub root_cause_indicators: Vec<String>,
    pub fault_type: String,
    pub fault_start_time_ns: i64,
    pub fault_end_time_ns: i64,
    #[serde(default)]
    pub expected_downstream_services: Vec<String>,
    #[serde(default)]
    pub notes: String,
}

impl Labels {
    pub fn load(path: &Path) -> Result<Self, FaultlineError> {
        let text = fs::read_to_string(path)
            .map_err(|e| FaultlineError::Io(format!("read {}: {e}", path.display())))?;
        serde_json::from_str(&text)
            .map_err(|e| FaultlineError::Validation(format!("labels parse: {e}")))
    }

    pub fn validate(&self) -> Result<(), FaultlineError> {
        if self.root_cause_services.is_empty() {
            return Err(FaultlineError::Validation(
                "labels.root_cause_services required".into(),
            ));
        }
        if self.fault_type.is_empty() {
            return Err(FaultlineError::Validation(
                "labels.fault_type required".into(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_labels() {
        let l = Labels {
            incident_id: "inc-1".into(),
            root_cause_services: vec!["recommendationservice".into()],
            root_cause_indicators: vec!["mem".into()],
            fault_type: "mem".into(),
            fault_start_time_ns: 5,
            fault_end_time_ns: 9,
            expected_downstream_services: vec!["checkoutservice".into()],
            notes: "synthetic".into(),
        };
        l.validate().unwrap();
    }
}
