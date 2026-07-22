//! Deterministic virtual event-time clock for incident replay.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Playback state of the replay clock.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClockState {
    Stopped,
    Playing,
    Paused,
}

/// Supported replay speed multipliers (spec §14).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplaySpeed {
    #[serde(rename = "0.5")]
    X0_5,
    #[default]
    #[serde(rename = "1")]
    X1,
    #[serde(rename = "2")]
    X2,
    #[serde(rename = "5")]
    X5,
    #[serde(rename = "10")]
    X10,
    #[serde(rename = "50")]
    X50,
    #[serde(rename = "max")]
    Max,
}

impl ReplaySpeed {
    /// Event-time multiplier relative to wall time. `None` means max-throughput.
    pub fn multiplier(self) -> Option<f64> {
        match self {
            Self::X0_5 => Some(0.5),
            Self::X1 => Some(1.0),
            Self::X2 => Some(2.0),
            Self::X5 => Some(5.0),
            Self::X10 => Some(10.0),
            Self::X50 => Some(50.0),
            Self::Max => None,
        }
    }

    /// Parse common speed tokens (`"0.5"`, `"1"`, `"max"`, …).
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "0.5" | "0.5x" | "half" => Some(Self::X0_5),
            "1" | "1x" | "1.0" => Some(Self::X1),
            "2" | "2x" | "2.0" => Some(Self::X2),
            "5" | "5x" | "5.0" => Some(Self::X5),
            "10" | "10x" | "10.0" => Some(Self::X10),
            "50" | "50x" | "50.0" => Some(Self::X50),
            "max" | "max-throughput" => Some(Self::Max),
            _ => None,
        }
    }
}

/// Virtual event-time clock. Wall pacing is applied only while [`ClockState::Playing`].
#[derive(Clone, Debug)]
pub struct ReplayClock {
    state: ClockState,
    speed: ReplaySpeed,
    start_ns: i64,
    end_ns: i64,
    current_ns: i64,
}

impl ReplayClock {
    pub fn new(start_ns: i64, end_ns: i64) -> Self {
        let start_ns = start_ns.min(end_ns);
        let end_ns = end_ns.max(start_ns);
        Self {
            state: ClockState::Stopped,
            speed: ReplaySpeed::default(),
            start_ns,
            end_ns,
            current_ns: start_ns,
        }
    }

    pub fn state(&self) -> ClockState {
        self.state
    }

    pub fn speed(&self) -> ReplaySpeed {
        self.speed
    }

    pub fn start_ns(&self) -> i64 {
        self.start_ns
    }

    pub fn end_ns(&self) -> i64 {
        self.end_ns
    }

    pub fn current_event_time_ns(&self) -> i64 {
        self.current_ns
    }

    pub fn play(&mut self) {
        if self.state == ClockState::Stopped {
            self.current_ns = self.start_ns;
        }
        self.state = ClockState::Playing;
    }

    pub fn pause(&mut self) {
        if self.state == ClockState::Playing {
            self.state = ClockState::Paused;
        }
    }

    pub fn resume(&mut self) {
        if self.state == ClockState::Paused {
            self.state = ClockState::Playing;
        }
    }

    pub fn stop(&mut self) {
        self.state = ClockState::Stopped;
        self.current_ns = self.start_ns;
    }

    pub fn reset(&mut self) {
        self.state = ClockState::Stopped;
        self.speed = ReplaySpeed::default();
        self.current_ns = self.start_ns;
    }

    /// Seek to an absolute event time (clamped to `[start, end]`). Does not change state.
    pub fn seek(&mut self, event_time_ns: i64) {
        self.current_ns = event_time_ns.clamp(self.start_ns, self.end_ns);
    }

    pub fn set_speed(&mut self, speed: ReplaySpeed) {
        self.speed = speed;
    }

    /// Deterministically advance virtual event time by `delta_ns` while playing.
    /// Used by max-throughput ticks and unit tests.
    pub fn advance_event_time(&mut self, delta_ns: i64) -> i64 {
        if self.state != ClockState::Playing {
            return self.current_ns;
        }
        let next = self.current_ns.saturating_add(delta_ns.max(0));
        self.current_ns = next.min(self.end_ns);
        if self.current_ns >= self.end_ns {
            self.state = ClockState::Stopped;
        }
        self.current_ns
    }

    /// Map wall elapsed time through the current speed into event time (no-op if paused/stopped).
    pub fn tick_wall(&mut self, wall_elapsed: Duration) -> i64 {
        if self.state != ClockState::Playing {
            return self.current_ns;
        }
        match self.speed.multiplier() {
            None => {
                // Max: jump to end in one tick unless caller uses advance_event_time.
                self.current_ns = self.end_ns;
                self.state = ClockState::Stopped;
                self.current_ns
            }
            Some(mult) => {
                let wall_ns = wall_elapsed.as_nanos() as f64;
                let delta = (wall_ns * mult) as i64;
                self.advance_event_time(delta)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seek_is_deterministic_and_clamped() {
        let mut clock = ReplayClock::new(100, 200);
        clock.seek(150);
        assert_eq!(clock.current_event_time_ns(), 150);
        clock.seek(50);
        assert_eq!(clock.current_event_time_ns(), 100);
        clock.seek(999);
        assert_eq!(clock.current_event_time_ns(), 200);
    }

    #[test]
    fn seek_then_advance_replays_identical_prefixes() {
        let mut a = ReplayClock::new(0, 1_000);
        let mut b = ReplayClock::new(0, 1_000);

        a.play();
        let mut prefix_a = Vec::new();
        for _ in 0..5 {
            prefix_a.push(a.advance_event_time(100));
        }

        b.play();
        b.seek(300);
        // After seek to 300, continuing should match a's values from index 2 onward.
        assert_eq!(b.current_event_time_ns(), 300);
        let mut prefix_b = vec![300];
        for _ in 0..2 {
            prefix_b.push(b.advance_event_time(100));
        }
        assert_eq!(&prefix_a[2..], &prefix_b[..]);
    }

    #[test]
    fn pause_blocks_advance() {
        let mut clock = ReplayClock::new(0, 1000);
        clock.play();
        clock.advance_event_time(100);
        clock.pause();
        let paused_at = clock.current_event_time_ns();
        clock.advance_event_time(500);
        assert_eq!(clock.current_event_time_ns(), paused_at);
        clock.resume();
        clock.advance_event_time(50);
        assert_eq!(clock.current_event_time_ns(), paused_at + 50);
    }

    #[test]
    fn reset_restores_defaults() {
        let mut clock = ReplayClock::new(10, 90);
        clock.play();
        clock.set_speed(ReplaySpeed::X10);
        clock.advance_event_time(20);
        clock.reset();
        assert_eq!(clock.state(), ClockState::Stopped);
        assert_eq!(clock.speed(), ReplaySpeed::X1);
        assert_eq!(clock.current_event_time_ns(), 10);
    }
}
