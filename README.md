# Heron

automatic scraper for used gear
built originally for looking for focal aria 906 and w211 e500 at good price
install via releases page
needs open router key, currently only notifies via discord
cost is like $0.14c a day for 8 targets / 4 searches a day w/ my personal config

logo extracted from public domain picture of heron, then potrace-ified
all code written by claude opus 4.6/4.7

tauri is kind of larp because it still needs js runtime but it's still smaller than electron would be

claude's stab at a readme below

---

A personal marketplace deal hunter. Scrapes 8 used-gear marketplaces on a
schedule, runs every listing through an LLM evaluator against your custom
price targets, and surfaces real deals to a triage queue. Runs as a Tauri
desktop app on Windows (macOS/Linux build paths exist but are untested).

Built originally for tracking specific audio gear (Focal Aria 906, KEF LS50,
SVS subwoofers, etc.) against fluctuating used-market prices. The targets
are arbitrary — you write them in YAML or generate them from a description.

## What it does

- **Scrapes 8 sources** on a schedule you control (default: every hour).
- **LLM-evaluates each listing** against your reference targets. Tiers:
  steal / deal / fair / overpriced / irrelevant. Pass-1 looks at the
  search-card text; pass-2 fetches the detail page for any deal candidate
  and re-judges with full context (catches things like "this $49 price is
  a starting bid, the actual Buy-It-Now is $189").
- **Sends Discord DM digests** when deals are found.
- **Triage queue** — every flagged listing lands in a UI queue with
  open-in-browser, follow-up, reject, mark-purchased, mark-lost states.

## Sources

| Source | Notes |
|---|---|
| eBay | US-only filter, item-specifics extraction |
| Craigslist | Vehicle-aware extraction; uses your regional subdomain |
| Facebook Marketplace | Uses your area slug; runs unauthenticated |
| Audiogon | High-end audio classifieds |
| US Audio Mart | Audio-focused enthusiast classifieds |
| HiFi Shark | Cross-marketplace audio aggregator (50+ sites) |
| r/mechmarket | Mechanical keyboard buy/sell/trade |
| r/AVexchange | Audio gear buy/sell/trade |

All scraping is unauthenticated. Heron does not require login to any of these
services and does not transmit your data anywhere except OpenRouter (for LLM
evaluation) and Discord (for digest delivery).

## Quick start (installed binary)

1. Download the `.msi` from the latest GitHub release.
2. Run it. Windows SmartScreen will warn — "More info" → "Run anyway".
3. Open Heron from the Start menu.
4. **Settings → API keys** — fill in:
   - OpenRouter API key (sign up at openrouter.ai, ~$5 lasts months)
   - Discord bot token + your Discord user ID
5. **Settings → Location** — enter your Craigslist subdomain (e.g.
   `boston`, `seattle`) and optionally paste your FB Marketplace URL.
6. **Targets** — empty by default. Either:
   - Click **+ New target** and use **Generate from description** to
     have the LLM scaffold a target from a one-line description, or
   - Edit `%APPDATA%\com.heron.app\config\price-reference.yaml` directly.
7. **Settings → Schedule** — flip on automatic runs and pick an interval.
8. **Dashboard → Run Now** to trigger the first scan.

## Configuration

All managed config lives in `%APPDATA%\com.heron.app\` on Windows
(`~/Library/Application Support/com.heron.app/` on macOS,
`~/.config/com.heron.app/` on Linux):

```
config/price-reference.yaml   # your targets — edit via UI or directly
.env                          # API keys (managed by Settings UI)
schedule.json                 # automatic-run config
data/seen_items.db            # SQLite history of every listing seen
logs/                         # date-stamped run logs
backups/                      # exports from Settings → Data
```

### Targets

Three modes per target:

- **Standard** — exact reference item with fixed pricing tiers (`msrp`,
  `fair_used`, `deal_price`, `steal_price`). The LLM compares each listing
  against these tiers in USD. Best for specific gear hunts.
- **Category hunt** — `profile` field describes the buyer's intent in
  free text; the LLM estimates each listing's typical used-market value
  from its own knowledge and judges against that. Best for "any decent
  bookshelf speaker under $400."
- **General review** — open-ended "surface anything interesting on this
  source" mode. Useful for sources where the rest of your targets don't
  apply.

### Filters

Three quality filters run before LLM evaluation, saving tokens on noise:

- **USD-only** (Settings → Browser → "USD listings only") — skips listings
  priced in non-USD currencies. On by default. Turn off if you want
  international listings with FX conversion.
- **Sold-listing detection** — skips URLs containing `/sold-` (head-fi
  convention) or titles starting with `SOLD`/`[SOLD]`. Always on.
- **Cross-site title dedup** — collapses regional Craigslist re-posts and
  cross-site duplicates that share title+price+currency. Always on.

## How it works

```
┌─────────────────┐   ┌──────────────┐   ┌──────────────┐
│  Scheduler /    │──▶│  Scrapers    │──▶│  Pre-filters │
│  Run Now click  │   │  (puppeteer) │   │  USD/sold/   │
└─────────────────┘   └──────────────┘   │  dedup       │
                                          └──────┬───────┘
                                                 ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Discord DM  │◀──│  Pass-2      │◀──│  Pass-1 LLM  │
│  digest      │   │  detail-page │   │  batch eval  │
└──────────────┘   │  re-judge    │   │  (cards)     │
                    └──────────────┘   └──────────────┘
```

- **Frontend** — React + TypeScript + Vite, rendered in a Tauri webview.
- **Rust shell** — owns the SQLite DB, the scheduler, the system tray,
  the update check, and IPC.
- **Sidecar** — TypeScript Node process spawned by the Rust shell. Owns
  the scrapers (puppeteer + stealth plugin) and the OpenRouter calls.
  Streams progress back over stdout via `__HERON_ACTIVITY__` markers.

The full pipeline lives in [src/index.ts](src/index.ts).

## Costs

LLM evaluation is the only ongoing cost. Default model is Google
**Gemini 3.1 Flash Lite** at $0.25/M input + $1.50/M output tokens, with
**DeepSeek V3.1** as fallback.

A typical run scraping ~100 listings across 8 sources costs roughly
$0.001–$0.005. Hourly runs over a full day are ≤$0.10. The exact figure
appears live in **Settings → LLM models → Running cost estimate**, computed
from your most recent run's actual token usage.

## Building from source

```bash
git clone https://github.com/mwaterman29/heron
cd heron/app
cargo tauri dev    # development mode with hot reload
cargo tauri build  # produces an .msi installer
```

Prereqs: Rust 1.77+, Tauri CLI v2, Node 22+. See [SHIPPING.md](SHIPPING.md)
for the full release workflow including the `.vsig` update manifest, code
signing notes, and the sidecar bundling caveat (the current sidecar binary
is a dev shim — works on the developer's machine; needs `bun --compile`
work before it can be distributed to other people's machines).

## Updates

Heron checks `https://raw.githubusercontent.com/mwaterman29/heron/main/.vsig`
once per day on launch. When a newer version is available, the sidebar
version label gets a green dot — click for the changelog + download link.

Updates are manual: download the new `.msi`, run it, your config and
history carry across.

## Status

Personal-use software. The installed binary works for the developer; the
sidecar bundling for distribution to other machines is a known TODO (see
SHIPPING.md). If you're cloning to use yourself: `cargo tauri dev` works
out of the box once you've set your API keys.
