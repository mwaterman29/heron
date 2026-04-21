use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleConfig {
    pub enabled: bool,
    /// Minutes between runs. Common: 15, 30, 60, 120, 360, 720, 1440.
    pub interval_minutes: u32,
    /// Optional: restrict runs to this local-time window (24h). Both None = all day.
    pub active_hour_start: Option<u32>,
    pub active_hour_end: Option<u32>,
}

impl Default for ScheduleConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_minutes: 360, // 6 hours
            active_hour_start: None,
            active_hour_end: None,
        }
    }
}

pub fn read(config_dir: &Path) -> ScheduleConfig {
    let path = config_dir.join("schedule.json");
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write(config_dir: &Path, cfg: &ScheduleConfig) -> std::io::Result<()> {
    let path = config_dir.join("schedule.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(cfg).map_err(std::io::Error::other)?;
    fs::write(&path, content)?;
    Ok(())
}

// ===== Last-fired persistence =====
//
// Tracks when the sidecar last ran so we can resume the schedule across app
// restarts. Without this, every fresh launch reset an in-memory `last_fired`
// to None and triggered a run within 90s — defeating the user's interval
// setting and causing the "runs too often when it's open" complaint.
//
// Both scheduled runs AND manual Run Now spawns update this value, so a
// manual run also "resets the clock" — the next scheduled run won't fire
// until the configured interval has elapsed since the manual one.

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SchedulerState {
    last_fired_at: i64,
}

pub fn read_last_fired(config_dir: &Path) -> Option<i64> {
    let path = config_dir.join("scheduler-state.json");
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<SchedulerState>(&s).ok())
        .map(|s| s.last_fired_at)
}

pub fn write_last_fired(config_dir: &Path, ts_millis: i64) -> std::io::Result<()> {
    let path = config_dir.join("scheduler-state.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let state = SchedulerState { last_fired_at: ts_millis };
    let content = serde_json::to_string_pretty(&state).map_err(std::io::Error::other)?;
    fs::write(&path, content)?;
    Ok(())
}

/// Compute the next N run timestamps (unix millis) from this config.
pub fn next_runs(cfg: &ScheduleConfig, count: usize) -> Vec<i64> {
    if !cfg.enabled || cfg.interval_minutes == 0 {
        return Vec::new();
    }
    use chrono::{Local, TimeZone, Timelike};
    let now = Local::now();
    let mut next = now + chrono::Duration::minutes(cfg.interval_minutes as i64);

    // Snap to active hours if set
    let mut out = Vec::new();
    for _ in 0..count {
        if let (Some(start), Some(end)) = (cfg.active_hour_start, cfg.active_hour_end) {
            while next.hour() < start || next.hour() >= end {
                let hours_to_add = if next.hour() >= end {
                    (24 - next.hour() + start) as i64
                } else {
                    (start - next.hour()) as i64
                };
                next = Local
                    .timestamp_millis_opt(next.timestamp_millis())
                    .unwrap()
                    + chrono::Duration::hours(hours_to_add);
            }
        }
        out.push(next.timestamp_millis());
        next = next + chrono::Duration::minutes(cfg.interval_minutes as i64);
    }
    out
}
