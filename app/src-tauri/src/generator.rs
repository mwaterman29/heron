//! LLM-assisted target config generation.
//!
//! Takes a free-text user description ("I want used Focal Aria 906 bookshelf
//! speakers, US sellers only, near Boston for local pickup") and asks the
//! configured OpenRouter model to produce a YAML target spec matching the
//! Heron schema. Returned as a raw YAML string; the frontend parses it with
//! js-yaml and merges it into the user's price-reference.yaml.
//!
//! Uses the same OPENROUTER_API_KEY + OPENROUTER_MODEL the evaluator uses,
//! so no separate setting is needed. Benchmarking
//! (src/scripts/benchmark-config-gen.ts) showed Gemini 3.1 Flash Lite — our
//! current default — does this well at sub-second latency.

use crate::secrets;
use serde::{Deserialize, Serialize};
use std::path::Path;

const SYSTEM_PROMPT: &str = r#"You help configure a marketplace deal-hunter tool. Given a user's natural-language description of what they're hunting for, output a single YAML document matching this schema. NO markdown fences, NO preamble — just the YAML.

## Schema

For EXACT items (user names a specific product):
```
id: lowercase-kebab-case
name: "Human Readable Name"
type: item  # or "vehicle" for cars/trucks
category: audio | auto | keyboards | general
query: "search query string"              # single default
queries: ["q1", "q2"]                     # optional, takes precedence
sites: [hifishark, usaudiomart, craigslist, audiogon, ebay, fbmp, mechmarket, avexchange]
site_overrides:                           # optional per-site query tweaks
  ebay:
    query: "more specific"
allowed_states: [MA, NH, ...]             # US state codes; optional
msrp: 1300                                # USD, typical new retail
fair_used: 700                            # USD, typical used market
deal_price: 550                           # USD, good buy
steal_price: 400                          # USD, below this is likely fake/damaged
grail: "optional, what would be a 💎 find"
notes: |
  Multi-line domain knowledge: gotchas, identification tips, things to check.
shipping_notes: |
  Geography/landed-cost constraints the evaluator should respect.
```

For CATEGORY HUNTS (user describes a taste or budget, no specific target):
```
id: lowercase-kebab-case
name: "Human Readable Name"
type: category_hunt
category: audio | auto | keyboards | general
queries: ["search term 1", "search term 2", ...]
sites: [...]
allowed_states: [...]                     # optional
shipping_notes: |
  ...
profile: |
  Multi-paragraph free-text buyer profile. Include: what they want, budget
  range, specific brands/models of interest (with typical used prices), what
  NOT to surface, condition requirements, key judgment criteria. The LLM
  evaluator uses this to judge each listing against its own used market value.
```

## Choosing sites by category

- audio gear → hifishark, usaudiomart, audiogon, avexchange, ebay, and for local pickup: craigslist + fbmp
- vehicles → craigslist + fbmp ONLY (local pickup only)
- mechanical keyboards → mechmarket + ebay
- general items → ebay + craigslist + fbmp

## Choosing type

- If the user names a specific product and can reasonably estimate MSRP and used price → "item" (or "vehicle" for cars)
- If they describe a category, taste, or budget range with multiple acceptable products → "category_hunt"

## Pricing guidance (exact items only)

Use your world knowledge to estimate realistic USD prices. The four tiers:
- msrp: new retail
- fair_used: typical used-market price for good condition (roughly 50-60% of MSRP for mainstream items, higher for rare/in-demand)
- deal_price: "I'd buy this immediately" — roughly 75-80% of fair_used
- steal_price: "drop everything" — roughly 50-60% of fair_used. Below this, risk of fake/damaged/stolen

## Output

Respond with ONLY the YAML document. No fences, no commentary."#;

const DEFAULT_MODEL: &str = "google/gemini-3.1-flash-lite-preview-20260303";

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateResult {
    /// Raw YAML returned by the LLM, with any markdown fences stripped.
    pub yaml: String,
    /// The model that was actually called (for the loading-state UI label).
    pub model: String,
    pub duration_ms: u64,
}

pub async fn generate(config_dir: &Path, description: &str) -> Result<GenerateResult, String> {
    if description.trim().is_empty() {
        return Err("Description is empty".into());
    }

    // Read the API key + model from .env via the existing secrets module.
    // reveal=true gets us the unmasked value (the masked form starts with bullets).
    let entries = secrets::read(config_dir, true).map_err(|e| e.to_string())?;
    let api_key = entries
        .iter()
        .find(|s| s.key == "OPENROUTER_API_KEY")
        .map(|s| s.value.clone())
        .filter(|v| !v.is_empty() && !v.starts_with("••••"))
        .ok_or_else(|| {
            "OPENROUTER_API_KEY isn't set in Settings yet. Add it on the Settings panel.".to_string()
        })?;
    let model = entries
        .iter()
        .find(|s| s.key == "OPENROUTER_MODEL")
        .map(|s| s.value.clone())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());

    let start = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .user_agent(concat!("Heron/", env!("CARGO_PKG_VERSION"), " (config-gen)"))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": description }
        ],
        "temperature": 0.2
    });

    let res = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("HTTP-Referer", "https://github.com/local/heron")
        .header("X-Title", "Heron-config-gen")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network error: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        let snip = if text.len() > 300 { &text[..300] } else { &text };
        return Err(format!("OpenRouter HTTP {}: {}", status, snip));
    }

    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let content = data
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| "OpenRouter response missing content".to_string())?
        .to_string();

    // Strip the markdown fence the model sometimes adds despite the prompt
    let yaml = strip_fences(&content);

    Ok(GenerateResult {
        yaml,
        model,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

fn strip_fences(s: &str) -> String {
    let trimmed = s.trim();
    let without_open = trimmed
        .strip_prefix("```yaml")
        .or_else(|| trimmed.strip_prefix("```yml"))
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed)
        .trim_start();
    let without_close = without_open
        .strip_suffix("```")
        .unwrap_or(without_open)
        .trim_end();
    without_close.to_string()
}
