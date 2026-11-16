//! "Is there a newer Orbe?" The landing publishes `latest.json` with the
//! current release; Orbe reads it now and then and the UI offers the download.
//! Nothing is installed automatically and nothing about the user is sent.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Published by the landing (src/pages/latest.json.ts in orbe-landing).
/// Set `ORBE_UPDATES_URL` when building to use another domain (CI reads it
/// from the repository variable of the same name). Every installed copy keeps
/// the URL it was built with, so once released, keep that address alive (or
/// redirecting: redirects are followed).
const LATEST_URL: &str = match option_env!("ORBE_UPDATES_URL") {
    Some(url) if !url.is_empty() => url,
    _ => "https://orbe-git.app/latest.json",
};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    version: String,
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    notes: Vec<String>,
    /// Where to download it (the landing's download section).
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    /// The running version.
    current: &'static str,
    /// The newest published release (may equal `current`).
    latest: Release,
}

#[tauri::command]
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
pub async fn check_for_update() -> Result<UpdateCheck, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("Orbe/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(LATEST_URL)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the Orbe website ({e})."))?;
    if !resp.status().is_success() {
        return Err(format!("The Orbe website answered {}.", resp.status()));
    }
    let latest: Release = resp.json().await.map_err(|e| format!("Unexpected update information ({e})."))?;
    // Only ever send people to a web page, never to a program.
    if !latest.url.starts_with("https://") {
        return Err("Unexpected download link in the update information.".into());
    }
    Ok(UpdateCheck { current: env!("CARGO_PKG_VERSION"), latest })
}
