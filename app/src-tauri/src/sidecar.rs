use serde::{Deserialize, Serialize};
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

pub fn spawn(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();

    if state.sidecar_running.load(Ordering::SeqCst) {
        return Err("Sidecar already running".into());
    }
    state.sidecar_running.store(true, Ordering::SeqCst);

    let config_dir = state.config_dir.to_string_lossy().to_string();

    let sidecar_command = app
        .shell()
        .sidecar("deal-hunter-sidecar")
        .map_err(|e| {
            state.sidecar_running.store(false, Ordering::SeqCst);
            format!("Failed to find sidecar: {}", e)
        })?
        .args(["--config-dir", &config_dir, "--run-mode", "full"]);

    let (mut rx, _child) = sidecar_command.spawn().map_err(|e| {
        state.sidecar_running.store(false, Ordering::SeqCst);
        format!("Failed to spawn sidecar: {}", e)
    })?;

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line).to_string();
                    log::info!("[sidecar] {}", text);
                    if let Some(json) = text.strip_prefix(SUMMARY_PREFIX) {
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
                    log::warn!("[sidecar stderr] {}", String::from_utf8_lossy(&line));
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
