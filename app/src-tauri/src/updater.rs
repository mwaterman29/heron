use semver::Version;
use serde::{Deserialize, Serialize};

/// Where the update manifest lives. Currently points at the .vsig committed
/// at the repo root on the `main` branch. Bump the version + download_url in
/// that file with each release; running clients fetch it on a 24h cadence
/// and surface a banner when the manifest's version exceeds the installed
/// one.
///
/// See SHIPPING.md for the full release workflow.
pub const UPDATE_MANIFEST_URL: Option<&str> =
    Some("https://raw.githubusercontent.com/mwaterman29/heron/main/.vsig");

/// Manifest schema. Lives at `.vsig` in the repo root for easy editing.
/// Format is JSON despite the `.vsig` extension — keeps the name short and
/// memorable while still being trivially parseable + extensible.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    version: String,
    #[serde(default)]
    released: Option<String>,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    download_url: Option<String>,
}

/// What the frontend gets back from check_for_updates.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub available: bool,
    pub released: Option<String>,
    pub notes: Option<String>,
    pub download_url: Option<String>,
    /// Set when the manifest URL isn't configured yet. Frontend can decide
    /// whether to show a "configure update endpoint" message or stay silent.
    pub manifest_url_configured: bool,
    /// Populated if the fetch/parse failed for any reason.
    pub error: Option<String>,
}

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

pub async fn check() -> UpdateInfo {
    let url = match UPDATE_MANIFEST_URL {
        Some(u) => u,
        None => {
            return UpdateInfo {
                current_version: CURRENT_VERSION.to_string(),
                latest_version: None,
                available: false,
                released: None,
                notes: None,
                download_url: None,
                manifest_url_configured: false,
                error: None,
            };
        }
    };

    let manifest = match fetch_manifest(url).await {
        Ok(m) => m,
        Err(e) => {
            return UpdateInfo {
                current_version: CURRENT_VERSION.to_string(),
                latest_version: None,
                available: false,
                released: None,
                notes: None,
                download_url: None,
                manifest_url_configured: true,
                error: Some(e),
            };
        }
    };

    let available = match (Version::parse(CURRENT_VERSION), Version::parse(&manifest.version)) {
        (Ok(cur), Ok(latest)) => latest > cur,
        // If either side fails to parse, fall back to string-equality:
        // assume "different string = update available", since something is
        // off with versioning regardless and the user should know.
        _ => CURRENT_VERSION != manifest.version,
    };

    UpdateInfo {
        current_version: CURRENT_VERSION.to_string(),
        latest_version: Some(manifest.version),
        available,
        released: manifest.released,
        notes: manifest.notes,
        download_url: manifest.download_url,
        manifest_url_configured: true,
        error: None,
    }
}

async fn fetch_manifest(url: &str) -> Result<Manifest, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(format!("Heron/{} (update-check)", CURRENT_VERSION))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let text = res.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str::<Manifest>(&text).map_err(|e| format!("manifest parse: {}", e))
}

pub fn current_version() -> &'static str {
    CURRENT_VERSION
}
