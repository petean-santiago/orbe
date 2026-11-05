//! Git operations for Orbe.
//!
//! v1 talks to the user's installed `git` executable. That way we inherit their
//! config, credential helpers, SSH keys, hooks, signing and LFS for free.
//! Hot read paths (log, status) can move to `gix` later without changing the
//! command surface exposed to the frontend.

use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};

type CmdResult<T> = Result<T, String>;

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

fn git_command(repo: &str) -> Command {
    let mut cmd = Command::new("git");
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
    let output = git_command(repo)
        .args(args)
        .output()
        .map_err(|e| format!("Could not run git ({e}). Is Git installed and on your PATH?"))?;

    let code = output.status.code().unwrap_or(-1);
    if ok_codes.contains(&code) {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
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
async fn blocking<T, F>(f: F) -> CmdResult<T>
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
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn open_repo(path: String) -> CmdResult<RepoInfo> {
    blocking(move || {
        let top = run_git(&path, &["rev-parse", "--show-toplevel"])
            .map_err(|_| "This folder is not a Git repository.".to_string())?
            .trim()
            .to_string();
        let name = Path::new(&top)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| top.clone());
        let head = run_git_allow(&top, &["symbolic-ref", "--short", "-q", "HEAD"], &[0, 1])?
            .trim()
            .to_string();
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
        let out = run_git(
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
        let result = run_git(
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
        let out = run_git(
            &path,
            &[
                "for-each-ref",
                "--format=%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track,nobracket)",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
        )?;

        let mut branches = Vec::new();
        for line in out.lines() {
            let f: Vec<&str> = line.split('\x1f').collect();
            if f.len() < 5 {
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
) -> CmdResult<String> {
    blocking(move || {
        if untracked {
            // Exit code 1 just means "there are differences".
            return run_git_allow(
                &path,
                &["diff", "--no-ext-diff", "--no-index", "--", "/dev/null", &file],
                &[0, 1],
            );
        }
        let mut args = vec!["diff", "--no-ext-diff", "-M"];
        if staged {
            args.push("--cached");
        }
        args.push("--");
        args.push(&file);
        run_git(&path, &args)
    })
    .await
}

fn first_parent(repo: &str, hash: &str) -> CmdResult<Option<String>> {
    let out = run_git(repo, &["rev-list", "--parents", "-n", "1", hash])?;
    Ok(out.split_whitespace().nth(1).map(str::to_string))
}

#[tauri::command]
pub async fn get_commit_files(path: String, hash: String) -> CmdResult<Vec<FileChange>> {
    blocking(move || {
        let out = match first_parent(&path, &hash)? {
            Some(parent) => run_git(&path, &["diff", "--name-status", "-z", "-M", &parent, &hash])?,
            None => run_git(
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
) -> CmdResult<String> {
    blocking(move || {
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
        args.push("--".into());
        args.extend(pathspec);

        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        run_git(&path, &refs)
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

#[tauri::command]
pub async fn fetch(path: String) -> CmdResult<()> {
    blocking(move || run_git(&path, &["fetch", "--all", "--prune"]).map(|_| ())).await
}

#[tauri::command]
pub async fn pull(path: String) -> CmdResult<()> {
    blocking(move || run_git(&path, &["pull"]).map(|_| ())).await
}

#[tauri::command]
pub async fn push(path: String) -> CmdResult<()> {
    blocking(move || {
        let has_upstream = run_git(&path, &["rev-parse", "--abbrev-ref", "@{u}"]).is_ok();
        if has_upstream {
            run_git(&path, &["push"])?;
        } else {
            let remotes = run_git(&path, &["remote"])?;
            let remote = remotes
                .lines()
                .find(|r| *r == "origin")
                .or_else(|| remotes.lines().next())
                .ok_or_else(|| "This repository has no remote to push to.".to_string())?
                .to_string();
            run_git(&path, &["push", "-u", &remote, "HEAD"])?;
        }
        Ok(())
    })
    .await
}
