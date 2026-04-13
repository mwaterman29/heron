# Deal Hunter — Automated Marketplace Deal Finder

## Overview

A Node.js application that periodically scrapes marketplace sites for specific items, deduplicates against previously seen listings, evaluates deals using a cheap LLM via OpenRouter, and sends notifications for good finds via Discord webhook.

**Stack:** TypeScript, Puppeteer (headed + stealth), SQLite (better-sqlite3), OpenRouter API (GLM-4.7-Flash), Discord webhooks

**Runtime:** Windows desktop via PM2 on cron schedule

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Orchestrator (index.ts)               │
│  Loads config → runs scrapers → dedup → evaluate → notify │
└────┬──────────────┬───────────────┬──────────────┬───────┘
     │              │               │              │
┌────▼────┐  ┌──────▼──────┐  ┌────▼─────┐  ┌────▼──────┐
│ Scrapers │  │ Dedup Layer │  │ Evaluator│  │ Notifier  │
│ (per-site│  │  (SQLite)   │  │ (LLM via │  │ (Discord  │
│ modules) │  │             │  │ OpenRouter│  │  webhook) │
└──────────┘  └─────────────┘  └──────────┘  └───────────┘
```

### Data Flow

1. **Scrape**: For each search config, launch Puppeteer (headed, stealth), navigate to pre-built search URL, extract listing cards from DOM
2. **Deduplicate**: Hash each listing (source + URL or unique ID), check against `seen_items` table, skip known items, upsert timestamps for re-seen items
3. **Evaluate**: Batch new listings with the relevant price reference context, send to GLM-4.7-Flash via OpenRouter, receive structured JSON verdicts
4. **Notify**: For any listing flagged as a deal, fire a Discord webhook embed with title, price, source, LLM reasoning, and direct link
5. **Log**: Record all evaluated items and their verdicts in SQLite for historical tracking

---

## Search Configuration

File: `config/searches.yaml`

```yaml
searches:
  # ── Audio ──────────────────────────────────────────────

  - id: focal-aria-906-fbmp
    site: fbmp
    query: "focal aria 906"
    location: boston
    category: audio
    reference_id: focal-aria-906

  - id: focal-aria-906-usam
    site: usaudiomart
    query: "focal aria 906"
    category: audio
    reference_id: focal-aria-906

  - id: focal-aria-906-hifishark
    site: hifishark
    query: "focal aria 906"
    category: audio
    reference_id: focal-aria-906

  - id: svs-sub-fbmp
    site: fbmp
    query: "svs subwoofer"
    location: boston
    category: audio
    reference_id: svs-sb

  - id: svs-sub-usam
    site: usaudiomart
    query: "svs sb-1000"
    category: audio
    reference_id: svs-sb

  - id: svs-sub-usam-2
    site: usaudiomart
    query: "svs sb-12"
    category: audio
    reference_id: svs-sb

  - id: svs-sub-hifishark
    site: hifishark
    query: "svs sb"
    category: audio
    reference_id: svs-sb

  # ── Automotive ─────────────────────────────────────────

  - id: w211-e500-fbmp
    site: fbmp
    query: "E500 W211"
    location: boston
    category: auto
    reference_id: w211-e500

  - id: w211-e500-fbmp-2
    site: fbmp
    query: "Mercedes E500"
    location: boston
    category: auto
    reference_id: w211-e500
```

### Site Definitions

| Site ID       | Base URL Pattern                                                                 | Auth Required | Scrape Difficulty |
|---------------|----------------------------------------------------------------------------------|---------------|-------------------|
| `fbmp`        | `https://www.facebook.com/marketplace/{location}/search?query={query}`           | No (logged-out) | Medium          |
| `usaudiomart` | `https://www.usaudiomart.com/search?q={query}`                                   | No            | Low               |
| `hifishark`   | `https://www.hifishark.com/search?q={query}`                                     | No            | Low               |
| `canuckaudiomart` | `https://www.canuckaudiomart.com/search?q={query}`                           | No            | Low               |
| `audiogon`    | `https://www.audiogon.com/listings?search={query}`                               | No            | Low–Medium        |

> **Note on FBMP:** Logged-out access works for search results pages (verified in incognito). No cookies or session persistence needed. Each scrape is stateless — launch fresh browser context, hit URL, extract, close. This means zero account risk.

---

## Price Reference Compendium

File: `config/price-reference.yaml`

This is the user-maintained knowledge base that gets injected into the LLM evaluation prompt. The LLM uses this to judge whether a listing is a good deal.

```yaml
references:
  # ── Focal Aria 906 ────────────────────────────────────

  - id: focal-aria-906
    name: "Focal Aria 906"
    type: bookshelf_speaker
    msrp: 1300         # per pair
    fair_used: 700      # typical used price, good condition
    deal_price: 550     # would buy immediately at this price
    steal_price: 400    # almost certainly broken or scam below this
    notes: |
      Flax cone midrange/woofer, TNF tweeter. 
      Check for tweeter damage (exposed inverted dome is fragile).
      Earlier 900 series (non-906) has a different tweeter, less desirable.
      Only interested in the pair — single speaker is not useful.

  # ── SVS Subwoofers ────────────────────────────────────

  - id: svs-sb
    name: "SVS SB-1000 / SB-12"
    type: subwoofer
    variants:
      - model: "SB-1000 Pro"
        msrp: 600
        fair_used: 350
        deal_price: 275
        steal_price: 200
      - model: "SB-1000 (original)"
        msrp: 500
        fair_used: 275
        deal_price: 200
        steal_price: 150
      - model: "SB-12-NSD"
        msrp: 400          # discontinued
        fair_used: 200
        deal_price: 150
        steal_price: 100
    grail: |
      SB-12+ (Plus model, NOT NSD) in Rosenut finish.
      This is a discontinued limited variant. Extremely rare.
      If found under $300 in any condition, flag immediately.
      Rosenut finish is the only one of interest for this model.
    notes: |
      SVS offers a generous trade-in/upgrade program — factor this in.
      SB-1000 Pro has app control + DSP, worth the premium.
      Check for torn surrounds and amp hum on older units.

  # ── W211 E500 ─────────────────────────────────────────

  - id: w211-e500
    name: "2003-2006 Mercedes-Benz E500 (W211)"
    type: vehicle
    year_range: [2003, 2006]  # 2003 is technically pre-facelift, 04-06 preferred
    engine: "M113 5.0L V8"
    fair_price: 8000          # average condition, 100-130k mi
    deal_price: 5500          # good condition, reasonable miles
    steal_price: 3500         # almost certainly has major issues below this
    max_mileage: 120000
    notes: |
      KEY ISSUES TO WATCH FOR:
      - SBC (Sensotronic Brake Control): The hydraulic brake pump. 
        Replacement is $2-3k. If listing says "SBC serviced" or 
        "brake pump replaced," that's a huge plus. MY2006 had 
        extended warranty to 25yr/unlimited miles for SBC.
      - Airmatic suspension: Air struts fail, $800-1200 per corner.
        "Lowered overnight" or sagging corner = airmatic failure.
        If converted to coilovers, that's fine but affects ride.
      - Transmission (722.6 5-speed auto): Needs fluid+filter service
        every 40-60k. "Lifetime fluid" is a myth. If seller confirms
        trans service history, that's a significant plus.
      - Balance shaft sprocket (LESS relevant — mainly M272 V6 issue,
        M113 V8 is more reliable on this front)
      
      IDEAL LISTING SIGNALS:
      - "SBC replaced/serviced"
      - "New air struts" or "Arnott/Bilstein airmatic"
      - "Trans fluid changed at Xk"
      - Service records / single owner / garaged
      - Under 120k miles
      
      RED FLAGS:
      - "Runs and drives" with no detail = hiding something
      - Under $3k = almost guaranteed major mechanical issue
      - "Needs work" on a W211 = money pit
      - Salvage/rebuilt title
```

---

## Database Schema

File: `src/db.ts` — using `better-sqlite3`

```sql
CREATE TABLE IF NOT EXISTS seen_items (
  id TEXT PRIMARY KEY,              -- SHA-256 hash of (site + listing_url)
  site TEXT NOT NULL,               -- e.g. 'fbmp', 'usaudiomart'
  search_id TEXT NOT NULL,          -- references searches.yaml id
  title TEXT,
  price REAL,
  url TEXT NOT NULL,
  location TEXT,
  raw_text TEXT,                    -- full extracted text from listing card
  first_seen_at INTEGER NOT NULL,   -- unix timestamp
  last_seen_at INTEGER NOT NULL,    -- unix timestamp (updated each run)
  times_seen INTEGER DEFAULT 1,     -- increment on re-sight
  evaluated BOOLEAN DEFAULT 0,
  is_deal BOOLEAN DEFAULT 0,
  deal_tier TEXT,                   -- 'steal' | 'deal' | 'fair' | 'overpriced' | 'irrelevant'
  llm_reasoning TEXT,               -- LLM's explanation of verdict
  notified BOOLEAN DEFAULT 0,       -- whether Discord notification was sent
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_seen_items_site ON seen_items(site);
CREATE INDEX idx_seen_items_search_id ON seen_items(search_id);
CREATE INDEX idx_seen_items_evaluated ON seen_items(evaluated);
CREATE INDEX idx_seen_items_is_deal ON seen_items(is_deal);

-- Optional: track price changes on re-seen items
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL REFERENCES seen_items(id),
  price REAL NOT NULL,
  observed_at INTEGER NOT NULL
);
```

### Dedup Logic

```
For each scraped listing:
  1. Generate ID = sha256(site + listing_url)
  2. If ID exists in seen_items:
     a. Update last_seen_at, increment times_seen
     b. If price differs from stored price, insert into price_history
     c. Skip LLM evaluation (already processed)
  3. If ID is new:
     a. Insert into seen_items
     b. Add to evaluation batch
```

### Price Drop Re-evaluation

If a previously-seen item's price drops by >15%, re-flag it for LLM evaluation even though it's not "new." A stale listing with a price drop is a strong deal signal.

---

## LLM Evaluator

### Provider

- **Model:** `z-ai/glm-4.7-flash` via OpenRouter
- **Cost:** $0.06/M input, $0.40/M output
- **Estimated monthly cost:** < $0.10 (assuming ~1.5M tokens/month at 2 runs/day)
- **Fallback model:** `deepseek/deepseek-chat-v3.1` ($0.15/M in, $0.75/M out)

### API Integration

```typescript
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

interface EvalRequest {
  model: string;
  messages: { role: string; content: string }[];
  response_format?: { type: "json_object" };
  temperature: number;
}

// POST to https://openrouter.ai/api/v1/chat/completions
// Headers: Authorization: Bearer $OPENROUTER_API_KEY
//          HTTP-Referer: https://github.com/yourusername/deal-hunter
//          X-Title: deal-hunter
```

### Prompt Template

The evaluator batches new listings (up to ~10 per call to stay well within context) with the relevant price reference.

```
SYSTEM:
You are a marketplace deal evaluator. You will receive:
1. A REFERENCE section describing the item being searched for, including pricing tiers
2. One or more LISTING entries scraped from marketplace sites

For each listing, respond with a JSON object in this exact schema:
{
  "evaluations": [
    {
      "listing_index": 0,
      "relevant": true/false,          // is this actually the item being searched for?
      "deal_tier": "steal|deal|fair|overpriced|irrelevant",
      "confidence": 0.0-1.0,
      "extracted_price": number|null,
      "reasoning": "1-2 sentence explanation",
      "red_flags": ["list", "of", "concerns"],
      "positive_signals": ["list", "of", "good", "signs"],
      "grail_match": true/false         // does this match the 'grail' description if one exists?
    }
  ]
}

Rules:
- If a listing is not actually for the reference item (wrong model, accessory, etc), mark as "irrelevant"
- Consider condition signals in the listing text
- For vehicles: pay special attention to mileage, maintenance history mentions, and known issue status
- "steal" = significantly below deal_price or matches grail criteria at any reasonable price
- "deal" = at or below deal_price
- "fair" = between deal_price and fair_used/fair_price
- "overpriced" = above fair_used/fair_price
- Respond ONLY with the JSON object, no markdown fences, no preamble

USER:
=== REFERENCE ===
{price_reference_yaml_for_this_item}

=== LISTINGS ===
[0] Source: {site}
Title: {title}
Price: {price}
Location: {location}
Text: {raw_text}

[1] Source: {site}
...
```

### Evaluation Batching Strategy

- Group new listings by `reference_id` (so all SVS sub listings go in one call, all E500 listings in another)
- Max ~10 listings per API call (keeps token count manageable, ~2-3K tokens per call)
- If a batch has 0 new listings, skip the API call entirely

---

## Scraper Modules

### Shared Base (`src/scrapers/base.ts`)

```typescript
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

export interface RawListing {
  title: string;
  price: string | null;        // raw price string, e.g. "$350" or "Free"
  url: string;
  location: string | null;
  rawText: string;              // full innerText of the listing card
  thumbnailUrl: string | null;
  source: string;               // site ID
}

export interface ScraperConfig {
  headless: boolean;            // default: false (headed)
  randomDelayRange: [number, number];  // ms, e.g. [2000, 5000]
  timeout: number;              // page load timeout in ms
  userAgent?: string;           // optional override
}

export async function createBrowser(config: ScraperConfig) {
  return puppeteer.launch({
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });
}

export function randomDelay(range: [number, number]): Promise<void> {
  const ms = Math.floor(Math.random() * (range[1] - range[0])) + range[0];
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### FBMP Scraper (`src/scrapers/fbmp.ts`)

**Key considerations:**
- No login required — hit the search URL directly in a fresh browser context
- Facebook uses obfuscated/dynamic class names — do NOT rely on CSS classes
- Strategy: grab the listing grid container's `innerText` or use `data-testid` attributes where available
- Fallback: if DOM selectors break, grab `document.body.innerText` from the results area and let the LLM parse it (robust against FB frontend deploys)
- Add random scroll behavior to trigger lazy-loaded listings
- Respect rate: add 3-8 second random delays between FBMP searches

```typescript
// URL pattern
const url = `https://www.facebook.com/marketplace/${search.location}/search?query=${encodeURIComponent(search.query)}`;

// Extraction strategy (pseudo):
// 1. Wait for page load (networkidle2)
// 2. Scroll down slowly (1-2 viewport heights) to trigger lazy loading
// 3. Try to grab listing cards via stable selector (data-testid, aria-label, or role)
// 4. Fallback: grab all link elements pointing to /marketplace/item/ URLs
//    and extract surrounding text content
// 5. For each card: extract title, price, location, URL, thumbnail
```

**DOM Extraction Resilience:** Facebook's DOM changes frequently. The most stable approach is to:
1. Find all `<a>` tags with `href` matching `/marketplace/item/\d+/`
2. For each, walk up to the nearest common parent container
3. Extract that container's `innerText` as `rawText`
4. Let the LLM handle parsing the unstructured text

### US Audio Mart Scraper (`src/scrapers/usaudiomart.ts`)

- Simpler DOM, more stable selectors
- Listings are typically in a well-structured list/grid
- Extract: title, price, location, date posted, seller info, URL

### HiFi Shark Scraper (`src/scrapers/hifishark.ts`)

- Aggregator site — already structures data nicely
- Listings include source marketplace (eBay, Audiogon, etc.)
- May be able to get structured data without full DOM parsing

### Per-Site Selector Notes

Each scraper module should export a `scrape(searchConfig): Promise<RawListing[]>` function. The selectors WILL break over time. Each module should include:
1. A primary selector strategy
2. A fallback "grab all links + surrounding text" strategy  
3. A health check: if 0 listings returned on a known-populated search, log a warning that selectors may be stale

---

## Notification

### Discord Webhook

Single webhook URL stored in `.env`. Each deal notification is a rich embed:

```typescript
interface DealEmbed {
  title: string;           // e.g. "🔥 DEAL: SVS SB-1000 Pro — $200"
  url: string;             // direct link to listing
  color: number;           // red for steal, orange for deal, etc.
  fields: [
    { name: "Source", value: "US Audio Mart", inline: true },
    { name: "Price", value: "$200", inline: true },
    { name: "Deal Tier", value: "🔥 Steal", inline: true },
    { name: "Location", value: "Boston, MA", inline: true },
    { name: "Analysis", value: "LLM reasoning here..." },
    { name: "Red Flags", value: "None" },
    { name: "Positive Signals", value: "Price well below typical used..." },
  ];
  thumbnail?: { url: string };  // listing image if available
  timestamp: string;            // ISO timestamp
}
```

### Color Coding

| Deal Tier   | Color   | Emoji |
|-------------|---------|-------|
| `steal`     | #FF0000 | 🚨    |
| `deal`      | #FF8C00 | 🔥    |
| `fair`      | #FFD700 | 👀    |
| `grail`     | #9B59B6 | 💎    |

> `overpriced` and `irrelevant` tiers are not notified — they are logged to SQLite only.

### Grail Alert

If `grail_match: true` in the LLM evaluation (e.g., SB-12+ in Rosenut), the notification should be elevated:
- Use the `grail` color + emoji
- Add `@here` mention in the Discord message content (outside the embed)
- Include the grail description from the reference for context

---

## Scheduling & Runtime

### PM2 Setup (Windows)

```bash
npm install -g pm2

# Run every 30 minutes
pm2 start src/index.ts --name deal-hunter --cron "*/30 * * * *" --no-autorestart

# Or use ecosystem file:
# ecosystem.config.js
module.exports = {
  apps: [{
    name: 'deal-hunter',
    script: 'dist/index.js',   // compiled JS
    cron_restart: '*/30 * * * *',
    autorestart: false,
    env: {
      OPENROUTER_API_KEY: 'sk-or-...',
      DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/...',
      NODE_ENV: 'production'
    }
  }]
};

pm2 start ecosystem.config.js
pm2 save
pm2 startup    # persist across reboots
```

### Run Cadence

- **Audio searches:** Every 30 minutes (deals on audio gear can sit for hours)
- **FBMP vehicle searches:** Every 30 minutes (cars move faster on Marketplace)
- Consider: different cadences per search category via separate PM2 processes or internal scheduling logic

### Error Handling

- If a scraper fails (timeout, selector miss, network error): log the error, continue with other scrapers
- If OpenRouter API fails: retry once with 5s delay, then skip evaluation for this run (items remain in DB as `evaluated: false` and will be picked up next run)
- If Discord webhook fails: log error, mark items as `notified: false` for retry next run

---

## Project Structure

```
deal-hunter/
├── config/
│   ├── searches.yaml              # search definitions
│   └── price-reference.yaml       # pricing knowledge base
├── src/
│   ├── index.ts                   # orchestrator: load config → scrape → dedup → eval → notify
│   ├── config.ts                  # YAML config loader + types
│   ├── db.ts                      # SQLite setup + queries (better-sqlite3)
│   ├── scrapers/
│   │   ├── base.ts                # shared puppeteer setup, types, utilities
│   │   ├── fbmp.ts                # Facebook Marketplace (no-auth)
│   │   ├── usaudiomart.ts         # US Audio Mart
│   │   ├── hifishark.ts           # HiFi Shark
│   │   └── index.ts               # scraper registry / dispatcher
│   ├── evaluator.ts               # LLM prompt construction + OpenRouter API calls
│   ├── notifier.ts                # Discord webhook integration
│   └── utils/
│       ├── hash.ts                # listing ID generation (sha256)
│       └── logger.ts              # structured logging (pino or similar)
├── data/
│   └── seen_items.db              # SQLite database (gitignored)
├── .env                           # API keys (gitignored)
├── .env.example
├── ecosystem.config.js            # PM2 config
├── tsconfig.json
├── package.json
└── README.md
```

---

## Dependencies

```json
{
  "dependencies": {
    "puppeteer": "^latest",
    "puppeteer-extra": "^latest",
    "puppeteer-extra-plugin-stealth": "^latest",
    "better-sqlite3": "^latest",
    "js-yaml": "^latest",
    "dotenv": "^latest",
    "pino": "^latest"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/better-sqlite3": "^latest",
    "@types/js-yaml": "^latest",
    "tsx": "^latest"
  }
}
```

---

## Environment Variables

```bash
# .env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=z-ai/glm-4.7-flash       # primary model
OPENROUTER_FALLBACK_MODEL=deepseek/deepseek-chat-v3.1  # fallback
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/.../...
LOG_LEVEL=info                              # debug | info | warn | error
HEADLESS=false                              # true for background, false for visible
SCRAPE_DELAY_MIN=2000                       # ms
SCRAPE_DELAY_MAX=5000                       # ms
```

---

## Future Enhancements (Not in V1)

- **Price trend dashboard:** Simple local web UI showing price history charts per item category
- **Additional sites:** Audiogon, Reverb, eBay saved searches, Craigslist
- **Image analysis:** Pass listing thumbnails to a multimodal model for condition assessment
- **SMS/Pushover fallback:** For truly critical grail alerts when Discord isn't checked
- **Configurable search radius:** For FBMP location-based searches (currently hardcoded to city)
- **Browser profile reuse:** Persist a Chromium profile between runs to build up cookie/fingerprint history and appear more "real" over time