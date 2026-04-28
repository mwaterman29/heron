use crate::logs;
use crate::schedule;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarSummary {
    pub status: String,
    pub timestamp: String,
    pub searches_run: u32,
    pub listings_scraped: u32,
    pub new_listings: u32,
    pub deals_found: u32,
    pub notifications_sent: u32,
    pub errors: Vec<String>,
    pub duration_ms: u64,
    /// LLM token totals across the whole run (pass-1 + pass-2). Default 0
    /// for compatibility with summaries from sidecars that pre-date this
    /// field. Used by the Settings cost estimate to compute per-run + daily
    /// dollar figures from real workload data instead of heuristics.
    #[serde(default)]
    pub tokens_input: u64,
    #[serde(default)]
    pub tokens_output: u64,
}

pub struct AppState {
    pub config_dir: std::path::PathBuf,
    pub sidecar_running: AtomicBool,
    pub last_summary: Mutex<Option<SidecarSummary>>,
    /// Human-readable description of what the sidecar is currently doing
    /// (e.g. "Scraping HiFi Shark (3/8)"). Set when an __HERON_ACTIVITY__
    /// line is parsed; cleared when the sidecar exits.
    pub current_activity: Mutex<Option<String>>,
}

impl AppState {
    pub fn new(config_dir: std::path::PathBuf) -> Self {
        let persisted = read_persisted_summary(&config_dir);
        Self {
            config_dir,
            sidecar_running: AtomicBool::new(false),
            last_summary: Mutex::new(persisted),
            current_activity: Mutex::new(None),
        }
    }
}

const SUMMARY_PREFIX: &str = "__DEAL_HUNTER_SUMMARY__";
const ACTIVITY_PREFIX: &str = "__HERON_ACTIVITY__";
const LAST_SUMMARY_FILE: &str = "last-summary.json";

/// Read the persisted last summary from disk so the Settings cost estimate
/// has real token data even on a fresh app launch (before any new run).
pub fn read_persisted_summary(config_dir: &std::path::Path) -> Option<SidecarSummary> {
    std::fs::read_to_string(config_dir.join(LAST_SUMMARY_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn write_persisted_summary(config_dir: &std::path::Path, summary: &SidecarSummary) {
    let path = config_dir.join(LAST_SUMMARY_FILE);
    if let Ok(content) = serde_json::to_string_pretty(summary) {
        let _ = std::fs::write(&path, content);
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RunMode {
    Full,
    Dry,
}

impl RunMode {
    fn as_arg(&self) -> &'static str {
        match self {
            RunMode::Full => "full",
            RunMode::Dry => "dry",
        }
    }
}

pub fn spawn(app: AppHandle, mode: RunMode) -> Result<(), String> {
    let state = app.state::<AppState>();

    if state.sidecar_running.load(Ordering::SeqCst) {
        return Err("Sidecar already running".into());
    }
    state.sidecar_running.store(true, Ordering::SeqCst);

    let config_dir = state.config_dir.to_string_lossy().to_string();

    let log_path = logs::current_log_path(&state.config_dir).map_err(|e| {
        state.sidecar_running.store(false, Ordering::SeqCst);
        format!("Failed to create log path: {}", e)
    })?;

    let sidecar_command = app
        .shell()
        .sidecar("heron-sidecar")
        .map_err(|e| {
            state.sidecar_running.store(false, Ordering::SeqCst);
            format!("Failed to find sidecar: {}", e)
        })?
        .args([
            "--config-dir",
            &config_dir,
            "--run-mode",
            mode.as_arg(),
        ]);

    // Mark "spawned" timestamp so the scheduler doesn't fire again until at
    // least the configured interval has passed since this run started.
    // This applies to both manual Run Now spawns and scheduled spawns.
    let now_ts = chrono::Local::now().timestamp_millis();
    if let Err(e) = schedule::write_last_fired(&state.config_dir, now_ts) {
        log::warn!("Failed to persist scheduler last_fired_at: {}", e);
    }

    let (mut rx, _child) = sidecar_command.spawn().map_err(|e| {
        state.sidecar_running.store(false, Ordering::SeqCst);
        format!("Failed to spawn sidecar: {}", e)
    })?;

    // Open log file for capture
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;
    let log_file = std::sync::Mutex::new(log_file);

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line).to_string();
                    let trimmed = text.trim_end();
                    if let Ok(mut f) = log_file.lock() {
                        let _ = writeln!(f, "{}", trimmed);
                    }
                    let _ = app_clone.emit("sidecar-log", trimmed.to_string());

                    if let Some(json) = trimmed.strip_prefix(SUMMARY_PREFIX) {
                        match serde_json::from_str::<SidecarSummary>(json.trim()) {
                            Ok(summary) => {
                                let state = app_clone.state::<AppState>();
                                *state.last_summary.lock().unwrap() = Some(summary.clone());
                                write_persisted_summary(&state.config_dir, &summary);
                                let _ = app_clone.emit("sidecar-summary", &summary);
                            }
                            Err(e) => log::warn!("Failed to parse summary JSON: {}", e),
                        }
                    } else if let Some(activity) = trimmed.strip_prefix(ACTIVITY_PREFIX) {
                        let activity_text = activity.trim().to_string();
                        let state = app_clone.state::<AppState>();
                        *state.current_activity.lock().unwrap() = Some(activity_text.clone());
                        let _ = app_clone.emit("sidecar-activity", activity_text);
                    }
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line).to_string();
                    let trimmed = text.trim_end();
                    if let Ok(mut f) = log_file.lock() {
                        let _ = writeln!(f, "[stderr] {}", trimmed);
                    }
                    let _ = app_clone.emit("sidecar-log", format!("[stderr] {}", trimmed));
                }
                CommandEvent::Terminated(payload) => {
                    let state = app_clone.state::<AppState>();
                    state.sidecar_running.store(false, Ordering::SeqCst);
                    *state.current_activity.lock().unwrap() = None;
                    let _ = app_clone.emit("sidecar-activity", String::new());
                    let _ = app_clone.emit("sidecar-finished", payload.code);
                }
                _ => {}
            }
        }
    });

    Ok(())
}
