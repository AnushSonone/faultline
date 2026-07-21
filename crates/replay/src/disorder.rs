//! Seeded disorder injector (delay / duplicate / drop).

use serde::{Deserialize, Serialize};

/// Configuration for adversarial replay disorder (spec §14).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DisorderConfig {
    pub seed: u64,
    pub max_delay_ms: u64,
    pub late_event_probability: f64,
    pub duplicate_probability: f64,
    pub drop_probability: f64,
    pub burst_size: usize,
    pub burst_interval_ms: u64,
}

impl Default for DisorderConfig {
    fn default() -> Self {
        Self {
            seed: 0,
            max_delay_ms: 0,
            late_event_probability: 0.0,
            duplicate_probability: 0.0,
            drop_probability: 0.0,
            burst_size: 0,
            burst_interval_ms: 0,
        }
    }
}

/// Decision applied to a single outgoing event.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DisorderAction {
    Emit { delay_ms: u64 },
    Duplicate { delay_ms: u64 },
    Drop,
}

/// Deterministic PRNG-backed injector. Same seed → same action sequence.
#[derive(Clone, Debug)]
pub struct DisorderInjector {
    config: DisorderConfig,
    state: u64,
}

impl DisorderInjector {
    pub fn new(config: DisorderConfig) -> Self {
        let state = config.seed;
        Self { config, state }
    }

    pub fn config(&self) -> &DisorderConfig {
        &self.config
    }

    /// Next action for an event. Pure function of seed + call order.
    pub fn next_action(&mut self) -> DisorderAction {
        if self.roll(self.config.drop_probability) {
            return DisorderAction::Drop;
        }
        let delay_ms = if self.config.max_delay_ms == 0 {
            0
        } else if self.roll(self.config.late_event_probability) {
            self.bounded_u64(self.config.max_delay_ms.saturating_add(1))
        } else {
            0
        };
        if self.roll(self.config.duplicate_probability) {
            DisorderAction::Duplicate { delay_ms }
        } else {
            DisorderAction::Emit { delay_ms }
        }
    }

    fn roll(&mut self, p: f64) -> bool {
        if p <= 0.0 {
            return false;
        }
        if p >= 1.0 {
            return true;
        }
        let unit = (self.next_u64() as f64) / ((u64::MAX as f64) + 1.0);
        unit < p
    }

    fn bounded_u64(&mut self, exclusive_max: u64) -> u64 {
        if exclusive_max == 0 {
            return 0;
        }
        self.next_u64() % exclusive_max
    }

    /// xorshift64*
    fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        if x == 0 {
            x = 0x9E37_79B9_7F4A_7C15;
        }
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_sequence() {
        let cfg = DisorderConfig {
            seed: 42,
            max_delay_ms: 100,
            late_event_probability: 0.5,
            duplicate_probability: 0.3,
            drop_probability: 0.1,
            burst_size: 0,
            burst_interval_ms: 0,
        };
        let mut a = DisorderInjector::new(cfg.clone());
        let mut b = DisorderInjector::new(cfg);
        let seq_a: Vec<_> = (0..64).map(|_| a.next_action()).collect();
        let seq_b: Vec<_> = (0..64).map(|_| b.next_action()).collect();
        assert_eq!(seq_a, seq_b);
    }

    #[test]
    fn zero_probs_always_emit() {
        let mut inj = DisorderInjector::new(DisorderConfig::default());
        for _ in 0..32 {
            assert_eq!(inj.next_action(), DisorderAction::Emit { delay_ms: 0 });
        }
    }
}
