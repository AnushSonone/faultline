#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct IncidentRef {
    pub dataset_id: String,
    pub dataset_version: String,
    pub incident_id: String,
}
