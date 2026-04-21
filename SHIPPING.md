# Shipping Heron

Step-by-step guide for getting Heron from your dev environment onto an
installed copy you can use as a real app — and for cutting subsequent
releases. Written for Windows (msi installer); macOS / Linux notes are
sprinkled where they'd differ.

## TL;DR for the very first ship

1. `cd app && cargo tauri build`
2. Find the .msi: `app/src-tauri/target/release/bundle/msi/Heron_0.1.0_x64_en-US.msi`
3. Double-click → install → SmartScreen warning → "More info" → "Run anyway"
4. Open Heron from Start menu. The window says "Heron". The tray icon is
   the heron silhouette. Config dir is `%APPDATA%\com.heron.app\`
5. Bootstrap your config:
   - In dev (this repo): Settings → Data → Export target config
   - Copy `backups/config-<ts>.yaml` → `%APPDATA%\com.heron.app\config\price-reference.yaml`
   - In installed Heron: Settings → fill in API keys → Save
6. Click Run Now to verify scraping works
7. Go to bed; tomorrow you have a real app

The rest of this doc is for "what if" cases and the eventual update flow.

---

## Prerequisites (one-time)

You should already have these from prior dev work, but for a clean rebuild:

- **Rust** 1.77+ (`rustc --version`)
- **Tauri CLI v2** (`cargo install tauri-cli --version "^2.0"`)
- **Node.js 22+** with npm
- **Bun** (only needed if you eventually want a real compiled sidecar binary
  instead of the dev-shim launcher — for the v0.1.0 ship the dev shim is
  what gets bundled)

Verify: `rustc --version && cargo tauri --version && node --version`

## Building the installer

From the project root:

```bash
cd app
cargo tauri build
```

What this does:
1. Runs `npm run build` (Vite production build of the React frontend)
2. Compiles the Rust shell in release mode
3. Bundles the sidecar binary from `src-tauri/binaries/heron-sidecar-x86_64-pc-windows-msvc.exe`
4. Generates the .msi installer at
   `app/src-tauri/target/release/bundle/msi/Heron_0.1.0_x64_en-US.msi`

First build takes ~5–10 min (it has to compile everything). Subsequent
builds are ~1–2 min thanks to incremental compilation.

### Things that can go wrong

- **"binary not found: binaries/heron-sidecar"** — the dev-sidecar wrapper
  binary is missing or named wrong. Rebuild it:
  ```bash
  cd app/dev-sidecar
  cargo build --release
  cp target/release/heron-sidecar.exe ../src-tauri/binaries/heron-sidecar-x86_64-pc-windows-msvc.exe
  ```
- **Rust compile errors** — `cargo update` in `app/src-tauri/` and try again
- **MSI bundling fails on Windows** — make sure WiX Toolset is installed.
  Tauri downloads it automatically the first time but it can hang. Run
  `cargo tauri build --verbose` to see what's stuck.

### Note on the bundled sidecar

The `binaries/heron-sidecar-x86_64-pc-windows-msvc.exe` is currently a
**Rust shim that shells out to `npx tsx src/index.ts`** in the dev
project root (`C:\Programming\Important Projects\deal-hunter`).

This means the installed Heron app will only work on **your machine** until
we replace the shim with a real compiled sidecar. Two paths to fix this:

- **Quick (works for personal use only)**: hardcode the project path in the
  shim. That's what's there now. Re-runs `npx tsx`. Fine for shipping to
  yourself; breaks for anyone else.
- **Proper (needed before sharing)**: get `bun build --compile` working
  for the sidecar (currently fails on `puppeteer-extra-stealth`'s
  `utils.forOwn` runtime issue — see commit `0caac9d` notes). Once that
  compiles, drop the resulting binary into `src-tauri/binaries/` and the
  shim disappears. Tauri bundles it as a real standalone exe.

For tonight's ship-to-yourself this is fine. Sharing requires fixing the
sidecar compile first.

## First-run setup on the installed app

The installer doesn't ship a default config. On first launch, Heron's
Dashboard shows the welcome card pointing to Settings.

1. **Settings → API keys** → fill in OpenRouter + Discord bot token + Discord user ID → Save
2. **Targets** — empty by default. Either:
   - Create new targets via the **+ New target** modal, OR
   - Copy a price-reference.yaml file you exported from dev (Settings →
     Data → Export target config) into `%APPDATA%\com.heron.app\config\price-reference.yaml`
3. **(Optional) Settings → Schedule** → flip the "Automatic runs" toggle
   on, pick an interval. The scheduler now persists across restarts so it
   actually respects the interval (no more "fires every time I open it").
4. **Dashboard → Run Now** to confirm everything works end-to-end

### Config dir reference

| OS | Path |
|---|---|
| Windows | `%APPDATA%\com.heron.app\` |
| macOS | `~/Library/Application Support/com.heron.app/` |
| Linux | `~/.config/com.heron.app/` |

Inside that dir:

```
config/price-reference.yaml   # your targets
.env                          # API keys (managed by Settings UI)
schedule.json                 # automatic-run config
scheduler-state.json          # persisted last_fired_at (don't edit)
data/seen_items.db            # SQLite history
logs/                         # date-stamped run logs
backups/                      # exports from Settings → Data → Export
```

### Code signing (skip for now)

Windows will show a SmartScreen warning ("Windows protected your PC") when
you run the unsigned .msi. Click "More info" → "Run anyway". This is fine
for personal use.

To get rid of the warning entirely you'd need a Windows Authenticode code-
signing certificate (~$200–$500/year from DigiCert, Sectigo, etc.). Defer
until you actually share the app with people who'd be confused by the
warning.

## Iteration workflow

Once you're running the installed app daily:

- **Dev mode for changes**: keep using `cd app && cargo tauri dev`. Dev
  mode points at the project root for config/data, so it stays totally
  separate from the installed copy's `%APPDATA%` state.
- **Test before shipping**: run `cargo tauri build` and install the
  resulting .msi over the previous version. The installer preserves the
  config dir, so your data + API keys carry across updates.
- **Bump version**: edit `app/src-tauri/tauri.conf.json` `version` field,
  then update `.vsig` (see next section).

## Update mechanism (the `.vsig` flow)

Heron checks `UPDATE_MANIFEST_URL` once per day on launch. When it sees a
newer version, the sidebar shows a small green dot next to the version
label. Click → modal with changelog + Download button → opens the GitHub
release page in browser → user downloads + runs the new .msi.

### One-time setup (you haven't done this yet)

1. Push this repo to GitHub (private or public, either works)
2. Edit `app/src-tauri/src/updater.rs` and set:
   ```rust
   pub const UPDATE_MANIFEST_URL: Option<&str> =
       Some("https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/.vsig");
   ```
3. Edit the placeholder `.vsig` at the repo root and replace
   `https://github.com/USER/REPO/releases/latest` with your actual
   release URL.
4. Rebuild the app — the next install gets the live update check.

### Per-release flow

When you ship a new version:

1. Code your changes, test in `cargo tauri dev`
2. Bump `version` in `app/src-tauri/tauri.conf.json` (e.g. 0.1.0 → 0.2.0)
3. Bump `version` in `app/package.json` to match (cosmetic but nice)
4. `cargo tauri build` → produces `Heron_0.2.0_x64_en-US.msi`
5. Create a GitHub release for the tag (e.g. `v0.2.0`), upload the .msi
6. Edit `.vsig` at the repo root to:
   ```json
   {
     "version": "0.2.0",
     "released": "2026-MM-DD",
     "notes": "- Multi-line changelog\n- Each feature on its own line\n",
     "download_url": "https://github.com/YOU/heron/releases/tag/v0.2.0"
   }
   ```
7. Commit + push the .vsig change. Live users will see the update prompt
   within 24h (or immediately if they relaunch / clear `localStorage`'s
   `heron-last-update-check` key).

### Why .vsig instead of Tauri's auto-updater

The built-in `tauri-plugin-updater` does one-click in-app updates, but
needs a signing keypair (separate from Windows code signing) and a tighter
release pipeline. Manual download is fine for ≤5 users; switch to the
built-in updater when you have actual users hitting the limits of the
manual flow.

## Troubleshooting

**"Run Now" does nothing in the installed app**

Check `%APPDATA%\com.heron.app\logs\` for the most recent log file. If the
sidecar is crashing on startup, you'll see Node.js errors there. Most
common cause: the bundled sidecar shim can't find `npx tsx` because
Node isn't on PATH for the user (Heron isn't running as your normal user
session, or PATH is different).

**Scheduler runs too often / not enough**

Check `%APPDATA%\com.heron.app\scheduler-state.json` — should contain
`{ "last_fired_at": <timestamp> }`. If missing, scheduler has no memory
of past runs and will fire on the next interval check (which means it
WILL run). If present and recent, the scheduler is correctly waiting.

**Existing data from dev mode doesn't show up**

The installed app uses `%APPDATA%\com.heron.app\` for its config dir,
not the project root. Copy `data/seen_items.db`, `config/price-reference.yaml`,
and `.env` from the project root over to that location to migrate.

**SmartScreen blocks the installer entirely (no "Run anyway" option)**

Group policy might be blocking unsigned MSIs. Either:
- Right-click the .msi → Properties → Unblock checkbox
- Or run via PowerShell: `msiexec /i "Heron_0.1.0_x64_en-US.msi"`

## Next steps after the first ship

In rough priority order:

1. **Fix the sidecar compile** so it works on machines other than yours
   (`puppeteer-extra-stealth` bundling issue with `bun build --compile`)
2. **Code-sign the .msi** if you decide to share more widely (~$300/year)
3. **Graduate to Tauri's built-in updater** for one-click updates
4. **Add a first-run wizard** that imports a starter config so new users
   don't have to copy YAML files manually
