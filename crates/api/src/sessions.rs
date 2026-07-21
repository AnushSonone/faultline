//! Investigation session placeholders (TA-009+).

#[derive(Debug, Clone)]
pub struct SessionId(pub String);

impl SessionId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
}
