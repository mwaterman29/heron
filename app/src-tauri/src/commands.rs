use crate::sidecar::{self, AppState, SidecarSummary};
use serde::Serialize;
use std::fs;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct Status {
    pub running: bool,
    pub last_summary: Option<SidecarSummary>,
}

#[tauri::command]
pub fn read_config(app: AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();
    let path = state.config_dir.join("config/price-reference.yaml");
    fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))
}

#[tauri::command]
pub fn write_config(app: AppHandle, content: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let path = state.config_dir.join("config/price-reference.yaml");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
    }
    fs::write(&path, content).map_err(|e| format!("Failed to write config: {}", e))
}

#[tauri::command]
pub fn run_now(app: AppHandle) -> Result<(), String> {
    sidecar::spawn(app)
}

#[tauri::command]
pub fn get_status(app: AppHandle) -> Status {
    let state = app.state::<AppState>();
    let running = state.sidecar_running.load(Ordering::SeqCst);
    let last_summary = state.last_summary.lock().unwrap().clone();
    Status { running, last_summary }
}

#[tauri::command]
pub fn get_config_dir(app: AppHandle) -> String {
    let state = app.state::<AppState>();
    state.config_dir.to_string_lossy().to_string()
}
