mod ai;
mod git;
mod store;

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
            git::checkout_commit,
            git::fetch,
            git::pull,
            git::push,
            git::create_branch,
            git::rename_branch,
            git::delete_branch,
            git::delete_remote_branch,
            git::merge_branch,
            git::merge_into,
            git::rebase_onto,
            git::repo_operation,
            git::continue_operation,
            git::abort_operation,
            git::get_conflict_info,
            git::resolve_conflict,
            git::write_file,
            git::open_author_site,
            git::create_tag,
            git::delete_tag,
            git::stash_save,
            git::stash_pop,
            git::init_repo,
            git::clone_repo,
            git::get_staged_diff,
            git::get_working_diff,
            git::get_commit_patch,
            git::list_tree,
            git::read_file,
            git::read_file_base64,
            git::read_blob_base64,
            git::create_file,
            git::create_folder,
            git::rename_path,
            git::delete_path,
            ai::ai_set_key,
            ai::ai_has_key,
            ai::ai_clear_key,
            ai::ai_complete,
            ai::ai_list_models,
            ai::ai_cli_version,
            store::chats_load,
            store::chats_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Orbe");
}
