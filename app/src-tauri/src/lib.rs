mod commands;
mod sidecar;

use sidecar::AppState;
use tauri::Manager;

fn resolve_config_dir(app: &tauri::App) -> std::path::PathBuf {
    // In debug builds, point at the deal-hunter project root so we pick up
    // the existing config/, data/, .env during development.
    #[cfg(debug_assertions)]
    {
        if let Ok(cwd) = std::env::current_dir() {
            // cargo tauri dev runs from src-tauri/; the project root is two levels up
            let project_root = cwd.ancestors().nth(2);
            if let Some(root) = project_root {
                if root.join("config/price-reference.yaml").exists() {
                    return root.to_path_buf();
                }
            }
        }
    }

    // Release: use OS config dir (%APPDATA%/deal-hunter on Windows)
    let dir = app
        .path()
        .app_config_dir()
        .expect("Failed to resolve app config dir");
    std::fs::create_dir_all(&dir).expect("Failed to create app config dir");
    dir
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_config,
            commands::write_config,
            commands::run_now,
            commands::get_status,
            commands::get_config_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
