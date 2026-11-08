//! AI assistant backends.
//!
//! Orbe can talk to several providers. The frontend only ever sends a provider
//! id, a model and the conversation; API keys stay in the operating system's
//! keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service)
//! and are read here, so they never live in the webview.
//!
//! - `anthropic`   Claude API (Messages API over HTTPS)
//! - `openai`      OpenAI API (Chat Completions)
//! - `compatible`  any OpenAI-compatible server: Ollama, LM Studio, OpenRouter, ...
//! - `claude-code` the Claude Code CLI, which uses the user's Claude plan
//! - `codex`       the Codex CLI, which uses the user's ChatGPT plan

use crate::git::blocking;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

type CmdResult<T> = Result<T, String>;

const KEYCHAIN_SERVICE: &str = "app.orbe.desktop";
const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION: &str = "2026-10-21";
const DEFAULT_CLAUDE_MODEL: &str = "claude-opus-5-5";
const OPENAI_URL: &str = "https://api.openai.com/v1";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    provider: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    base_url: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ChatMessage {
    role: String,
    content: String,
}

// ---------------------------------------------------------------------------
// Keychain
// ---------------------------------------------------------------------------

fn key_entry(provider: &str) -> CmdResult<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, &format!("ai-{provider}")).map_err(|e| e.to_string())
}

fn stored_key(provider: &str) -> Option<String> {
    key_entry(provider)
        .ok()?
        .get_password()
        .ok()
        .filter(|k| !k.trim().is_empty())
}

#[tauri::command]
pub async fn ai_set_key(provider: String, key: String) -> CmdResult<()> {
    blocking(move || {
        key_entry(&provider)?
            .set_password(key.trim())
            .map_err(|e| format!("Couldn't save the key to the system keychain: {e}"))
    })
    .await
}

#[tauri::command]
pub async fn ai_has_key(provider: String) -> CmdResult<bool> {
    blocking(move || Ok(stored_key(&provider).is_some())).await
}

#[tauri::command]
pub async fn ai_clear_key(provider: String) -> CmdResult<()> {
    blocking(move || match key_entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    })
    .await
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

fn http() -> CmdResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())
}

fn net_err(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "The AI provider took too long to answer.".into()
    } else if e.is_connect() {
        format!("Couldn't reach the AI provider. Check your connection or the server address. ({e})")
    } else {
        e.to_string()
    }
}

async fn read_json(res: reqwest::Response, provider: &str) -> CmdResult<Value> {
    let status = res.status();
    let text = res.text().await.map_err(net_err)?;
    let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if status.is_success() {
        return Ok(value);
    }
    let detail = value["error"]["message"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| text.chars().take(300).collect());
    Err(match status.as_u16() {
        401 | 403 => format!("{provider} rejected the API key. Check it in Settings → AI. ({detail})"),
        429 => format!("{provider} rate limit reached. Try again in a moment. ({detail})"),
        code => format!("{provider} error {code}: {detail}"),
    })
}

/// Models that accept `output_config.effort`.
fn supports_effort(model: &str) -> bool {
    [
        "claude-opus-5",
        "claude-sonnet-5",
        "claude-haiku-5",
        "claude-fable-5",
        "claude-mythos-5",
        "claude-opus-4-6",
        "claude-opus-4-7",
        "claude-opus-4-8",
        "claude-sonnet-4-6",
    ]
    .iter()
    .any(|p| model.starts_with(p))
}

/// Models that support server-side refusal fallbacks (`fallbacks: "default"`).
fn supports_fallback(model: &str) -> bool {
    ["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"].contains(&model)
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

async fn anthropic(cfg: &AiConfig, system: &str, messages: &[ChatMessage], effort: &str) -> CmdResult<String> {
    let key = stored_key("anthropic").ok_or("Add your Anthropic API key in Settings → AI.")?;
    let model = match cfg.model.trim() {
        "" => DEFAULT_CLAUDE_MODEL,
        m => m,
    };

    let mut body = json!({
        "model": model,
        "max_tokens": 16000,
        "system": system,
        "messages": messages,
    });
    if supports_effort(model) {
        body["output_config"] = json!({ "effort": effort });
    }

    let mut req = http()?
        .post(format!("{ANTHROPIC_URL}/messages"))
        .header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION);
    if supports_fallback(model) {
        // If a safety classifier declines, let the API retry on its recommended model.
        body["fallbacks"] = json!("default");
        req = req.header("anthropic-beta", "server-side-fallback-2026-07-01");
    }

    let v = read_json(req.json(&body).send().await.map_err(net_err)?, "Anthropic").await?;
    if v["stop_reason"] == "refusal" {
        return Err("Claude declined to answer this request.".into());
    }
    let text: String = v["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    if text.trim().is_empty() {
        return Err("Claude returned an empty answer.".into());
    }
    Ok(text)
}

fn openai_base(cfg: &AiConfig) -> CmdResult<String> {
    if cfg.provider == "openai" {
        return Ok(OPENAI_URL.into());
    }
    let base = cfg.base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("Set the server address in Settings → AI.".into());
    }
    Ok(base.into())
}

async fn openai(cfg: &AiConfig, system: &str, messages: &[ChatMessage]) -> CmdResult<String> {
    let base = openai_base(cfg)?;
    let key = stored_key(&cfg.provider);
    if cfg.provider == "openai" && key.is_none() {
        return Err("Add your OpenAI API key in Settings → AI.".into());
    }
    let model = cfg.model.trim();
    if model.is_empty() {
        return Err("Choose a model in Settings → AI.".into());
    }

    let mut msgs = vec![json!({ "role": "system", "content": system })];
    msgs.extend(messages.iter().map(|m| json!({ "role": m.role, "content": m.content })));
    let mut req = http()?
        .post(format!("{base}/chat/completions"))
        .json(&json!({ "model": model, "messages": msgs }));
    if let Some(k) = key {
        req = req.bearer_auth(k);
    }

    let label = if cfg.provider == "openai" { "OpenAI" } else { "The AI server" };
    let v = read_json(req.send().await.map_err(net_err)?, label).await?;
    v["choices"][0]["message"]["content"]
        .as_str()
        .filter(|t| !t.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "The model returned an empty answer.".into())
}

// ---------------------------------------------------------------------------
// CLI providers (use the user's subscription instead of an API key)
// ---------------------------------------------------------------------------

/// `~/.nvm/versions/node/<version>/bin` for every installed Node, newest first.
fn nvm_bins(home: &Path) -> Vec<PathBuf> {
    let root = std::env::var_os("NVM_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".nvm"))
        .join("versions/node");
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Vec::new();
    };
    let version = |name: &str| -> Vec<u32> {
        name.trim_start_matches('v').split('.').map(|n| n.parse().unwrap_or(0)).collect()
    };
    let mut found: Vec<(Vec<u32>, PathBuf)> = entries
        .flatten()
        .map(|e| (version(&e.file_name().to_string_lossy()), e.path().join("bin")))
        .filter(|(_, bin)| bin.is_dir())
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, bin)| bin).collect()
}

/// GUI apps often start with a minimal PATH, so add the usual install folders.
fn cli_path() -> Option<std::ffi::OsString> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(h) = &home {
        for d in [
            ".local/bin",
            ".claude/local",
            ".npm-global/bin",
            ".bun/bin",
            ".volta/bin",
            ".asdf/shims",
            ".local/share/mise/shims",
        ] {
            dirs.push(h.join(d));
        }
        // nvm only sets PATH in shell startup files, which GUI apps never read.
        // Its global npm packages (and the `node` they need) live per version.
        dirs.extend(nvm_bins(h));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    dirs.push("/opt/homebrew/bin".into());
    dirs.push("/usr/local/bin".into());
    if let Some(existing) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&existing));
    }
    std::env::join_paths(dirs).ok()
}

fn cli_command(program: &str) -> Command {
    // npm installs `.cmd` shims on Windows, which only cmd.exe can launch.
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("cmd");
        c.args(["/D", "/C", program]);
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        c
    };
    #[cfg(not(windows))]
    let mut cmd = Command::new(program);
    if let Some(path) = cli_path() {
        cmd.env("PATH", path);
    }
    cmd
}

fn cli_label(program: &str) -> &'static str {
    if program == "claude" {
        "Claude Code"
    } else {
        "Codex"
    }
}

fn run_cli(program: &str, args: &[String], input: &str, cwd: Option<&str>) -> CmdResult<String> {
    let mut cmd = cli_command(program);
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let not_found = || {
        format!(
            "{} isn't installed or isn't on your PATH. Install it, sign in once in a terminal, then try again.",
            cli_label(program)
        )
    };
    let mut child = cmd.spawn().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => not_found(),
        _ => e.to_string(),
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if out.status.success() {
        return Ok(stdout);
    }
    if stderr.contains("is not recognized") || stderr.contains("command not found") {
        return Err(not_found());
    }
    let detail = if stderr.is_empty() { stdout } else { stderr };
    Err(format!("{} failed: {}", cli_label(program), detail.chars().take(600).collect::<String>()))
}

/// Model names are passed on a command line, so keep them to safe characters.
fn clean_model(model: &str) -> CmdResult<Option<String>> {
    let m = model.trim();
    if m.is_empty() {
        return Ok(None);
    }
    if m.chars().all(|c| c.is_ascii_alphanumeric() || "-._:/".contains(c)) {
        Ok(Some(m.to_string()))
    } else {
        Err(format!("\"{m}\" is not a valid model name."))
    }
}

/// CLIs take one prompt, so fold the system prompt and history into it.
fn flatten(system: &str, messages: &[ChatMessage]) -> String {
    let mut out = format!("{system}\n\n");
    if messages.len() == 1 {
        out.push_str(&messages[0].content);
        return out;
    }
    out.push_str("Conversation so far:\n\n");
    for m in messages {
        let who = if m.role == "assistant" { "Assistant" } else { "User" };
        out.push_str(&format!("{who}: {}\n\n", m.content));
    }
    out.push_str("Reply as the assistant to the user's last message.");
    out
}

const CLI_GUARD: &str = "\n\nFollow the format asked for above exactly. Do not edit files or run commands that change anything.";

/// An older CLI rejecting one of our newer flags.
fn unknown_flag(err: &str) -> bool {
    let e = err.to_ascii_lowercase();
    e.contains("unknown option") || e.contains("unexpected argument") || e.contains("unrecognized")
}

/// `quick` is for one-shot text tasks like commit messages (effort "low").
fn claude_code(cfg: &AiConfig, system: &str, messages: &[ChatMessage], cwd: Option<&str>, quick: bool) -> CmdResult<String> {
    let mut args: Vec<String> = ["-p", "--output-format", "text"].map(String::from).to_vec();
    if let Some(m) = clean_model(&cfg.model)? {
        args.extend(["--model".into(), m]);
    }
    if quick {
        // Most of the wait is the agent itself: its long system prompt, MCP
        // servers and tools. A plain text task needs none of them.
        let mut fast = args.clone();
        fast.extend([
            "--system-prompt".into(),
            system.into(),
            "--tools".into(),
            String::new(),
            "--strict-mcp-config".into(),
            "--no-session-persistence".into(),
            "--effort".into(),
            "low".into(),
        ]);
        match run_cli("claude", &fast, flatten("", messages).trim_start(), cwd) {
            Err(e) if unknown_flag(&e) => {} // older Claude Code: use the plain call below
            result => return result,
        }
    }
    run_cli("claude", &args, &(flatten(system, messages) + CLI_GUARD), cwd)
}

fn codex(cfg: &AiConfig, system: &str, messages: &[ChatMessage], cwd: Option<&str>, quick: bool) -> CmdResult<String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let out_file = std::env::temp_dir().join(format!("orbe-codex-{stamp}.txt"));
    let mut args: Vec<String> = vec![
        "exec".into(),
        "--skip-git-repo-check".into(),
        "--sandbox".into(),
        "read-only".into(),
        "--output-last-message".into(),
        out_file.to_string_lossy().into_owned(),
    ];
    if let Some(m) = clean_model(&cfg.model)? {
        args.extend(["--model".into(), m]);
    }
    let input = flatten(system, messages) + CLI_GUARD;
    let stdout = if quick {
        let mut fast = args.clone();
        fast.extend(["-c".into(), "model_reasoning_effort=\"low\"".into(), "-".into()]);
        match run_cli("codex", &fast, &input, cwd) {
            Err(e) if unknown_flag(&e) => {
                args.push("-".into());
                run_cli("codex", &args, &input, cwd)?
            }
            result => result?,
        }
    } else {
        args.push("-".into()); // read the prompt from stdin
        run_cli("codex", &args, &input, cwd)?
    };
    let answer = std::fs::read_to_string(&out_file).unwrap_or(stdout);
    let _ = std::fs::remove_file(&out_file);
    Ok(answer.trim().to_string())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ai_complete(
    config: AiConfig,
    system: String,
    messages: Vec<ChatMessage>,
    effort: Option<String>,
    cwd: Option<String>,
) -> CmdResult<String> {
    if messages.is_empty() {
        return Err("Nothing to send.".into());
    }
    let effort = effort.unwrap_or_else(|| "medium".into());
    let quick = effort == "low";
    match config.provider.as_str() {
        "anthropic" => anthropic(&config, &system, &messages, &effort).await,
        "openai" | "compatible" => openai(&config, &system, &messages).await,
        "claude-code" => {
            blocking(move || claude_code(&config, &system, &messages, cwd.as_deref(), quick)).await
        }
        "codex" => blocking(move || codex(&config, &system, &messages, cwd.as_deref(), quick)).await,
        "none" | "" => Err("Choose an AI provider in Settings → AI.".into()),
        other => Err(format!("Unknown AI provider \"{other}\".")),
    }
}

/// Model ids offered by the provider, for the settings picker.
#[tauri::command]
pub async fn ai_list_models(config: AiConfig) -> CmdResult<Vec<String>> {
    let mut ids: Vec<String> = match config.provider.as_str() {
        "anthropic" => {
            let key = stored_key("anthropic").ok_or("Save your Anthropic API key first.")?;
            let res = http()?
                .get(format!("{ANTHROPIC_URL}/models?limit=100"))
                .header("x-api-key", key)
                .header("anthropic-version", ANTHROPIC_VERSION)
                .send()
                .await
                .map_err(net_err)?;
            let v = read_json(res, "Anthropic").await?;
            v["data"]
                .as_array()
                .map(|a| a.iter().filter_map(|m| m["id"].as_str().map(str::to_string)).collect())
                .unwrap_or_default()
        }
        "openai" | "compatible" => {
            let base = openai_base(&config)?;
            let mut req = http()?.get(format!("{base}/models"));
            if let Some(k) = stored_key(&config.provider) {
                req = req.bearer_auth(k);
            }
            let v = read_json(req.send().await.map_err(net_err)?, "The AI server").await?;
            let mut ids: Vec<String> = v["data"]
                .as_array()
                .map(|a| a.iter().filter_map(|m| m["id"].as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            ids.sort();
            ids
        }
        _ => Vec::new(),
    };
    ids.dedup();
    Ok(ids)
}

/// Version string of an installed CLI provider, or None when it isn't available.
#[tauri::command]
pub async fn ai_cli_version(provider: String) -> CmdResult<Option<String>> {
    let program = match provider.as_str() {
        "claude-code" => "claude",
        "codex" => "codex",
        _ => return Ok(None),
    };
    blocking(move || Ok(run_cli(program, &["--version".into()], "", None).ok().filter(|v| !v.is_empty())))
        .await
}

#[cfg(test)]
mod tests {
    use super::nvm_bins;

    #[test]
    fn nvm_bins_newest_first() {
        let home = std::env::temp_dir().join(format!("orbe-nvm-test-{}", std::process::id()));
        for v in ["v18.20.4", "v24.14.1", "v20.9.0", "v24.2.0"] {
            std::fs::create_dir_all(home.join(".nvm/versions/node").join(v).join("bin")).unwrap();
        }
        std::env::remove_var("NVM_DIR");
        let found: Vec<String> = nvm_bins(&home)
            .iter()
            .map(|p| p.parent().unwrap().file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        std::fs::remove_dir_all(&home).ok();
        assert_eq!(found, ["v24.14.1", "v24.2.0", "v20.9.0", "v18.20.4"]);
    }
}
