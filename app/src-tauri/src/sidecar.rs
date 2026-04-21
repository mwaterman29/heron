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
}

pub struct AppState {
    pub config_dir: std::path::PathBuf,
    pub sidecar_running: AtomicBool,
    pub last_summary: Mutex<Option<SidecarSummary>>,
}

impl AppState {
    pub fn new(config_dir: std::path::PathBuf) -> Self {
        Self {
            config_dir,
            sidecar_running: AtomicBool::new(false),
            last_summary: Mutex::new(None),
        }
    }
}

const SUMMARY_PREFIX: &str = "__DEAL_HUNTER_SUMMARY__";

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
                                let _ = app_clone.emit("sidecar-summary", &summary);
                            }
                            Err(e) => log::warn!("Failed to parse summary JSON: {}", e),
                        }
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
                    let _ = app_clone.emit("sidecar-finished", payload.code);
                }
                _ => {}
            }
        }
    });

    Ok(())
}
