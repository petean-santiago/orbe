//! Small on-disk store for data that outgrows localStorage, such as AI
//! conversations (which can include large diffs). One JSON file per
//! repository, under the app's data folder.

use crate::git::blocking;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

type CmdResult<T> = Result<T, String>;

/// Stable file name for a repository path (FNV-1a, so it never changes between builds).
fn file_key(repo: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in repo.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn chats_file(app: &tauri::AppHandle, repo: &str) -> CmdResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("chats");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{}.json", file_key(repo))))
}

#[tauri::command]
pub async fn chats_load(app: tauri::AppHandle, repo: String) -> CmdResult<Option<String>> {
    let path = chats_file(&app, &repo)?;
    blocking(move || match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    })
    .await
}

#[tauri::command]
pub async fn chats_save(app: tauri::AppHandle, repo: String, data: String) -> CmdResult<()> {
    let path = chats_file(&app, &repo)?;
    blocking(move || {
        // Write then rename, so a crash never leaves a half-written file.
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, data).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &path).map_err(|e| e.to_string())
    })
    .await
}
