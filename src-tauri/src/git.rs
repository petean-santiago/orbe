//! Git operations for Orbe.
//!
//! v1 talks to the user's installed `git` executable. That way we inherit their
//! config, credential helpers, SSH keys, hooks, signing and LFS for free.
//! Hot read paths (log, status) can move to `gix` later without changing the
//! command surface exposed to the frontend.

use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

type CmdResult<T> = Result<T, String>;

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

/// The git binary for read-only commands, and extra PATH entries it needs.
///
/// On Windows, `git` on PATH is usually Git for Windows' `cmd\git.exe`: a thin
/// launcher that sets up PATH/HOME and then starts the real `mingw64\bin\git.exe`.
/// That is two process creations per call (~50 ms instead of ~20 ms here).
/// Hot read paths (log, status, branches, diffs) call the real binary directly,
/// with the same PATH entries the launcher adds. Anything that writes, talks to
/// a remote or runs hooks keeps going through plain `git`, exactly as before.
struct FastGit {
    exe: PathBuf,
    path_prefix: Option<std::ffi::OsString>,
}

fn fast_git() -> &'static Option<FastGit> {
    static FAST: std::sync::OnceLock<Option<FastGit>> = std::sync::OnceLock::new();
    FAST.get_or_init(|| {
        #[cfg(windows)]
        {
            let path = std::env::var_os("PATH")?;
            let launcher = std::env::split_paths(&path)
                .map(|d| d.join("git.exe"))
                .find(|p| p.is_file())?;
            let dir = launcher.parent()?;
            // Only the Git for Windows launcher lives in a folder called "cmd".
            if !dir.file_name()?.to_string_lossy().eq_ignore_ascii_case("cmd") {
                return None;
            }
            let root = dir.parent()?;
            ["mingw64", "clangarm64", "mingw32"].iter().find_map(|prefix| {
                let bin = root.join(prefix).join("bin");
                let exe = bin.join("git.exe");
                exe.is_file().then(|| {
                    let mut dirs = vec![bin, root.join("usr").join("bin")];
                    dirs.extend(std::env::split_paths(&path));
                    FastGit {
                        exe,
                        path_prefix: std::env::join_paths(dirs).ok(),
                    }
                })
            })
        }
        #[cfg(not(windows))]
        {
            None
        }
    })
}

fn git_command(repo: &str) -> Command {
    let mut cmd = Command::new("git");
    if let Some(path) = tool_path() {
        cmd.env("PATH", path);
    }
    git_command_with(repo, cmd)
}

/// PATH for git commands that may run helpers: credential helpers (`gh`,
/// Git Credential Manager), hooks that need `node`, SSH askpass programs.
/// Apps opened from the Dock get a minimal PATH, so the folders those tools
/// usually live in are appended (after the existing entries, so the same
/// `git` binary is used as before).
fn tool_path() -> Option<&'static std::ffi::OsString> {
    static PATH: std::sync::OnceLock<Option<std::ffi::OsString>> = std::sync::OnceLock::new();
    PATH.get_or_init(|| {
        let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        for d in crate::ai::extra_bin_dirs() {
            if !dirs.contains(&d) {
                dirs.push(d);
            }
        }
        std::env::join_paths(dirs).ok()
    })
    .as_ref()
}

/// Like `git_command`, but for read-only commands: uses the direct binary when we can.
fn git_read_command(repo: &str) -> Command {
    let Some(fast) = fast_git() else {
        return git_command(repo);
    };
    let mut cmd = Command::new(&fast.exe);
    if let Some(path) = &fast.path_prefix {
        cmd.env("PATH", path);
    }
    // The launcher fills in HOME when it's missing; git reads ~/.gitconfig from it.
    if std::env::var_os("HOME").is_none() {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            cmd.env("HOME", profile);
        }
    }
    git_command_with(repo, cmd)
}

fn git_command_with(repo: &str, mut cmd: Command) -> Command {
    cmd.arg("-C")
        .arg(repo)
        .args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd
}

fn run_git(repo: &str, args: &[&str]) -> CmdResult<String> {
    run_git_allow(repo, args, &[0])
}

fn run_git_allow(repo: &str, args: &[&str], ok_codes: &[i32]) -> CmdResult<String> {
    finish(git_command(repo), args, ok_codes)
}

/// Read-only git: never writes the repository, never touches a remote, never runs hooks.
fn read_git(repo: &str, args: &[&str]) -> CmdResult<String> {
    read_git_allow(repo, args, &[0])
}

fn read_git_allow(repo: &str, args: &[&str], ok_codes: &[i32]) -> CmdResult<String> {
    finish(git_read_command(repo), args, ok_codes)
}

fn finish(mut cmd: Command, args: &[&str], ok_codes: &[i32]) -> CmdResult<String> {
    let output = cmd
        .args(args)
        .output()
        .map_err(|e| format!("Could not run git ({e}). Is Git installed and on your PATH?"))?;

    let code = output.status.code().unwrap_or(-1);
    if ok_codes.contains(&code) {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let mut stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            // Some commands (merge conflicts, for example) report on stdout.
            stderr = String::from_utf8_lossy(&output.stdout).trim().to_string();
        }
        if stderr.is_empty() {
            Err(format!(
                "git {} failed (exit code {code})",
                args.first().copied().unwrap_or("")
            ))
        } else {
            Err(stderr)
        }
    }
}

/// Run blocking git work off the async runtime so the UI never stalls.
pub(crate) async fn blocking<T, F>(f: F) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CmdResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

fn status_name(c: char) -> &'static str {
    match c {
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        'T' => "typechange",
        'U' => "conflicted",
        '?' => "untracked",
        _ => "modified",
    }
}

// ---------------------------------------------------------------------------
// Types sent to the frontend
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    path: String,
    name: String,
    head: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    path: String,
    old_path: Option<String>,
    status: String,
    staged: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    hash: String,
    short_hash: String,
    parents: Vec<String>,
    author: String,
    email: String,
    timestamp: i64,
    subject: String,
    refs: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    name: String,
    kind: String,
    is_head: bool,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    /// Unix time of the tip commit (or tag creation).
    updated: i64,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn open_repo(path: String) -> CmdResult<RepoInfo> {
    blocking(move || {
        // One process for both the work tree and the .git folder.
        let out = read_git(&path, &["rev-parse", "--show-toplevel", "--absolute-git-dir"])
            .map_err(|_| "This folder is not a Git repository.".to_string())?;
        let mut lines = out.lines().map(str::trim);
        let top = lines.next().unwrap_or_default().to_string();
        let dir = PathBuf::from(lines.next().unwrap_or_default());
        if top.is_empty() {
            return Err("This folder is not a Git repository.".to_string());
        }
        remember_git_dir(&top, &dir);
        let name = Path::new(&top)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| top.clone());
        // The checked-out branch, straight from .git/HEAD; ask git when it's unusual.
        let head = match branch_from_head_file(&dir) {
            Some(head) => head,
            None => current_branch(&top)?,
        };
        Ok(RepoInfo {
            path: top,
            name,
            head: if head.is_empty() { None } else { Some(head) },
        })
    })
    .await
}

#[tauri::command]
pub async fn get_status(path: String) -> CmdResult<Vec<FileChange>> {
    blocking(move || {
        let out = read_git(
            &path,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        )?;
        let mut changes = Vec::new();
        let mut parts = out.split('\0').filter(|s| !s.is_empty());

        while let Some(entry) = parts.next() {
            if entry.len() < 4 {
                continue;
            }
            let mut chars = entry.chars();
            let x = chars.next().unwrap_or(' ');
            let y = chars.next().unwrap_or(' ');
            let file = entry[3..].to_string();
            let old_path = if x == 'R' || x == 'C' {
                parts.next().map(str::to_string)
            } else {
                None
            };

            let conflicted = matches!(
                (x, y),
                ('D', 'D') | ('A', 'U') | ('U', 'D') | ('U', 'A') | ('D', 'U') | ('A', 'A') | ('U', 'U')
            );
            if conflicted {
                changes.push(FileChange {
                    path: file,
                    old_path: None,
                    status: "conflicted".into(),
                    staged: false,
                });
                continue;
            }
            if x == '?' {
                changes.push(FileChange {
                    path: file,
                    old_path: None,
                    status: "untracked".into(),
                    staged: false,
                });
                continue;
            }
            if x != ' ' {
                changes.push(FileChange {
                    path: file.clone(),
                    old_path: old_path.clone(),
                    status: status_name(x).into(),
                    staged: true,
                });
            }
            if y != ' ' {
                changes.push(FileChange {
                    path: file,
                    old_path: None,
                    status: status_name(y).into(),
                    staged: false,
                });
            }
        }
        Ok(changes)
    })
    .await
}

#[tauri::command]
pub async fn get_log(path: String, limit: u32) -> CmdResult<Vec<Commit>> {
    blocking(move || {
        let n = format!("-n{limit}");
        let result = read_git(
            &path,
            &[
                "log",
                "--exclude=refs/stash",
                "--all",
                "--date-order",
                &n,
                "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D%x1e",
            ],
        );
        let out = match result {
            Ok(out) => out,
            // A freshly initialised repository has no commits yet.
            Err(e) if e.contains("does not have any commits") => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };

        let commits = out
            .split('\x1e')
            .map(|r| r.trim_start_matches(['\n', '\r']))
            .filter(|r| !r.is_empty())
            .filter_map(|record| {
                let f: Vec<&str> = record.split('\x1f').collect();
                if f.len() < 7 {
                    return None;
                }
                Some(Commit {
                    hash: f[0].to_string(),
                    short_hash: f[0].chars().take(7).collect(),
                    parents: f[1].split_whitespace().map(str::to_string).collect(),
                    author: f[2].to_string(),
                    email: f[3].to_string(),
                    timestamp: f[4].trim().parse().unwrap_or(0),
                    subject: f[5].to_string(),
                    refs: f[6]
                        .trim()
                        .split(", ")
                        .filter(|s| !s.is_empty())
                        .map(str::to_string)
                        .collect(),
                })
            })
            .collect();
        Ok(commits)
    })
    .await
}

#[tauri::command]
pub async fn get_branches(path: String) -> CmdResult<Vec<Branch>> {
    blocking(move || {
        let out = read_git(
            &path,
            &[
                "for-each-ref",
                "--format=%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(creatordate:unix)",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
        )?;

        let mut branches = Vec::new();
        for line in out.lines() {
            let f: Vec<&str> = line.split('\x1f').collect();
            if f.len() < 6 {
                continue;
            }
            let full = f[0];
            if full.ends_with("/HEAD") {
                continue;
            }
            let kind = if full.starts_with("refs/heads/") {
                "local"
            } else if full.starts_with("refs/remotes/") {
                "remote"
            } else {
                "tag"
            };

            let (mut ahead, mut behind) = (0u32, 0u32);
            for part in f[4].split(", ") {
                if let Some(n) = part.strip_prefix("ahead ") {
                    ahead = n.trim().parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix("behind ") {
                    behind = n.trim().parse().unwrap_or(0);
                }
            }

            branches.push(Branch {
                name: f[1].to_string(),
                kind: kind.into(),
                is_head: f[2].trim() == "*",
                upstream: if f[3].is_empty() { None } else { Some(f[3].to_string()) },
                ahead,
                behind,
                updated: f[5].trim().parse().unwrap_or(0),
            });
        }
        Ok(branches)
    })
    .await
}

#[tauri::command]
pub async fn get_file_diff(
    path: String,
    file: String,
    staged: bool,
    untracked: bool,
    ignore_whitespace: Option<bool>,
) -> CmdResult<String> {
    blocking(move || {
        let ws = ignore_whitespace.unwrap_or(false);
        if untracked {
            // Exit code 1 just means "there are differences".
            return read_git_allow(
                &path,
                &["diff", "--no-ext-diff", "--no-index", "--", "/dev/null", &file],
                &[0, 1],
            );
        }
        let mut args = vec!["diff", "--no-ext-diff", "-M"];
        if ws {
            args.push("-w");
        }
        if staged {
            args.push("--cached");
        }
        args.push("--");
        args.push(&file);
        read_git(&path, &args)
    })
    .await
}

fn first_parent(repo: &str, hash: &str) -> CmdResult<Option<String>> {
    let out = read_git(repo, &["rev-list", "--parents", "-n", "1", hash])?;
    Ok(out.split_whitespace().nth(1).map(str::to_string))
}

#[tauri::command]
pub async fn get_commit_files(path: String, hash: String) -> CmdResult<Vec<FileChange>> {
    blocking(move || {
        let out = match first_parent(&path, &hash)? {
            Some(parent) => read_git(&path, &["diff", "--name-status", "-z", "-M", &parent, &hash])?,
            None => read_git(
                &path,
                &["diff-tree", "-r", "-z", "-M", "--name-status", "--root", "--no-commit-id", &hash],
            )?,
        };

        let mut files = Vec::new();
        let mut parts = out.split('\0').filter(|s| !s.is_empty());
        while let Some(code) = parts.next() {
            let c = code.chars().next().unwrap_or('M');
            if c == 'R' || c == 'C' {
                let old = parts.next().map(str::to_string);
                if let Some(new) = parts.next() {
                    files.push(FileChange {
                        path: new.to_string(),
                        old_path: old,
                        status: status_name(c).into(),
                        staged: false,
                    });
                }
            } else if let Some(p) = parts.next() {
                files.push(FileChange {
                    path: p.to_string(),
                    old_path: None,
                    status: status_name(c).into(),
                    staged: false,
                });
            }
        }
        Ok(files)
    })
    .await
}

#[tauri::command]
pub async fn get_commit_file_diff(
    path: String,
    hash: String,
    file: String,
    old_path: Option<String>,
    ignore_whitespace: Option<bool>,
) -> CmdResult<String> {
    blocking(move || {
        let ws = ignore_whitespace.unwrap_or(false);
        let mut pathspec = vec![file.clone()];
        if let Some(old) = old_path {
            pathspec.push(old);
        }
        let parent = first_parent(&path, &hash)?;

        let mut args: Vec<String> = match parent {
            Some(p) => vec!["diff".into(), "--no-ext-diff".into(), "-M".into(), p, hash.clone()],
            None => vec![
                "show".into(),
                "--no-ext-diff".into(),
                "--format=".into(),
                hash.clone(),
            ],
        };
        if ws {
            args.insert(2, "-w".into());
        }
        args.push("--".into());
        args.extend(pathspec);

        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        read_git(&path, &refs)
    })
    .await
}

fn with_paths<'a>(base: &[&'a str], files: &'a [String]) -> Vec<&'a str> {
    let mut args = base.to_vec();
    args.push("--");
    args.extend(files.iter().map(String::as_str));
    args
}

#[tauri::command]
pub async fn stage_files(path: String, files: Vec<String>) -> CmdResult<()> {
    blocking(move || run_git(&path, &with_paths(&["add", "-A"], &files)).map(|_| ())).await
}

#[tauri::command]
pub async fn unstage_files(path: String, files: Vec<String>) -> CmdResult<()> {
    blocking(move || run_git(&path, &with_paths(&["restore", "--staged"], &files)).map(|_| ()))
        .await
}

#[tauri::command]
pub async fn discard_files(
    path: String,
    tracked: Vec<String>,
    untracked: Vec<String>,
) -> CmdResult<()> {
    blocking(move || {
        if !tracked.is_empty() {
            run_git(&path, &with_paths(&["restore", "--worktree"], &tracked))?;
        }
        if !untracked.is_empty() {
            run_git(&path, &with_paths(&["clean", "-f", "-q"], &untracked))?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn commit(path: String, message: String, amend: bool) -> CmdResult<String> {
    blocking(move || {
        let mut args = vec!["commit", "-m", message.as_str()];
        if amend {
            args.push("--amend");
        }
        run_git(&path, &args)?;
        Ok(run_git(&path, &["rev-parse", "--short", "HEAD"])?.trim().to_string())
    })
    .await
}

#[tauri::command]
pub async fn checkout_branch(path: String, name: String, remote: bool) -> CmdResult<()> {
    blocking(move || {
        if remote {
            run_git(&path, &["switch", "--track", &name])?;
        } else {
            run_git(&path, &["switch", &name])?;
        }
        Ok(())
    })
    .await
}

/// Why a fetch, pull or push didn't go through, so the UI can say what to do
/// instead of showing raw git output.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteError {
    /// "sso" (the organization needs single sign-on authorization), "auth"
    /// (sign-in failed), "behind" (the remote has commits you don't),
    /// "rejected" (a protected branch or server hook refused it), "network",
    /// "not-pushed" (git finished but commits are still missing on the
    /// remote) or "other".
    kind: &'static str,
    /// Git's own output, for the details view.
    message: String,
    /// A link git printed for you to open, such as an SSO authorization page.
    url: Option<String>,
    /// The remote's host, e.g. "github.com".
    host: Option<String>,
    /// The remote's name, e.g. "origin".
    remote: Option<String>,
}

fn has_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| text.contains(n))
}

/// Sort git's error output into something the UI can act on.
fn classify_remote_error(message: &str) -> (&'static str, Option<String>) {
    let lower = message.to_lowercase();
    let kind = if has_any(&lower, &["saml", "single sign-on", "/sso", " sso ", "sso.", "sso authorization", "sso session"]) {
        "sso"
    } else if has_any(
        &lower,
        &[
            "authentication failed",
            "could not read username",
            "could not read password",
            "terminal prompts disabled",
            "invalid username or password",
            "invalid credentials",
            "http basic: access denied",
            "permission denied (publickey",
            "permission to ",
            "returned error: 401",
            "returned error: 403",
            "repository not found",
            "unauthorized",
            "access denied",
            "host key verification failed",
            "denied to ",
        ],
    ) {
        "auth"
    } else if has_any(&lower, &["protected branch", "gh006", "gh013", "pre-receive hook declined", "[remote rejected]", "push declined"]) {
        "rejected"
    } else if lower.contains("[rejected]") || has_any(&lower, &["fetch first", "non-fast-forward", "tip of your current branch is behind"]) {
        "behind"
    } else if has_any(
        &lower,
        &[
            "could not resolve host",
            "connection timed out",
            "operation timed out",
            "network is unreachable",
            "failed to connect",
            "connection refused",
            "connection reset",
            "unable to access",
        ],
    ) {
        "network"
    } else {
        "other"
    };

    // Links git (or the server, via "remote:" lines) printed for the user.
    let urls: Vec<String> = message
        .split_whitespace()
        .filter(|w| w.starts_with("https://"))
        .map(|w| w.trim_end_matches(|c: char| ".,;:)]>'\"".contains(c)).to_string())
        .filter(|u| u.len() > "https://".len() && u.len() < 2048)
        .collect();
    let url = urls
        .iter()
        .find(|u| {
            let l = u.to_lowercase();
            l.contains("sso") || l.contains("saml") || l.contains("authoriz") || l.contains("login") || l.contains("device")
        })
        .or_else(|| urls.iter().find(|u| !u.contains("docs.github.com") && !u.contains("/help/")))
        .or_else(|| urls.first())
        .cloned();
    (kind, url)
}

/// The remote a branch talks to: its upstream's remote, else "origin", else the first one.
fn remote_name(repo: &str) -> Option<String> {
    let branch = current_branch(repo).unwrap_or_default();
    if !branch.is_empty() {
        if let Ok(r) = run_git(repo, &["config", &format!("branch.{branch}.remote")]) {
            let r = r.trim();
            if !r.is_empty() && r != "." {
                return Some(r.to_string());
            }
        }
    }
    let remotes = run_git(repo, &["remote"]).ok()?;
    remotes
        .lines()
        .find(|r| *r == "origin")
        .or_else(|| remotes.lines().next())
        .map(str::to_string)
}

/// "github.com" from "git@github.com:org/repo.git", "https://user@github.com/org/repo"
/// or "ssh://git@host:22/repo".
fn host_of(url: &str) -> Option<String> {
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    let authority = rest.split(['/', '\\']).next()?;
    let host = authority.rsplit('@').next()?;
    // scp-like "host:path" or "host:port".
    let host = host.split(':').next()?.trim();
    (!host.is_empty() && !host.contains(' ')).then(|| host.to_string())
}

fn remote_error(repo: &str, message: String) -> RemoteError {
    let (kind, url) = classify_remote_error(&message);
    let remote = remote_name(repo);
    let host = remote
        .as_deref()
        .and_then(|r| run_git(repo, &["remote", "get-url", r]).ok())
        .and_then(|u| host_of(u.trim()));
    RemoteError { kind, message, url, host, remote }
}

/// Run a git command that talks to a remote, turning failures into a `RemoteError`.
fn run_remote(repo: &str, args: &[&str]) -> Result<String, RemoteError> {
    run_git(repo, args).map_err(|e| remote_error(repo, e))
}

#[tauri::command]
pub async fn fetch(path: String) -> Result<(), RemoteError> {
    tauri::async_runtime::spawn_blocking(move || run_remote(&path, &["fetch", "--all", "--prune"]).map(|_| ()))
        .await
        .map_err(|e| RemoteError { kind: "other", message: e.to_string(), url: None, host: None, remote: None })?
}

#[tauri::command]
pub async fn pull(path: String) -> Result<(), RemoteError> {
    tauri::async_runtime::spawn_blocking(move || run_remote(&path, &["pull"]).map(|_| ()))
        .await
        .map_err(|e| RemoteError { kind: "other", message: e.to_string(), url: None, host: None, remote: None })?
}

#[tauri::command]
pub async fn push(path: String) -> Result<(), RemoteError> {
    tauri::async_runtime::spawn_blocking(move || {
        let has_upstream = run_git(&path, &["rev-parse", "--abbrev-ref", "@{u}"]).is_ok();
        if has_upstream {
            run_remote(&path, &["push"])?;
        } else {
            let remote = remote_name(&path).ok_or_else(|| RemoteError {
                kind: "other",
                message: "This repository has no remote to push to.".into(),
                url: None,
                host: None,
                remote: None,
            })?;
            run_remote(&path, &["push", "-u", &remote, "HEAD"])?;
        }
        // Don't trust the exit code alone: make sure the commits really are on the remote.
        let left: u32 = run_git(&path, &["rev-list", "--count", "@{u}..HEAD"])
            .ok()
            .and_then(|n| n.trim().parse().ok())
            .unwrap_or(0);
        if left > 0 {
            let mut err = remote_error(
                &path,
                format!("Git reported success, but {left} commit{} still not on the remote.", if left == 1 { " is" } else { "s are" }),
            );
            err.kind = "not-pushed";
            return Err(err);
        }
        Ok(())
    })
    .await
    .map_err(|e| RemoteError { kind: "other", message: e.to_string(), url: None, host: None, remote: None })?
}

// ---------------------------------------------------------------------------
// Branches, tags and stashes
// ---------------------------------------------------------------------------

fn check_branch_name(repo: &str, name: &str) -> CmdResult<()> {
    run_git(repo, &["check-ref-format", "--branch", name])
        .map(|_| ())
        .map_err(|_| format!("\"{name}\" is not a valid branch name."))
}

#[tauri::command]
pub async fn create_branch(
    path: String,
    name: String,
    start: Option<String>,
    checkout: bool,
) -> CmdResult<()> {
    blocking(move || {
        check_branch_name(&path, &name)?;
        let mut args = if checkout {
            vec!["switch", "-c", name.as_str()]
        } else {
            vec!["branch", name.as_str()]
        };
        if let Some(s) = start.as_deref().filter(|s| !s.is_empty()) {
            args.push(s);
        }
        run_git(&path, &args).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn rename_branch(path: String, old: String, new: String) -> CmdResult<()> {
    blocking(move || {
        check_branch_name(&path, &new)?;
        run_git(&path, &["branch", "-m", &old, &new]).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_branch(path: String, name: String, force: bool) -> CmdResult<()> {
    blocking(move || {
        let flag = if force { "-D" } else { "-d" };
        run_git(&path, &["branch", flag, &name]).map(|_| ())
    })
    .await
}

/// Delete a branch on its remote, e.g. `origin/feature/x`.
#[tauri::command]
pub async fn delete_remote_branch(path: String, name: String) -> CmdResult<()> {
    blocking(move || {
        let (remote, branch) = name
            .split_once('/')
            .ok_or_else(|| format!("\"{name}\" is not a remote branch."))?;
        run_git(&path, &["push", remote, "--delete", branch]).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn merge_branch(path: String, name: String) -> CmdResult<()> {
    blocking(move || run_git(&path, &["merge", "--no-edit", &name]).map(|_| ())).await
}

#[tauri::command]
pub async fn create_tag(
    path: String,
    name: String,
    target: Option<String>,
    message: Option<String>,
) -> CmdResult<()> {
    blocking(move || {
        run_git(&path, &["check-ref-format", &format!("refs/tags/{name}")])
            .map_err(|_| format!("\"{name}\" is not a valid tag name."))?;
        let msg = message.unwrap_or_default();
        let mut args = vec!["tag"];
        if !msg.trim().is_empty() {
            args.extend(["-a", "-m", msg.as_str()]);
        }
        args.push(&name);
        if let Some(t) = target.as_deref().filter(|t| !t.is_empty()) {
            args.push(t);
        }
        run_git(&path, &args).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_tag(path: String, name: String) -> CmdResult<()> {
    blocking(move || run_git(&path, &["tag", "-d", &name]).map(|_| ())).await
}

#[tauri::command]
pub async fn stash_save(path: String, message: String, include_untracked: bool) -> CmdResult<()> {
    blocking(move || {
        let mut args = vec!["stash", "push"];
        if include_untracked {
            args.push("--include-untracked");
        }
        if !message.trim().is_empty() {
            args.extend(["-m", message.as_str()]);
        }
        run_git(&path, &args).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn stash_pop(path: String) -> CmdResult<()> {
    blocking(move || run_git(&path, &["stash", "pop"]).map(|_| ())).await
}

// ---------------------------------------------------------------------------
// Creating and cloning repositories
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn init_repo(path: String) -> CmdResult<()> {
    blocking(move || {
        fs::create_dir_all(&path).map_err(|e| format!("Couldn't create the folder: {e}"))?;
        run_git(&path, &["init"]).map(|_| ())
    })
    .await
}

/// Clone `url` into `dest` (which must not exist yet, or be empty). Returns `dest`.
#[tauri::command]
pub async fn clone_repo(url: String, dest: String) -> CmdResult<String> {
    blocking(move || {
        let target = PathBuf::from(&dest);
        let non_empty = target.exists()
            && fs::read_dir(&target).map(|mut d| d.next().is_some()).unwrap_or(true);
        if non_empty {
            return Err(format!("{dest} already exists and is not empty."));
        }
        let parent = target
            .parent()
            .ok_or_else(|| "Choose a folder to clone into.".to_string())?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        run_git(&parent.to_string_lossy(), &["clone", "--", &url, &dest])?;
        Ok(dest)
    })
    .await
}

// ---------------------------------------------------------------------------
// Text for the AI assistant
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_staged_diff(path: String) -> CmdResult<String> {
    blocking(move || {
        read_git(&path, &["diff", "--cached", "--no-ext-diff", "-M", "--stat", "--patch"])
    })
    .await
}

/// Everything not yet committed: tracked changes plus the list of new files.
#[tauri::command]
pub async fn get_working_diff(path: String) -> CmdResult<String> {
    blocking(move || {
        let mut out = read_git(&path, &["diff", "HEAD", "--no-ext-diff", "-M", "--stat", "--patch"])
            .or_else(|_| {
                read_git(&path, &["diff", "--cached", "--no-ext-diff", "--stat", "--patch"])
            })?;
        let untracked = read_git(&path, &["ls-files", "--others", "--exclude-standard"])?;
        if !untracked.trim().is_empty() {
            out.push_str("\nNew untracked files:\n");
            out.push_str(&untracked);
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn get_commit_patch(path: String, hash: String) -> CmdResult<String> {
    blocking(move || {
        read_git(
            &path,
            &["show", "--no-ext-diff", "-M", "--stat", "--patch", "--format=fuller", &hash],
        )
    })
    .await
}

// ---------------------------------------------------------------------------
// Project files (the whole working tree, not only changes)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct TreeEntry {
    path: String,
    dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    text: Option<String>,
    binary: bool,
    size: u64,
    truncated: bool,
}

const MAX_TREE_ENTRIES: usize = 100_000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Resolve a repository-relative path, refusing anything that escapes the repo.
fn safe_join(root: &str, rel: &str) -> CmdResult<PathBuf> {
    let rel = rel.trim().trim_start_matches(['/', '\\']);
    if rel.is_empty() {
        return Err("Please enter a name.".into());
    }
    let p = Path::new(rel);
    for c in p.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err("Paths must stay inside the repository.".into()),
        }
    }
    Ok(Path::new(root).join(p))
}

/// Every file and folder in the working tree, honouring .gitignore.
#[tauri::command]
pub async fn list_tree(path: String) -> CmdResult<Vec<TreeEntry>> {
    blocking(move || {
        let root = PathBuf::from(&path);
        let walker = ignore::WalkBuilder::new(&root)
            .hidden(false)
            .parents(false)
            .filter_entry(|e| e.file_name() != ".git")
            .build();
        let mut out = Vec::new();
        for entry in walker.flatten() {
            if entry.depth() == 0 {
                continue;
            }
            let Ok(rel) = entry.path().strip_prefix(&root) else {
                continue;
            };
            out.push(TreeEntry {
                path: rel.to_string_lossy().replace('\\', "/"),
                dir: entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
            });
            if out.len() >= MAX_TREE_ENTRIES {
                break;
            }
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn read_file(path: String, file: String) -> CmdResult<FileContent> {
    blocking(move || {
        let full = safe_join(&path, &file)?;
        let size = fs::metadata(&full).map_err(|e| e.to_string())?.len();
        let mut buf = Vec::new();
        fs::File::open(&full)
            .map_err(|e| e.to_string())?
            .take(MAX_FILE_BYTES)
            .read_to_end(&mut buf)
            .map_err(|e| e.to_string())?;
        let binary = buf[..buf.len().min(8000)].contains(&0);
        Ok(FileContent {
            text: if binary {
                None
            } else {
                Some(String::from_utf8_lossy(&buf).into_owned())
            },
            binary,
            size,
            truncated: size > MAX_FILE_BYTES,
        })
    })
    .await
}

#[tauri::command]
pub async fn create_file(path: String, file: String) -> CmdResult<()> {
    blocking(move || {
        let full = safe_join(&path, &file)?;
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&full)
            .map(|_| ())
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::AlreadyExists => format!("{file} already exists."),
                _ => e.to_string(),
            })
    })
    .await
}

#[tauri::command]
pub async fn create_folder(path: String, folder: String) -> CmdResult<()> {
    blocking(move || {
        let full = safe_join(&path, &folder)?;
        if full.exists() {
            return Err(format!("{folder} already exists."));
        }
        fs::create_dir_all(&full).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn rename_path(path: String, from: String, to: String) -> CmdResult<()> {
    blocking(move || {
        let src = safe_join(&path, &from)?;
        let dst = safe_join(&path, &to)?;
        if dst.exists() {
            return Err(format!("{to} already exists."));
        }
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::rename(&src, &dst).map_err(|e| e.to_string())
    })
    .await
}

/// Move a file or folder to the system trash, so it can be recovered.
#[tauri::command]
pub async fn delete_path(path: String, target: String) -> CmdResult<()> {
    blocking(move || {
        let full = safe_join(&path, &target)?;
        trash::delete(&full).map_err(|e| format!("Couldn't move {target} to the trash: {e}"))
    })
    .await
}

// ---------------------------------------------------------------------------
// Merge / rebase (drag a branch onto another) and in-progress operations
// ---------------------------------------------------------------------------

/// Where each open repository keeps its .git folder. It never moves, and
/// `repo_operation` asks on every refresh, so look it up once.
fn git_dirs() -> &'static std::sync::Mutex<std::collections::HashMap<String, PathBuf>> {
    static DIRS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, PathBuf>>> =
        std::sync::OnceLock::new();
    DIRS.get_or_init(Default::default)
}

fn remember_git_dir(repo: &str, dir: &Path) {
    if dir.is_dir() {
        if let Ok(mut dirs) = git_dirs().lock() {
            dirs.insert(repo.to_string(), dir.to_path_buf());
        }
    }
}

/// The repository's .git directory, absolute.
fn git_dir(repo: &str) -> CmdResult<PathBuf> {
    let cached = git_dirs().lock().ok().and_then(|d| d.get(repo).cloned());
    if let Some(dir) = cached.filter(|d| d.is_dir()) {
        return Ok(dir);
    }
    let dir = PathBuf::from(read_git(repo, &["rev-parse", "--absolute-git-dir"])?.trim());
    remember_git_dir(repo, &dir);
    Ok(dir)
}

/// The branch HEAD points at, read from `.git/HEAD` without starting git:
/// `Some("")` when detached, `None` when it's anything unusual (let git decide).
fn branch_from_head_file(dir: &Path) -> Option<String> {
    let head = fs::read_to_string(dir.join("HEAD")).ok()?;
    let head = head.trim();
    match head.strip_prefix("ref: ") {
        Some(target) => target.strip_prefix("refs/heads/").map(str::to_string),
        // A detached HEAD holds a commit id.
        None if head.len() >= 40 && head.chars().all(|c| c.is_ascii_hexdigit()) => Some(String::new()),
        None => None,
    }
}

/// "merge", "rebase", "cherry-pick" or "revert" while one is stopped half-way.
fn current_operation(repo: &str) -> CmdResult<Option<&'static str>> {
    let dir = git_dir(repo)?;
    Ok(if dir.join("rebase-merge").exists() || dir.join("rebase-apply").exists() {
        Some("rebase")
    } else if dir.join("MERGE_HEAD").exists() {
        Some("merge")
    } else if dir.join("CHERRY_PICK_HEAD").exists() {
        Some("cherry-pick")
    } else if dir.join("REVERT_HEAD").exists() {
        Some("revert")
    } else {
        None
    })
}

fn current_branch(repo: &str) -> CmdResult<String> {
    Ok(read_git_allow(repo, &["symbolic-ref", "--short", "-q", "HEAD"], &[0, 1])?
        .trim()
        .to_string())
}

/// Run a git command that may want an editor (continue a rebase, finish a
/// merge) without ever opening one: the default message is accepted.
fn run_git_no_editor(repo: &str, args: &[&str]) -> CmdResult<String> {
    let output = git_command(repo)
        .env("GIT_EDITOR", "true")
        .args(args)
        .output()
        .map_err(|e| format!("Could not run git ({e})."))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let mut msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if msg.is_empty() {
        msg = String::from_utf8_lossy(&output.stdout).trim().to_string();
    }
    Err(msg)
}

/// Merge `source` into `target`, switching to `target` first if needed.
/// Resolves to "merged", or "conflicts" when git stopped for you to resolve them.
#[tauri::command]
pub async fn merge_into(path: String, source: String, target: String) -> CmdResult<String> {
    blocking(move || {
        if current_branch(&path)? != target {
            run_git(&path, &["switch", &target])?;
        }
        match run_git(&path, &["merge", "--no-edit", &source]) {
            Ok(_) => Ok("merged".into()),
            Err(e) => {
                if current_operation(&path)? == Some("merge") {
                    Ok("conflicts".into())
                } else {
                    Err(e)
                }
            }
        }
    })
    .await
}

/// Replay `branch` on top of `onto`. Resolves to "rebased" or "conflicts".
#[tauri::command]
pub async fn rebase_onto(path: String, branch: String, onto: String) -> CmdResult<String> {
    blocking(move || match run_git_no_editor(&path, &["rebase", &onto, &branch]) {
        Ok(_) => Ok("rebased".into()),
        Err(e) => {
            if current_operation(&path)? == Some("rebase") {
                Ok("conflicts".into())
            } else {
                Err(e)
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn repo_operation(path: String) -> CmdResult<Option<String>> {
    blocking(move || Ok(current_operation(&path)?.map(str::to_string))).await
}

/// Continue the stopped operation once conflicts are resolved and staged.
#[tauri::command]
pub async fn continue_operation(path: String) -> CmdResult<()> {
    blocking(move || {
        let args: &[&str] = match current_operation(&path)? {
            Some("rebase") => &["rebase", "--continue"],
            Some("merge") => &["commit", "--no-edit"],
            Some("cherry-pick") => &["cherry-pick", "--continue"],
            Some("revert") => &["revert", "--continue"],
            _ => return Err("There is nothing to continue.".into()),
        };
        run_git_no_editor(&path, args).map(|_| ())
    })
    .await
}

/// Abandon the stopped operation and go back to how things were before it.
#[tauri::command]
pub async fn abort_operation(path: String) -> CmdResult<()> {
    blocking(move || {
        let op = current_operation(&path)?.ok_or_else(|| "There is nothing to abort.".to_string())?;
        run_git(&path, &[op, "--abort"]).map(|_| ())
    })
    .await
}

/// Largest file we'll send to the UI for previewing (images, PDFs).
const MAX_PREVIEW_BYTES: u64 = 40 * 1024 * 1024;

/// A file's raw bytes, base64-encoded, for image and PDF previews.
#[tauri::command]
pub async fn read_file_base64(path: String, file: String) -> CmdResult<String> {
    use base64::Engine as _;
    blocking(move || {
        let full = safe_join(&path, &file)?;
        let size = fs::metadata(&full).map_err(|e| e.to_string())?.len();
        if size > MAX_PREVIEW_BYTES {
            return Err(format!(
                "This file is {} MB, too large to preview.",
                size / (1024 * 1024)
            ));
        }
        let bytes = fs::read(&full).map_err(|e| e.to_string())?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
}

/// Bytes of a file at a given version, base64-encoded, for image diffs.
/// `spec` is a git object name: "HEAD:img.png" (last commit), ":img.png"
/// (staged), "<hash>:img.png" or "<hash>^:img.png" (a commit / its parent).
#[tauri::command]
pub async fn read_blob_base64(path: String, spec: String) -> CmdResult<String> {
    use base64::Engine as _;
    blocking(move || {
        let size: u64 = read_git(&path, &["cat-file", "-s", &spec])
            .map_err(|_| "This version of the file doesn't exist.".to_string())?
            .trim()
            .parse()
            .unwrap_or(0);
        if size > MAX_PREVIEW_BYTES {
            return Err(format!("This file is {} MB, too large to preview.", size / (1024 * 1024)));
        }
        // Raw bytes: don't go through run_git, which decodes output as text.
        let output = git_read_command(&path)
            .args(["cat-file", "blob", &spec])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(base64::engine::general_purpose::STANDARD.encode(output.stdout))
    })
    .await
}

/// Check out a commit directly ("detached HEAD"), to look at the project as it was.
#[tauri::command]
pub async fn checkout_commit(path: String, hash: String) -> CmdResult<()> {
    blocking(move || run_git(&path, &["switch", "--detach", &hash]).map(|_| ())).await
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

/// What git kept for a conflicted path, so the UI can offer the right choices.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInfo {
    /// Index stages present for the path: 1 = common ancestor, 2 = ours, 3 = theirs.
    /// A missing side means that side deleted the file.
    base: bool,
    ours: bool,
    theirs: bool,
    /// Short description of the current side (HEAD), e.g. "main".
    ours_label: String,
    /// Short description of the incoming side, e.g. "a1b2c3d Add search".
    theirs_label: String,
}

/// `<short hash> <subject>` for a revision, or None when it doesn't resolve.
fn describe_rev(repo: &str, rev: &str) -> Option<String> {
    run_git(repo, &["log", "-1", "--format=%h %s", rev, "--"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[tauri::command]
pub async fn get_conflict_info(path: String, file: String) -> CmdResult<ConflictInfo> {
    blocking(move || {
        let out = read_git(&path, &["ls-files", "-u", "-z", "--", &file])?;
        let (mut base, mut ours, mut theirs) = (false, false, false);
        // Each entry: "<mode> <object> <stage>\t<path>".
        for entry in out.split('\0').filter(|s| !s.is_empty()) {
            let meta = entry.split('\t').next().unwrap_or("");
            match meta.split(' ').nth(2) {
                Some("1") => base = true,
                Some("2") => ours = true,
                Some("3") => theirs = true,
                _ => {}
            }
        }

        let branch = current_branch(&path).unwrap_or_default();
        let ours_label = if branch.is_empty() {
            describe_rev(&path, "HEAD").unwrap_or_else(|| "HEAD".into())
        } else {
            branch
        };
        let incoming_ref = match current_operation(&path)? {
            Some("merge") => "MERGE_HEAD",
            Some("rebase") => "REBASE_HEAD",
            Some("cherry-pick") => "CHERRY_PICK_HEAD",
            Some("revert") => "REVERT_HEAD",
            _ => "",
        };
        let theirs_label = if incoming_ref.is_empty() {
            "Incoming".into()
        } else {
            describe_rev(&path, incoming_ref).unwrap_or_else(|| incoming_ref.into())
        };

        Ok(ConflictInfo {
            base,
            ours,
            theirs,
            ours_label,
            theirs_label,
        })
    })
    .await
}

/// Resolve a whole file by keeping one side ("ours" = current, "theirs" =
/// incoming) and stage the result. If that side deleted the file, the
/// deletion is what gets kept.
#[tauri::command]
pub async fn resolve_conflict(path: String, file: String, side: String) -> CmdResult<()> {
    blocking(move || {
        let (flag, stage) = match side.as_str() {
            "ours" => ("--ours", "2"),
            "theirs" => ("--theirs", "3"),
            _ => return Err(format!("Unknown side: {side}")),
        };
        let stages = run_git(&path, &["ls-files", "-u", "-z", "--", &file])?;
        let side_exists = stages
            .split('\0')
            .filter_map(|e| e.split('\t').next())
            .any(|meta| meta.split(' ').nth(2) == Some(stage));

        if side_exists {
            run_git(&path, &["checkout", flag, "--", &file])?;
            run_git(&path, &["add", "--", &file])?;
        } else {
            run_git(&path, &["rm", "--quiet", "--ignore-unmatch", "--", &file])?;
        }
        Ok(())
    })
    .await
}

/// Overwrite a working-tree file with `content` (used to save a resolved conflict).
#[tauri::command]
pub async fn write_file(path: String, file: String, content: String) -> CmdResult<()> {
    blocking(move || {
        let full = safe_join(&path, &file)?;
        fs::write(&full, content).map_err(|e| e.to_string())
    })
    .await
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

/// Orbe's author, Santiago Petean.
pub const AUTHOR_SITE: &str = "https://www.santiago-petean.com/";

fn open_in_browser(url: &str) -> CmdResult<()> {
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = Command::new("xdg-open");

    cmd.arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Couldn't open the browser ({e})."))
}

/// Open the author's website in the default browser.
#[tauri::command]
pub async fn open_author_site() -> CmdResult<()> {
    blocking(|| open_in_browser(AUTHOR_SITE)).await
}

/// Open a web page (an SSO authorization page, a remote's site) in the
/// default browser. Only plain http(s) links are accepted, so this can't be
/// used to launch programs or open local files.
#[tauri::command]
pub async fn open_url(url: String) -> CmdResult<()> {
    let ok = (url.starts_with("https://") || url.starts_with("http://"))
        && url.len() < 2048
        && !url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"' || c == '\\' || c == '`');
    if !ok {
        return Err("That doesn't look like a web link.".into());
    }
    blocking(move || open_in_browser(&url)).await
}

#[cfg(test)]
mod remote_error_tests {
    use super::{classify_remote_error, host_of};

    #[test]
    fn github_saml_sso() {
        let msg = "remote: The 'acme' organization has enabled or enforced SAML SSO.\nremote: To access this repository, visit https://github.com/orgs/acme/sso?authorization_request=ABC123 and try again.\nfatal: unable to access 'https://github.com/acme/app.git/': The requested URL returned error: 403";
        let (kind, url) = classify_remote_error(msg);
        assert_eq!(kind, "sso");
        assert_eq!(url.as_deref(), Some("https://github.com/orgs/acme/sso?authorization_request=ABC123"));
    }

    #[test]
    fn ssh_sso_and_auth() {
        let sso = "ERROR: The 'acme' organization has enabled or enforced SAML SSO. To access this repository, you must use the HTTPS remote with a personal access token or SSH key and password that has been authorized for this organization. Visit https://docs.github.com/articles/authenticating-to-a-github-organization-with-saml-single-sign-on/ for more information.\n\nfatal: Could not read from remote repository.";
        assert_eq!(classify_remote_error(sso).0, "sso");
        assert_eq!(classify_remote_error("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.").0, "auth");
        assert_eq!(classify_remote_error("fatal: could not read Username for 'https://github.com': terminal prompts disabled").0, "auth");
    }

    #[test]
    fn behind_rejected_network() {
        assert_eq!(classify_remote_error(" ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs").0, "behind");
        assert_eq!(classify_remote_error("remote: error: GH006: Protected branch update failed for refs/heads/main.\n ! [remote rejected] main -> main (protected branch hook declined)").0, "rejected");
        assert_eq!(classify_remote_error("fatal: unable to access 'https://x/': Could not resolve host: x").0, "network");
        assert_eq!(classify_remote_error("fatal: something else").0, "other");
    }

    #[test]
    fn hosts() {
        assert_eq!(host_of("git@github.com:acme/app.git").as_deref(), Some("github.com"));
        assert_eq!(host_of("https://user@dev.azure.com/acme/_git/app").as_deref(), Some("dev.azure.com"));
        assert_eq!(host_of("ssh://git@gitlab.acme.io:2222/team/app.git").as_deref(), Some("gitlab.acme.io"));
    }
}
