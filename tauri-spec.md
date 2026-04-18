# Deal Hunter — Tauri Desktop App Conversion Spec

## Current State Summary

The deal-hunter engine is **fully built and running in production** as a scheduled Node.js/TypeScript script. Here's what exists at `C:\Programming\Important Projects\deal-hunter`:

### What's Working

**8 scrapers** — all tested live, all with `fetchDetail` for pass-2 drill-down:
| Scraper | Method | Detail |
|---|---|---|
| HiFi Shark | Puppeteer + stealth, headless | Generic (follows /goto/ redirect) |
| US Audio Mart | Puppeteer + stealth, headless | Generic body text |
| Craigslist | Puppeteer + stealth, headless | Bespoke: structured vehicle attrs (odometer, drive, paint, title status) |
| Audiogon | Puppeteer + stealth, headless | CF-gated (graceful fallback to pass-1) |
| eBay | Puppeteer + stealth, headless | Bespoke: item specifics grid + condition |
| Facebook Marketplace | Puppeteer + stealth, **headed** | Generic body text |
| r/mechmarket | Pure fetch() JSON API | Reddit post JSON |
| r/AVexchange | Pure fetch() JSON API | Reddit post JSON |

**Two-pass LLM evaluation** via DeepSeek 3.1 on OpenRouter:
- **Pass 1**: batched (25/chunk, parallel) card-level evaluation against reference tiers or buyer profile
- **Pass 2**: sequential detail drill-down on deal/steal/grail candidates — fetches full listing page, re-evaluates with reference notes (mileage, color, drivetrain, condition, etc.)

**Two evaluation modes** coexist:
- **Exact item** (fixed tiers): W211 E500, Holy Panda, Focal Aria 906, SVS SB-1000/12 — LLM compares against hand-written msrp/fair_used/deal_price/steal_price
- **Category hunt** (profile-based): end-game IEMs, bookshelf speakers — LLM estimates each listing's own used market value, applies the flip test, filters by buyer taste profile

**Item-first config**: single `config/price-reference.yaml` defines items with `sites: [...]`, `query`/`queries`, `site_overrides`, `allowed_states`, `shipping_notes`, `profile`. Searches are generated at load time. No separate searches.yaml.

**Discord DM notifications** via bot token. Adaptive digest: ≤3 deals → individual rich embeds, 4+ → compact markdown summary with suppressed link previews.

**SQLite dedup** with per-site URL normalization (HiFi Shark session UUIDs, eBay tracking params, FBMP referral codes all stripped). Price-drop re-evaluation (≥15% triggers re-queue). Pass-1/pass-2 audit trail: `pass1_tier`, `pass1_reasoning`, `deal_tier`, `llm_reasoning`, `detail_fetched` columns.

**Scheduling**: Windows Task Scheduler, daily at 1pm, interactive-only (for FBMP headed Chrome).

### File Structure

```
deal-hunter/
├── config/
│   └── price-reference.yaml       # All items + hunt profiles (the one config file)
├── src/
│   ├── index.ts                   # Orchestrator: scrape → dedup → pass-1 → pass-2 → digest
│   ├── config.ts                  # YAML loader, generates ResolvedSearch[] from references
│   ├── db.ts                      # SQLite schema, upsert, markPass1/markPass2, migrations
│   ├── evaluator.ts               # evaluateBatch (pass-1) + evaluateDetail (pass-2) + two prompt variants
│   ├── notifier.ts                # Console, Discord webhook, Discord DM (with digest), HiFi Shark redirect resolver
│   ├── scrapers/
│   │   ├── base.ts                # Scraper interface, DetailPage, createBrowser, genericFetchDetail, filterByAllowedStates
│   │   ├── hifishark.ts
│   │   ├── usaudiomart.ts
│   │   ├── craigslist.ts
│   │   ├── audiogon.ts
│   │   ├── ebay.ts
│   │   ├── fbmp.ts
│   │   ├── mechmarket.ts
│   │   ├── avexchange.ts
│   │   └── index.ts               # Scraper registry
│   ├── utils/
│   │   ├── hash.ts                # listingId (SHA-256), normalizeUrl (per-site)
│   │   └── logger.ts              # Pino with sync pretty transport
│   └── scripts/                   # Dev/debug helpers (probe-site, test-detail, test-notify, etc.)
├── data/
│   └── seen_items.db              # SQLite (gitignored)
├── logs/                          # Run logs + probe artifacts (gitignored)
├── .env                           # OPEN_ROUTER_KEY, DISCORD_BOT_TOKEN, DISCORD_USER_ID
├── .env.example
├── package.json                   # deps: puppeteer-extra, better-sqlite3, js-yaml, pino, dotenv
├── tsconfig.json
├── run-hunt.bat                   # Task Scheduler wrapper
├── register-task.bat              # One-shot task registration
├── spec.md                        # Original spec
├── sources.md                     # Source research notes
└── design-prompt.md               # Claude Design brief for the Tauri UI
```

### Key Dependencies

```json
{
  "puppeteer": "^23.5.0",
  "puppeteer-extra": "^3.3.6",
  "puppeteer-extra-plugin-stealth": "^2.11.2",
  "better-sqlite3": "^11.3.0",
  "js-yaml": "^4.1.0",
  "dotenv": "^16.4.5",
  "pino": "^9.4.0",
  "pino-pretty": "^11.2.2"
}
```

Run with: `npx tsx src/index.ts` (or `npm run hunt`)

### Known Issues / Quirks

- **Audiogon detail pages** are Cloudflare-gated — headless stealth can't pass the challenge. Pass-2 gracefully falls back to pass-1 verdict when rawText < 500 chars.
- **FBMP requires headed mode** — FB fingerprints headless chromium. The scraper forces `headless: false` internally.
- **`better-sqlite3` is a native addon** — will complicate `bun build --compile` for the sidecar. May need to swap to `sql.js` (pure WASM) for cross-platform builds.
- **tsx/esbuild `__name` helper** leaks into browser evaluate contexts. Every scraper injects a shim via `page.evaluateOnNewDocument('window.__name = ...')`.
- **pino-pretty sync mode** required — the worker-thread transport buffers indefinitely when stdout is piped (which is how the sidecar will run under Tauri).

---

## Goal

Convert the above into a cross-platform Tauri desktop app with a React-based configuration UI, system tray presence, and bundled sidecar architecture. The end goal is a single installable binary that non-technical users can set up and forget.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Tauri Shell (Rust)                       │
│                                                             │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────────────┐ │
│  │ System    │   │ Timer /      │   │ Tauri Commands      │ │
│  │ Tray Icon │   │ Scheduler    │   │ (read/write config, │ │
│  │           │   │              │   │  trigger manual run, │ │
│  │ - Open UI │   │ Fires sidecar│   │  read logs/history) │ │
│  │ - Run Now │   │ on cron      │   │                     │ │
│  │ - Quit    │   │              │   │                     │ │
│  └──────────┘   └──────┬───────┘   └──────────┬──────────┘ │
│                        │                       │             │
└────────────────────────┼───────────────────────┼─────────────┘
                         │                       │
              ┌──────────▼──────────┐  ┌─────────▼──────────┐
              │   Sidecar Binary    │  │  React Frontend     │
              │                     │  │  (Vite + React)     │
              │  Existing TS app    │  │                     │
              │  compiled via bun   │  │  - Item editor      │
              │  build --compile    │  │  - Source status     │
              │                     │  │  - API keys / secrets│
              │  - Puppeteer scrape │  │  - Schedule config   │
              │  - SQLite dedup     │  │  - Run history/logs  │
              │  - LLM evaluation   │  │  - Manual test run   │
              │  - Discord notify   │  │                     │
              └─────────────────────┘  └─────────────────────┘
```

### Key Principle

The Tauri Rust layer is a **thin shell**. It manages the window, system tray, config file I/O, and sidecar lifecycle. All scraping, evaluation, and notification logic remains in the existing TypeScript codebase, compiled to a standalone binary and invoked as a subprocess.

---

## Prerequisites to Install

Before starting, install:

1. **Rust**: `winget install Rustlang.Rust.MSVC` or https://rustup.rs
2. **Tauri CLI**: `cargo install tauri-cli` (after Rust is installed)
3. **Bun**: `winget install Oven.Bun` or https://bun.sh (for sidecar compilation)
4. Existing: Node.js, npm (already installed)

Verify with: `rustc --version && cargo tauri --version && bun --version`

---

## Implementation Plan

### Phase 1 — Sidecar Prep (modify existing app, no Tauri yet)

Make the existing Node.js app sidecar-ready. These changes are backward-compatible — the app still runs standalone with `npm run hunt`.

**1a. CLI argument parsing** — add to `src/index.ts`:
```
--config-dir <path>    # Where to find price-reference.yaml, .env, seen_items.db
--run-mode <full|dry>  # dry = scrape + eval but don't notify
--verbose              # Debug logging
```

**1b. Path resolution** — currently hardcoded to CWD. Change all path construction to use `--config-dir`:
```typescript
const configDir = flags.configDir || process.cwd();
// price-reference.yaml, .env, seen_items.db, logs/ all relative to configDir
```

Files to modify: `src/config.ts` (YAML path), `src/db.ts` (DB path), `src/index.ts` (dotenv path, log dir), `src/utils/logger.ts` (log path).

**1c. Structured JSON summary on stdout** — after the run, print:
```json
{
  "status": "success",
  "timestamp": "2026-04-17T13:00:00Z",
  "searches_run": 12,
  "listings_scraped": 87,
  "new_listings": 14,
  "deals_found": 2,
  "notifications_sent": 2,
  "errors": [],
  "duration_ms": 34500
}
```
The Rust layer will parse this to update the Dashboard.

**1d. Test**: `npx tsx src/index.ts --config-dir . --verbose` should work identically to `npm run hunt`.

**Commit**: "Sidecar prep: CLI args, config-dir path resolution, JSON summary output"

### Phase 2 — Tauri Scaffold

**2a. Create the Tauri + React + Vite project** in a new directory or restructure:
```bash
cargo create-tauri-app deal-hunter-app --template react-ts
```

**2b. Move existing code into `sidecar/`**:
```
deal-hunter-app/
├── src/                    # React frontend (from create-tauri-app)
├── src-tauri/              # Rust backend (from create-tauri-app)
├── sidecar/                # Existing deal-hunter code (moved here)
│   ├── src/
│   ├── config/
│   ├── package.json
│   └── tsconfig.json
├── package.json            # Root: Vite + React
└── vite.config.ts
```

**2c. Configure `tauri.conf.json`**:
- Bundle sidecar via `externalBin`
- System tray with icon + menu
- Window: 960×680, hide on close
- FS plugin scope for config dir

**2d. Minimal Rust layer** (~150 lines):
- `main.rs`: tray setup, window management, register commands
- `commands.rs`: config read/write, schedule get/set, sidecar trigger, history/logs queries
- `scheduler.rs`: timer that spawns sidecar
- `sidecar.rs`: subprocess spawn + stdout capture

**Commit**: "Tauri scaffold: Rust shell, tray, sidecar invocation"

### Phase 3 — React Frontend

Build the 6 panels against the design system from Claude Design.
Design reference: https://api.anthropic.com/v1/design/h/TpwgIMOBca2zip9vx5Nt4g?open_file=Deal+Hunter.html

**Stack**: Vite + React + TypeScript + Tailwind CSS. No component library.

**3a. Shell**: sidebar nav + panel switching (no router)
**3b. Dashboard**: status strip, recent deals list, per-source health grid, "Run Now" button
**3c. Items panel**: card list + expand-to-edit form. Type toggle (Exact Item / Category Hunt) shows/hides relevant fields. Raw YAML toggle.
**3d. Sources panel**: read-only scraper status grid
**3e. Settings panel**: API keys (masked), schedule picker, LLM model, browser config, notifications test, data management
**3f. History panel**: filterable/sortable table with expandable LLM reasoning rows
**3g. Logs panel**: monospace log tail viewer with level filter + date picker

Each panel is a separate commit, testable independently via `cargo tauri dev`.

### Phase 4 — Sidecar Compilation + Bundling

**4a. Compile sidecar with Bun**:
```bash
cd sidecar
bun build --compile --target=bun-windows-x64 src/index.ts --outfile ../src-tauri/binaries/deal-hunter-sidecar-x86_64-pc-windows-msvc.exe
```

**4b. Test `better-sqlite3`** under Bun compile. If it fails, swap to `sql.js` (pure WASM SQLite). The DB interface in `src/db.ts` is thin enough that the swap is ~30 lines.

**4c. Puppeteer bundling**: Chromium needs to be available at runtime. Options:
- Rely on user's installed Chrome (`puppeteer.launch({ executablePath: ... })`)
- Download chromium on first run
- Bundle chromium in the app (large but self-contained)

Recommend: detect installed Chrome first, download only if missing.

**4d. Full build + test**: `cargo tauri build` → installer that includes sidecar + React frontend.

### Phase 5 — Polish + First-Run Experience

- First-run detection: if config dir is empty, show welcome state
- API key validation: test OpenRouter with a tiny call, test Discord with a sample DM
- Stale selector detection: 3 consecutive zero-result runs → flag in Sources panel
- Hide on close / quit via tray only
- Tray tooltip: "Next run in Xm" / "Scanning..." / "Last run failed"

---

## Config & Data Directory

All user data in OS-appropriate location:

```
Windows:  %APPDATA%/deal-hunter/
macOS:    ~/Library/Application Support/deal-hunter/
Linux:    ~/.config/deal-hunter/

Contents:
├── price-reference.yaml       # Items + hunt profiles (the one config file)
├── .env                       # Secrets (API keys, Discord bot token)
├── schedule.json              # Cron/interval config
├── seen_items.db              # SQLite database
└── logs/
    ├── 2026-04-17.log
    └── ...
```

---

## Rust Layer Detail (src-tauri/)

The Rust code should be minimal. Roughly 150-250 lines total.

### commands.rs — Tauri Commands

```
Config I/O:
- read_config() -> String                    # Returns price-reference.yaml content
- write_config(content: String)              # Writes price-reference.yaml
- read_secrets() -> SecretsRedacted          # Returns secrets with keys masked
- write_secrets(secrets: Secrets)            # Writes .env file

Schedule:
- get_schedule() -> ScheduleConfig
- set_schedule(config: ScheduleConfig)

Sidecar:
- run_sidecar_now() -> ()
- get_sidecar_status() -> SidecarStatus      # Running/idle/last exit code/last JSON summary

History & Logs:
- get_run_history(limit: u32) -> Vec<RunRecord>
- get_recent_deals(limit: u32) -> Vec<DealRecord>
- get_log_tail(lines: u32) -> String
```

### scheduler.rs — Timer

- Read schedule from `schedule.json` on startup
- Recurring timer via tokio
- Spawn sidecar as child process, capture stdout
- Skip if sidecar already running (prevent overlap)
- Update "last run" timestamp from JSON summary

### sidecar.rs — Subprocess

- Locate sidecar binary relative to app bundle (Tauri's resource dir)
- Pass `--config-dir` pointing to the OS config directory
- Stream stdout to log file
- Parse the JSON summary line from stdout
- Return exit code to scheduler

---

## React Frontend Detail

### Tech Stack
- Vite + React + TypeScript + Tailwind CSS
- No component library — utilitarian, data-dense design

### Design Reference
Claude Design system: https://api.anthropic.com/v1/design/h/TpwgIMOBca2zip9vx5Nt4g?open_file=Deal+Hunter.html

Mood: dark, information-dense, Bloomberg terminal aesthetic. Established tier colors (red steal, orange deal, gold fair, purple grail). Monospace for prices/IDs, sans-serif for labels.

### Panel Summary
1. **Dashboard**: status strip + recent deals + source health + "Run Now"
2. **Items**: card list with expand-to-edit. Type toggle: Exact Item (price tiers, variants, grail) vs Category Hunt (profile textarea). Raw YAML toggle.
3. **Sources**: read-only scraper status (8 scrapers, last run, health badge)
4. **Settings**: API keys (masked), schedule, LLM model, browser, notifications test, data mgmt
5. **History**: filterable table of all evaluated items with expandable reasoning
6. **Logs**: monospace log tail with level filter + date picker

---

## Edge Cases

- **No Internet**: sidecar exits cleanly, tray shows yellow, retries next tick
- **Sidecar crash**: log error, continue scheduling. After 3 consecutive failures, tray notification
- **Stale selectors**: 3 consecutive zero-result runs → flag in Sources panel
- **Config validation**: non-empty queries, valid reference IDs, plausible API key format, schedule ≥ 5min
- **DB migrations**: sidecar checks schema version on startup, runs forward migrations. Never drops seen_items.
- **better-sqlite3 under Bun**: may need sql.js fallback. Test early.
- **Puppeteer headed mode**: Chrome window briefly appears during FBMP scrapes. Launch minimized (`--start-minimized`). Update tray tooltip to "Scanning..."

---

## What Stays the Same

All of this is the existing sidecar code, unchanged:
- All 8 scraper modules (Puppeteer + stealth + per-site selectors)
- Two-pass LLM evaluation (pass-1 batched + pass-2 detail drill-down)
- Both evaluation modes (exact item tiers + category hunt profiles)
- Discord DM notifications (bot token, adaptive digest)
- SQLite schema, dedup logic, price-drop re-evaluation
- URL normalization per site (HiFi Shark, eBay, FBMP)
- `allowed_states` geographic filtering
- `shipping_notes` enforcement

The sidecar is the existing app with three small additions:
1. CLI argument parsing (`--config-dir`, `--run-mode`, `--verbose`)
2. Config/DB/log path resolution via `--config-dir`
3. Structured JSON summary on stdout after each run
