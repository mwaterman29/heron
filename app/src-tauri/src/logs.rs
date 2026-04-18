use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogFile {
    pub name: String,
    pub size_bytes: u64,
    pub modified_at: Option<i64>,
}

pub fn logs_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("logs")
}

pub fn list(config_dir: &Path) -> std::io::Result<Vec<LogFile>> {
    let dir = logs_dir(config_dir);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("log") {
            continue;
        }
        let meta = entry.metadata()?;
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64);
        out.push(LogFile {
            name: path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string(),
            size_bytes: meta.len(),
            modified_at,
        });
    }
    // Newest first
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(out)
}

/// Read the last N lines of a log file. If name is empty or None, picks the newest.
pub fn tail(config_dir: &Path, name: Option<String>, max_lines: usize) -> std::io::Result<String> {
    let dir = logs_dir(config_dir);
    let path = if let Some(n) = name.as_ref().filter(|s| !s.is_empty()) {
        // Prevent path traversal: only filename, no slashes
        if n.contains('/') || n.contains('\\') || n.contains("..") {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid log filename",
            ));
        }
        dir.join(n)
    } else {
        // Newest log file
        let files = list(config_dir)?;
        match files.first() {
            Some(f) => dir.join(&f.name),
            None => return Ok(String::new()),
        }
    };

    if !path.exists() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&path)?;
    let lines: Vec<&str> = content.lines().collect();
    let start = if lines.len() > max_lines {
        lines.len() - max_lines
    } else {
        0
    };
    Ok(lines[start..].join("\n"))
}

/// Get a fresh path for the current run's log file.
pub fn current_log_path(config_dir: &Path) -> std::io::Result<PathBuf> {
    let dir = logs_dir(config_dir);
    fs::create_dir_all(&dir)?;
    let ts = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    Ok(dir.join(format!("run-{}.log", ts)))
}
