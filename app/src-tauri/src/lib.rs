mod commands;
mod db;
mod generator;
mod logs;
mod schedule;
mod scheduler;
mod secrets;
mod sidecar;
mod tray;
mod updater;

use sidecar::AppState;
use tauri::Manager;

/// Embedded starter config written on first launch when the user has no
/// existing price-reference.yaml. Empty `references` list — the user adds
/// targets via the Targets panel's "Generate from description" flow or by
/// editing the file directly. Without this, loadConfig() in the sidecar
/// would throw "Missing config/price-reference.yaml" on fresh installs.
const STARTER_PRICE_REFERENCE: &str = r#"# Heron — your local marketplace deal hunter.
# Add targets below (or use the "Generate from description" button in the
# Targets panel). Each reference describes one item or category to hunt for.

user:
  location: boston  # Default fallback. Override via Settings → Location.

references: []
"#;

fn resolve_config_dir(app: &tauri::App) -> std::path::PathBuf {
    // In debug builds, point at the deal-hunter project root so we pick up
    // the existing config/, data/, .env during development.
    #[cfg(debug_assertions)]
    {
        if let Ok(cwd) = std::env::current_dir() {
            // cargo tauri dev runs from src-tauri/; the project root is two levels up
            if let Some(root) = cwd.ancestors().nth(2) {
                if root.join("config/price-reference.yaml").exists() {
                    return root.to_path_buf();
                }
            }
        }
    }

    // Release: use OS config dir (%APPDATA%/com.heron.app on Windows)
    let dir = app
        .path()
        .app_config_dir()
        .expect("Failed to resolve app config dir");
    std::fs::create_dir_all(&dir).expect("Failed to create app config dir");

    // First-launch bootstrap: ensure config/price-reference.yaml exists so the
    // sidecar can load it on the user's first Run Now click. Idempotent —
    // we only write the starter when the file is missing entirely.
    let cfg_subdir = dir.join("config");
    let _ = std::fs::create_dir_all(&cfg_subdir);
    let yaml_path = cfg_subdir.join("price-reference.yaml");
    if !yaml_path.exists() {
        if let Err(e) = std::fs::write(&yaml_path, STARTER_PRICE_REFERENCE) {
            log::warn!("Failed to seed starter price-reference.yaml: {}", e);
        }
    }

    dir
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // No args — Heron starts hidden to tray on autostart so the
            // user isn't surprised by a window popping up at boot.
            Some(vec!["--minimized"]),
        ))
        .on_window_event(|window, event| {
            // Hide to tray on close instead of quitting
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let config_dir = resolve_config_dir(app);
            log::info!("Config dir: {}", config_dir.display());
            app.manage(AppState::new(config_dir));

            // System tray
            tray::setup(app)?;
            tray::watch_state(app.handle().clone());

            // Background scheduler
            scheduler::start(app.handle().clone());

            // If launched with --minimized (typically via autostart at boot),
            // hide the window so we go straight to the tray.
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_config,
            commands::write_config,
            commands::get_config_dir,
            commands::run_now,
            commands::get_status,
            commands::read_secrets,
            commands::write_secrets,
            commands::get_schedule,
            commands::set_schedule,
            commands::get_next_runs,
            commands::get_recent_deals,
            commands::get_queue,
            commands::set_listing_state,
            commands::get_history,
            commands::get_source_stats,
            commands::get_overview,
            commands::list_logs,
            commands::tail_log,
            commands::open_url,
            commands::export_backup,
            commands::wipe_database,
            commands::get_version,
            commands::check_for_updates,
            commands::get_autostart_enabled,
            commands::set_autostart_enabled,
            commands::generate_target_yaml,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
