# Deal Hunter — Desktop App UI Design Brief

## What This Is

Deal Hunter is a personal deal-finding tool that scrapes 8 marketplace sites (eBay, Craigslist, Facebook Marketplace, HiFi Shark, US Audio Mart, Audiogon, r/mechmarket, r/AVexchange) for specific items and category-based "hunts," evaluates listings against pricing references using an LLM, and sends a daily Discord DM digest of genuine deals. It currently runs as a scheduled Node.js script with YAML config files — no UI at all.

We're wrapping it in a **Tauri desktop app** (Rust shell + React frontend) so it can be configured, monitored, and run from a system tray icon without touching config files or a terminal. The core scraping/evaluation engine stays as a compiled sidecar binary — the UI is purely a configuration + monitoring layer.

## Target User

A single technically-inclined person (not a developer audience — think "enthusiast who knows what YAML is but shouldn't have to edit it"). The app runs on their desktop, sits in the system tray, and they interact with it maybe once a week to tweak searches or check history. The daily Discord DM is the primary interaction surface; the app UI is secondary.

## What I Need Designed

### Overall Design System

- **Mood**: utilitarian, information-dense, slightly dark. Think Bloomberg terminal meets a modern dashboard — not playful, not corporate. Data should be scannable at a glance.
- **Color palette**: dark background, muted accents. The deal tier colors are already established and should be prominent:
  - Steal: red (#FF0000) with 🚨
  - Deal: orange (#FF8C00) with 🔥
  - Fair: gold (#FFD700) with 👀
  - Grail: purple (#9B59B6) with 💎
  - Overpriced / Irrelevant: muted grey
- **Typography**: monospace or semi-mono for prices and IDs, clean sans-serif for everything else. Compact line height — this is a data tool, not a blog.
- **Layout**: single window (960×680 default), sidebar nav on the left, content panel on the right. No routing, just panel switching.

### The Panels (6 total)

#### 1. Dashboard (default view)
The "glance and go" screen. Should answer: "Is it working? Did it find anything?"
- **Status strip**: next scheduled run countdown, time since last run, overall health indicator (green/yellow/red)
- **Recent deals**: last ~10 items flagged as deal/steal/grail. Each row: tier color pip, item title (truncated), price, source icon/badge, timestamp, clickable link. Expandable to show LLM reasoning.
- **Per-source health**: small grid or list showing each of the 8 scrapers with last-success time and item count. Color-coded: green = healthy, yellow = 0 results last run, red = error.
- **"Run Now" button**: prominent but not dominant. Maybe top-right of the status strip.

#### 2. Items (the core config screen)
This replaces editing `price-reference.yaml` by hand. Two types of items coexist:

**Exact items** (like "W211 E500" or "Drop Holy Panda"):
- Name, type, category
- Price tiers: MSRP, fair used, deal, steal (currency-labeled inputs)
- Variants list (for items like SVS subs with multiple models)
- Grail description (optional textarea)
- Notes (rich textarea — this is where domain knowledge lives, e.g. "check for SBC service history")
- Shipping notes (textarea)
- Allowed states (multi-select or tag input)
- Sites to search (checkbox group of available scrapers)
- Default query + per-site query overrides

**Category hunts** (like "End-game IEMs" or "Quality bookshelf speakers"):
- Name, type, category
- Profile (large textarea — the free-text buyer profile that the LLM evaluates against)
- Shipping notes, allowed states, sites, queries — same as exact items

The UI should make the two types feel like variants of the same form, not two completely different screens. A type toggle at the top ("Exact Item" / "Category Hunt") that shows/hides the relevant fields.

Each item is a card in a list. Click to expand/edit. Add new, duplicate, delete, enable/disable toggle.

Also expose a "Raw YAML" toggle for power users who want to edit the full file directly.

#### 3. Sources (read-only reference)
Shows the 8 available scrapers with:
- Site name + favicon/icon
- Last scrape time + items found
- Status badge (healthy / warning / error)
- Brief description of what each source covers
Not editable — sources are defined in code. This is informational.

#### 4. Settings
- **API Keys**: OpenRouter key (masked input with reveal toggle), Discord bot token (masked), Discord user ID
- **Schedule**: frequency picker (dropdown: 15m / 30m / 1h / 2h / 6h / 12h / daily) + active hours (start/end time pickers). Show next 3 scheduled run times as preview.
- **LLM**: primary model selector (text input with current default shown), fallback model
- **Browser**: headless toggle, delay range sliders
- **Notifications**: "Send Test" button
- **Data**: export DB, clear history, reset config — each with a confirmation dialog

#### 5. History
Searchable, filterable table of all evaluated items across all runs:
- Columns: date, source (icon), title, price, deal tier (color chip), pass-1 tier, pass-2 tier, detail fetched (boolean), notified (boolean)
- Expandable row: full LLM reasoning (pass-1 and pass-2), red flags, positive signals, link
- Filters: tier dropdown, source dropdown, date range, search text
- Sort by any column
- This can be data-dense — it's the power-user audit trail

#### 6. Logs
Simple log viewer:
- Monospace text area showing the tail of the current/latest log file
- Auto-scroll toggle
- Log level filter (info / warn / error)
- Date picker to load older log files
- Not fancy — a terminal-in-a-window aesthetic is perfect here

### System Tray
Not a UI panel but worth designing the menu:
- App icon (small, recognizable at 16×16 and 32×32)
- Menu: "Open Dashboard" / "Run Now" / separator / "Quit"
- Tooltip: "Deal Hunter — Next run in 23m" or "Deal Hunter — Scanning..." during a run
- Icon variants: normal (idle), active (scanning), warning (last run failed)

### Additional Design Notes

- The window hides on close (stays in tray), doesn't quit. Quit is only via tray menu.
- First-run state: if no API keys are configured, the Dashboard should show a friendly empty state pointing to Settings. Not an error — a welcome.
- The app should feel fast and native. No loading spinners for local data (config reads, history queries). Spinners only for network operations (test API key, test Discord, run sidecar).
- Mobile responsive is NOT needed — this is a desktop-only Tauri app with a fixed minimum window size.

### Deliverables I'm Looking For

1. A design system / style guide: colors, typography, spacing, component primitives (buttons, inputs, cards, badges, tables, sidebar nav)
2. Layouts for each of the 6 panels
3. The item editor form in both modes (exact item vs category hunt)
4. Empty states and error states for Dashboard
5. The compact deal card component (used in Dashboard recent deals + History table expansion)
6. System tray icon variants
