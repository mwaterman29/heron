use crate::schedule;
use crate::sidecar::{self, AppState, RunMode};
use chrono::{Local, Timelike};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Start the recurring scheduler. Wakes up every 60s, checks whether the
/// configured interval has elapsed since the last run, and fires the sidecar
/// if the active-hours window permits.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_fired: Option<i64> = None;
        // Small delay on startup so the UI settles before we potentially kick off a run
        tokio::time::sleep(Duration::from_secs(30)).await;

        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;

            let state = app.state::<AppState>();
            let cfg = schedule::read(&state.config_dir);

            if !cfg.enabled || cfg.interval_minutes == 0 {
                continue;
            }

            // Respect active-hour window if set
            if let (Some(start), Some(end)) = (cfg.active_hour_start, cfg.active_hour_end) {
                let hour = Local::now().hour();
                let in_window = if start <= end {
                    hour >= start && hour < end
                } else {
                    // Wrap-around (e.g. 22..06)
                    hour >= start || hour < end
                };
                if !in_window {
                    continue;
                }
            }

            let now = chrono::Local::now().timestamp_millis();
            let interval_ms = cfg.interval_minutes as i64 * 60_000;
            let due = match last_fired {
                Some(ts) => (now - ts) >= interval_ms,
                None => true,
            };

            if !due {
                continue;
            }

            if state.sidecar_running.load(std::sync::atomic::Ordering::SeqCst) {
                log::info!("Scheduled run skipped: sidecar already running");
                continue;
            }

            log::info!("Scheduler firing sidecar");
            match sidecar::spawn(app.clone(), RunMode::Full) {
                Ok(()) => {
                    last_fired = Some(now);
                }
                Err(e) => {
                    log::warn!("Scheduled spawn failed: {}", e);
                }
            }
        }
    });
}
