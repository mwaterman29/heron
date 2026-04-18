use crate::sidecar::{self, AppState, RunMode};
use tauri::{
    AppHandle, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let open_i = MenuItem::with_id(app, "open", "Open Deal Hunter", true, None::<&str>)?;
    let run_i = MenuItem::with_id(app, "run_now", "Run Now", true, None::<&str>)?;
    let sep_i = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_i, &run_i, &sep_i, &quit_i])?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("Deal Hunter — Idle")
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

/// Update the tray tooltip based on whether a run is active.
pub fn update_tooltip(app: &AppHandle, running: bool) {
    let label = if running { "Deal Hunter — Scanning…" } else { "Deal Hunter — Idle" };
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(label));
    }
}

/// Check whether tooltip-update is supported on this platform (harmless if it isn't).
pub fn watch_state(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last = false;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let running = app
                .state::<AppState>()
                .sidecar_running
                .load(std::sync::atomic::Ordering::SeqCst);
            if running != last {
                update_tooltip(&app, running);
                last = running;
            }
        }
    });
}
