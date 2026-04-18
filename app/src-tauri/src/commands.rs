use crate::db::{self, DealRow, HistoryFilter, OverviewStats, SourceStat};
use crate::logs::{self, LogFile};
use crate::schedule::{self, ScheduleConfig};
use crate::secrets::{self, SecretEntry};
use crate::sidecar::{self, AppState, RunMode, SidecarSummary};
use serde::Serialize;
use std::fs;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct Status {
    pub running: bool,
    pub last_summary: Option<SidecarSummary>,
}

// ===== Config =====

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
pub fn get_config_dir(app: AppHandle) -> String {
    let state = app.state::<AppState>();
    state.config_dir.to_string_lossy().to_string()
}

// ===== Sidecar =====

#[tauri::command]
pub fn run_now(app: AppHandle, dry: Option<bool>) -> Result<(), String> {
    let mode = if dry.unwrap_or(false) {
        RunMode::Dry
    } else {
        RunMode::Full
    };
    sidecar::spawn(app, mode)
}

#[tauri::command]
pub fn get_status(app: AppHandle) -> Status {
    let state = app.state::<AppState>();
    let running = state.sidecar_running.load(Ordering::SeqCst);
    let last_summary = state.last_summary.lock().unwrap().clone();
    Status { running, last_summary }
}

// ===== Secrets (.env) =====

#[tauri::command]
pub fn read_secrets(app: AppHandle, reveal: Option<bool>) -> Result<Vec<SecretEntry>, String> {
    let state = app.state::<AppState>();
    secrets::read(&state.config_dir, reveal.unwrap_or(false)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_secrets(app: AppHandle, entries: Vec<SecretEntry>) -> Result<(), String> {
    let state = app.state::<AppState>();
    secrets::write(&state.config_dir, entries).map_err(|e| e.to_string())
}

// ===== Schedule =====

#[tauri::command]
pub fn get_schedule(app: AppHandle) -> ScheduleConfig {
    let state = app.state::<AppState>();
    schedule::read(&state.config_dir)
}

#[tauri::command]
pub fn set_schedule(app: AppHandle, config: ScheduleConfig) -> Result<(), String> {
    let state = app.state::<AppState>();
    schedule::write(&state.config_dir, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_next_runs(app: AppHandle, count: usize) -> Vec<i64> {
    let state = app.state::<AppState>();
    let cfg = schedule::read(&state.config_dir);
    schedule::next_runs(&cfg, count)
}

// ===== History / Deals =====

#[tauri::command]
pub fn get_recent_deals(app: AppHandle, limit: Option<u32>) -> Result<Vec<DealRow>, String> {
    let state = app.state::<AppState>();
    db::recent_deals(&state.config_dir, limit.unwrap_or(10)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_queue(app: AppHandle) -> Result<Vec<DealRow>, String> {
    let state = app.state::<AppState>();
    db::queue(&state.config_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_listing_state(app: AppHandle, id: String, state: String) -> Result<(), String> {
    let app_state = app.state::<AppState>();
    db::set_listing_state(&app_state.config_dir, &id, &state).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_history(app: AppHandle, filter: Option<HistoryFilter>) -> Result<Vec<DealRow>, String> {
    let state = app.state::<AppState>();
    db::history(&state.config_dir, filter.unwrap_or_default()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_source_stats(app: AppHandle) -> Result<Vec<SourceStat>, String> {
    let state = app.state::<AppState>();
    db::source_stats(&state.config_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_overview(app: AppHandle) -> Result<OverviewStats, String> {
    let state = app.state::<AppState>();
    db::overview(&state.config_dir).map_err(|e| e.to_string())
}

// ===== Logs =====

#[tauri::command]
pub fn list_logs(app: AppHandle) -> Result<Vec<LogFile>, String> {
    let state = app.state::<AppState>();
    logs::list(&state.config_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tail_log(app: AppHandle, name: Option<String>, max_lines: Option<usize>) -> Result<String, String> {
    let state = app.state::<AppState>();
    logs::tail(&state.config_dir, name, max_lines.unwrap_or(500)).map_err(|e| e.to_string())
}

// ===== Open URL =====

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    // Cross-platform open: use `start` on Windows, `open` on macOS, `xdg-open` on Linux
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();

    result.map(|_| ()).map_err(|e| e.to_string())
}

// ===== Data management =====

/// Export current config + secrets template to a timestamped backup file.
/// Returns the absolute path of the exported file.
#[tauri::command]
pub fn export_backup(app: AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();
    let ts = chrono::Local::now().format("%Y-%m-%d_%H%M%S");
    let backup_dir = state.config_dir.join("backups");
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    let dest = backup_dir.join(format!("config-{}.yaml", ts));

    let src = state.config_dir.join("config/price-reference.yaml");
    if !src.exists() {
        return Err(format!("No config to export at {}", src.display()));
    }
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().to_string())
}

/// Delete all rows from seen_items (and price_history). Non-recoverable.
/// Returns the number of rows deleted.
#[tauri::command]
pub fn wipe_database(app: AppHandle) -> Result<u64, String> {
    let state = app.state::<AppState>();
    let db_path = state.config_dir.join("data/seen_items.db");
    if !db_path.exists() {
        return Ok(0);
    }
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM seen_items", [], |r| r.get(0))
        .unwrap_or(0);
    // Delete children first (FK), then parent
    conn.execute("DELETE FROM price_history", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM seen_items", [])
        .map_err(|e| e.to_string())?;
    conn.execute("VACUUM", []).map_err(|e| e.to_string())?;
    Ok(count as u64)
}
