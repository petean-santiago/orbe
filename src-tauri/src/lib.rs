mod git;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // macOS keeps native traffic lights over our custom title bar
                // (titleBarStyle: Overlay). Elsewhere we draw our own controls.
                #[cfg(not(target_os = "macos"))]
                {
                    let _ = window.set_decorations(false);
                }
                let _ = window.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            git::open_repo,
            git::get_status,
            git::get_log,
            git::get_branches,
            git::get_file_diff,
            git::get_commit_files,
            git::get_commit_file_diff,
            git::stage_files,
            git::unstage_files,
            git::discard_files,
            git::commit,
            git::checkout_branch,
            git::fetch,
            git::pull,
            git::push,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Orbe");
}
