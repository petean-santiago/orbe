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
            return run_git_allow(
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
        run_git(&path, &["diff", "--cached", "--no-ext-diff", "-M", "--stat", "--patch"])
    })
    .await
}

/// Everything not yet committed: tracked changes plus the list of new files.
#[tauri::command]
pub async fn get_working_diff(path: String) -> CmdResult<String> {
    blocking(move || {
        let mut out = run_git(&path, &["diff", "HEAD", "--no-ext-diff", "-M", "--stat", "--patch"])
            .or_else(|_| {
                run_git(&path, &["diff", "--cached", "--no-ext-diff", "--stat", "--patch"])
            })?;
        let untracked = run_git(&path, &["ls-files", "--others", "--exclude-standard"])?;
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
        run_git(
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

/// The repository's .git directory, absolute.
fn git_dir(repo: &str) -> CmdResult<PathBuf> {
    Ok(PathBuf::from(run_git(repo, &["rev-parse", "--absolute-git-dir"])?.trim()))
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
    Ok(run_git_allow(repo, &["symbolic-ref", "--short", "-q", "HEAD"], &[0, 1])?
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
        let size: u64 = run_git(&path, &["cat-file", "-s", &spec])
            .map_err(|_| "This version of the file doesn't exist.".to_string())?
            .trim()
            .parse()
            .unwrap_or(0);
        if size > MAX_PREVIEW_BYTES {
            return Err(format!("This file is {} MB, too large to preview.", size / (1024 * 1024)));
        }
        // Raw bytes: don't go through run_git, which decodes output as text.
        let output = git_command(&path)
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
        let out = run_git(&path, &["ls-files", "-u", "-z", "--", &file])?;
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

/// Open the author's website in the default browser. The URL is fixed on
/// purpose, so the frontend can't use this to launch arbitrary programs.
#[tauri::command]
pub async fn open_author_site() -> CmdResult<()> {
    blocking(|| {
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

        cmd.arg(AUTHOR_SITE)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Couldn't open the browser ({e})."))
    })
    .await
}
