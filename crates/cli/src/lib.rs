//! Faultline CLI library: evaluation and benchmark commands (TA-048..050).

pub mod bench;
pub mod evaluate;

pub fn crate_name() -> &'static str {
    "faultline-cli"
}
