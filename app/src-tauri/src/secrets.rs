use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// Keys we manage through the UI. Anything else in .env is preserved untouched.
const MANAGED_KEYS: &[&str] = &[
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "OPENROUTER_FALLBACK_MODEL",
    "DISCORD_BOT_TOKEN",
    "DISCORD_USER_ID",
    "DISCORD_WEBHOOK_URL",
    "LOG_LEVEL",
    "HEADLESS",
    "SCRAPE_DELAY_MIN",
    "SCRAPE_DELAY_MAX",
    "USD_ONLY",
    "USER_LOCATION",
    "FBMP_LOCATION",
];

/// Keys that should be masked when returned to the UI (show only last 4 chars).
const SECRET_KEYS: &[&str] = &[
    "OPENROUTER_API_KEY",
    "DISCORD_BOT_TOKEN",
    "DISCORD_WEBHOOK_URL",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretEntry {
    pub key: String,
    pub value: String,
    pub is_secret: bool,
    pub is_set: bool,
}

fn parse_env(content: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(eq_pos) = line.find('=') {
            let key = line[..eq_pos].trim().to_string();
            let mut val = line[eq_pos + 1..].trim().to_string();
            // Strip surrounding quotes
            if (val.starts_with('"') && val.ends_with('"'))
                || (val.starts_with('\'') && val.ends_with('\''))
            {
                val = val[1..val.len() - 1].to_string();
            }
            out.insert(key, val);
        }
    }
    out
}

fn mask_value(v: &str) -> String {
    if v.len() <= 4 {
        "••••".to_string()
    } else {
        let last4 = &v[v.len() - 4..];
        format!("••••{}", last4)
    }
}

pub fn read(config_dir: &Path, reveal: bool) -> std::io::Result<Vec<SecretEntry>> {
    let env_path = config_dir.join(".env");
    let content = fs::read_to_string(&env_path).unwrap_or_default();
    let parsed = parse_env(&content);

    let mut entries = Vec::new();
    for key in MANAGED_KEYS {
        let is_secret = SECRET_KEYS.contains(key);
        let raw = parsed.get(*key).cloned().unwrap_or_default();
        let is_set = !raw.is_empty();
        let value = if is_secret && !reveal && is_set {
            mask_value(&raw)
        } else {
            raw
        };
        entries.push(SecretEntry {
            key: key.to_string(),
            value,
            is_secret,
            is_set,
        });
    }
    Ok(entries)
}

pub fn write(config_dir: &Path, updates: Vec<SecretEntry>) -> std::io::Result<()> {
    let env_path = config_dir.join(".env");
    let existing = fs::read_to_string(&env_path).unwrap_or_default();
    let mut parsed = parse_env(&existing);

    for entry in updates {
        // Skip masked values — the UI sends them back unchanged when the user
        // hasn't edited a secret. Pattern: "••••XXXX".
        if entry.is_secret && entry.value.starts_with("••••") {
            continue;
        }
        if entry.value.is_empty() {
            parsed.remove(&entry.key);
        } else {
            parsed.insert(entry.key, entry.value);
        }
    }

    let mut content = String::new();
    content.push_str("# Managed by Heron\n");
    for (k, v) in &parsed {
        // Quote values with spaces
        if v.contains(' ') || v.contains('#') {
            content.push_str(&format!("{}=\"{}\"\n", k, v));
        } else {
            content.push_str(&format!("{}={}\n", k, v));
        }
    }

    if let Some(parent) = env_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&env_path, content)?;
    Ok(())
}
