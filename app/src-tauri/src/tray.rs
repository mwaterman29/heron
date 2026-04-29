use crate::sidecar::{self, AppState, RunMode};
use tauri::{
    AppHandle, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let open_i = MenuItem::with_id(app, "open", "Open Heron", true, None::<&str>)?;
    let run_i = MenuItem::with_id(app, "run_now", "Run Now", true, None::<&str>)?;
    let sep_i = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_i, &run_i, &sep_i, &quit_i])?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("Heron — Idle")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app),
            "run_now" => {
                if let Err(e) = sidecar::spawn(app.clone(), RunMode::Full) {
                    log::warn!("Tray run_now failed: {}", e);
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn show_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.unminimize();
    }
}

/// Update the tray tooltip based on whether a run is active + the current
/// activity string from the sidecar (e.g. "Scraping HiFi Shark"). Falls
/// back to "Scanning…" when running but no activity beacon yet, or
/// "Idle" when not running.
pub fn update_tooltip(app: &AppHandle, running: bool, activity: Option<&str>) {
    let label = match (running, activity) {
        (true, Some(a)) if !a.is_empty() => format!("Heron — {}", a),
        (true, _) => "Heron — Scanning…".to_string(),
        (false, _) => "Heron — Idle".to_string(),
    };
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(&label));
    }
}

/// Poll AppState every 2s and update the tray tooltip when running-state or
/// activity-text changes. Cheap (in-process state lookup, no IO).
pub fn watch_state(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_running = false;
        let mut last_activity: Option<String> = None;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let state = app.state::<AppState>();
            let running = state
                .sidecar_running
                .load(std::sync::atomic::Ordering::SeqCst);
            let activity = state.current_activity.lock().unwrap().clone();
            if running != last_running || activity != last_activity {
                update_tooltip(&app, running, activity.as_deref());
                last_running = running;
                last_activity = activity;
            }
        }
    });
}
