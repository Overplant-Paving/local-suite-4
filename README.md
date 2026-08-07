# Local Suite 4

This is **Local Suite v4**, built on the verified v2/v3 single-file architecture. **v4.3.1** contains
**102 manifest tools** (103 generated pages) and hardens Optical Transfer with stage-relative square
QR rendering, deterministic sender/receiver teardown, bounded equation memory, accurate completion
states, safer reduced-motion pacing, current camera metrics, and stronger rendered-layout tests.

Current release: **v4.3.1** (2026-08-06). Release evidence is archived under
`tests/evidence/v4.3.1-release/`; v4.3.0 evidence remains under `tests/evidence/v4.3-release/`,
v4.2.0 evidence under `tests/evidence/v4.2-release/`, v4.0.0 evidence under
`tests/evidence/v4-release/`, and v3.0.0 evidence under `tests/evidence/v3-release/`.

**v4.1.0 was released and deployed on 2026-07-31.** It added **Flood Risk & Conditions**
(`flood.html`) as the 101st tool: one exact, explicitly confirmed U.S. point is screened against
FEMA's National Flood Hazard Layer, active NWS flood alerts, and nearby NOAA forecast gauges —
informational screening only, never a parcel or legal determination. Its deterministic and strict
live acceptance gates were green before deployment. Evidence: `tests/evidence/flood/` and
`tests/evidence/flood-feasibility/`.

**v4.2.0 added Optical Transfer** as the 102nd tool. Its sender works directly from `file://`; mobile
camera receive generally requires hosted HTTPS, and the installable PWA preserves that secure origin
for later offline use. See [OPTICAL-TRANSFER.md](OPTICAL-TRANSFER.md).

**v4.3.0 expands The Arcade** with Unicorn 42069er and Miner 42069er. All seven cards use exact
live Pages/source destinations, inlined locally stored art, truthful alternatives, keyboard-safe
external links, and deterministic file/hosted/mobile regression coverage.

**v4.3.1 hardens Optical Transfer** without changing its DCF2/LT wire format. It fixes desktop QR
distortion, stops hidden sender work, makes verification and mode-switch state deterministic,
rejects impossible QR tuning before streaming, refreshes live camera settings safely, bounds
equation buffers to 32 MiB, clarifies integrity versus authenticity, and respects reduced motion.

**To use the suite: open [`dist/index.html`](dist/index.html).** Everything in `dist/` is
built and self-contained — double-click any file there. The `tools/` folder holds the
*sources*, which don't link up until `python3 build.py` runs.

## What Local Suite is

A family of 102 **single-file HTML tools** — weather station, earthquake monitor, flight tracker,
calculator workbench, recipe box, periodic table, DNS lookup, arcade — plus a hub page that maps
them all, with favorites and recently-used quick access. The philosophy (unchanged in v4):

- **One `.html` file per tool.** No framework, no npm, no runtime dependencies. Copy it anywhere,
  double-click it, it works.
- **Free, open data — government sources first.** NOAA, USGS, NASA, BLS, FDA, Treasury. Keyless
  and CORS-open wherever possible.
- **No tracking, no ads, no accounts.** The only requests a tool makes are to its data source.
  Many tools make *zero* requests.
- **Pleasant and calm.** Readable typography, light/dark aware, graceful "data unavailable" states.
- **Remembers politely.** Preferences and named locations live in `localStorage` under the
  `suite.*` namespace — nowhere else.
- **Just works, easily shared.** The suite's defining goal: hand anyone the files (or a link) and every
  tool functions with zero setup — no accounts, no keys required for the core experience, no
  configuration steps.

## Sharing the suite

Two supported ways, both zero-setup for the recipient:

1. **Send the files.** `dist/` is self-contained — copy the folder (or a single tool's file) to a
   USB stick, a network share, an email attachment. Double-click and it works.
2. **Share a link.** Deploy `dist/` to any static host (GitHub Pages is the documented free path,
   set up in Phase 3). Recipients get the same suite at a URL, plus the installable PWA.

**Hosted v4:** <https://overplant-paving.github.io/local-suite-4/> (v3 remains at
<https://overplant-paving.github.io/local-suite-3/>)

The 4 tools whose data sources block browser scripts stay simple: the two BLS tools (inflation,
jobs) show monthly numbers embedded at build time, and airport/custom-transit show a clean card
linking straight to the source's own website. Nothing needs setup, hosting, or accounts — see
[API-AND-RELAY.md](API-AND-RELAY.md) §4–5.

## Why the v2 architecture still matters

v1 (in `../Local Suite`) is a disciplined, high-quality build — but it was produced in one shot,
outside version control, with every shared piece copy-pasted per file. The audit that preceded
this plan found:

| | v1 | v2 |
|---|---|---|
| Version control | none — `.git` is an empty stub; git resolves to the **home directory** repo | real repo rooted here, v1 imported as a tag |
| Shared theme/chrome | byte-identical CSS block hand-copied into 55 files; ~60–90 duplicated lines × 70 files | `core/suite.css` + `core/suite.js`, inlined at build time |
| Hub (`index.html`) | hand-maintained 71-entry `TOOLS` array | generated from `manifest/tools.json` |
| Fetch/cache helpers | re-implemented per file (`getJSON` vs `fetchWithTimeout`) | one `Suite.fetchJSON()` with timeout + cache envelope |
| CORS-blocked tools (airport, jobs, inflation, transit-custom) | ship broken `.example` placeholder URLs | BLS numbers embedded at build; airport/transit link out to the source's own site |
| Offline story | zero-network tools + stale-cache fallback | same, **plus** installable PWA when served over http |
| Security hardening | no CSP, two inline handlers | build-generated per-file CSP with script hashes |
| Backup | per-tool export in 2 of 71 tools; focus.html can silently lose data | suite-wide backup/restore in a new `settings.html` |
| Accessibility | sparse ARIA (24/72 files) | checklist-driven sweep; shared chrome fixed once in core |

**The single-file contract is preserved**: every built tool in `dist/` is still one
self-contained, double-clickable HTML file. The only new tooling is one dependency-free
`build.py` (Python stdlib) that inlines the shared core into each tool.

## Target repo layout

```
Local Suite 4/
├── README.md · ROADMAP.md · ARCHITECTURE.md · MIGRATION.md
│   API-AND-RELAY.md · PWA.md · QUALITY.md · CATALOG.md   ← planning + reference docs
├── build.py                  # the entire toolchain, Python stdlib only
├── manifest/
│   └── tools.json            # single source of truth for every tool
├── core/
│   ├── suite.css             # theme + reset + shared chrome
│   ├── suite.js              # the Suite namespace (theme, fetch, store, esc, …)
│   └── icons/                # PWA icons
├── tools/                    # SOURCE: valid, runnable HTML files (edit these)
│   ├── index.html            # the hub
│   └── weather.html …
├── relay/
│   └── worker.js             # Cloudflare Worker template (opt-in)
├── dist/                     # BUILT: self-contained double-clickable files (committed)
└── tests/                    # smoke suite + gate fixtures + per-tool evidence (required to ship)
```

## Quickstart (once built)

```
# Use the suite: open dist/index.html — that's it. Double-click works.

# Develop: edit tools/*.html (they run as-is from file:// via relative core links)
python3 build.py            # inline core into dist/
python3 build.py --check    # validation gates (run before committing)
python3 build.py --serve    # local server → PWA mode at http://localhost:8000
python3 build.py --new foo  # scaffold a new tool + manifest entry
```

### Favorites and recently used (v4)

Every tool page grows a ☆ star next to its theme button, and the hub shows a ★ Favorites
section plus a 🕘 Recently used row (deduplicated, most-recent-first, bounded at 10, with a
clear button). Both live in `localStorage` (`suite.hub.favorites`, `suite.hub.recents`), stay in
sync across tabs, and ride along in Settings backup/restore like every other `suite.*` key.

### The Arcade (v4; expanded in v4.3.0)

`dist/arcade.html` is a launcher for seven browser games from this suite's own workshop —
Bathhouse Brigade (desktop + mobile editions), Chromatic Chains (desktop + mobile editions),
the DOOM 1993 shareware episode in an emulator, Unicorn 42069er: The Sprinkle Mines, and Miner
42069er. Every card links to a live GitHub Pages deployment; the card art is copied from the game
repositories and inlined at build time (provenance: `assets/arcade/PROVENANCE.md`).

### National Parks Explorer setup

`dist/parks.html` uses a free personal National Park Service API key. Save it under
**Settings → API keys → NPS**. The key stays in `suite.key.nps` in that browser and requests use the
safer `X-Api-Key` header rather than a URL query parameter.

The explorer groups every documented NPS resource into Overview, Alerts, Plan a visit, Explore,
Learn, Media, and Reference tabs. A lightweight park directory is cached for 30 days, while the
selected park's hours, contacts, weather guidance, and other details refresh on their own two-hour
identity and display the actual fetch/cache timestamp. Resource pages have Next/Previous controls
(including the Events API's separate page-number dialect), endpoint-specific facts, and visible
stale states. Road and boundary GeoJSON is rendered with a textual geometry/bounds equivalent;
large boundary geometry stays an explicit on-demand request and is not stored.

The NPS default allowance is 1,000 requests per rolling hour. Calls within a tab are queued so a
401/403 or 429 suppresses the remaining requests; 429 cooldown and exposed rate headers are shown
without discarding already successful/cached sections. The official Swagger inventory and a
conservative live-key probe both verified all 29 resources on July 30, 2026.

### Flight Tracker setup

`dist/flight.html` uses a personal Aviationstack API key. The provider's account form requires the
account owner to supply their own identity, credentials, and acceptance of third-party terms, so
Local Suite does not create that account or ship a shared key.

1. Follow **Create a key** on the Flight Tracker page.
2. Open **Settings → API keys** and save it under **Aviationstack**.
3. Return to Flight Tracker and search using the two-character public airline code, flight number,
   and service date (for example, `AA100`).

The key remains in local browser storage as `suite.key.aviationstack` unless the user deliberately
exports a Settings backup; do not commit or share it. The personal tier has a small request
allowance, so automatic refresh defaults to off and stops at a local 80-request monthly safety threshold.

## Doc map — read X when doing Y

| Document | Read it when… |
|---|---|
| [ROADMAP.md](ROADMAP.md) | deciding what to do next; tracking phase status |
| [ARCHITECTURE.md](ARCHITECTURE.md) | building `build.py`, `core/`, or the manifest; any design question (ADRs D1–D9) |
| [MIGRATION.md](MIGRATION.md) | porting a v1 tool — the recipe, the batch plan, and the 71-row burn-down table |
| [API-AND-RELAY.md](API-AND-RELAY.md) | anything network: source policy, keys, rate limits, CORS-blocked sources |
| [PWA.md](PWA.md) | the service worker / installable layer (Phase 3) |
| [QUALITY.md](QUALITY.md) | security, accessibility, testing, and the release checklist |
| `CATALOG.md` (carried from v1) | the human-readable per-tool endpoint narrative with CORS verification dates |

## Non-goals / preserve list

These are deliberate constraints. Every doc assumes them; don't relitigate casually.

1. **Design language stays.** Warm-paper light / dark-slate dark, teal accent, the exact CSS
   variable names and 3-layer theming (`color-scheme` / `prefers-color-scheme` / `data-theme`).
   `core/suite.css` is an *extraction*, not a redesign.
2. **localStorage conventions stay.** `suite.*` namespace, shared `suite.location`, `{t,v}` cache
   envelope, `suite.key.<name>`. v2 reads v1 data unchanged — user data survives the swap.
3. **Single-file outputs, forever.** Every `dist/*.html` is self-contained and double-clickable.
4. **Keyless-first API policy.** The ~40 keyless government/public sources and the good-citizen
   caching rules stay canonical.
5. **CATALOG.md keeps its role** — human prose + verification dates; the manifest is machine truth.
   The build cross-checks them; neither replaces the other.
6. **Justified large files are a feature.** The EFF wordlist embedded in password.html and the
   offline dictionaries make tools work with zero network. They stay inline.
7. **Tool simplicity.** Per-tool source is markup + layout + logic, readable top-to-bottom in one
   sitting. The only shared abstraction is the `Suite` namespace.
8. **No frameworks, no bundlers, no CI server.** One Python script is the whole toolchain — but
   the quality gates it enforces (static checks with negative tests, the Playwright smoke suite,
   per-tool verification evidence) are mandatory for shipping, not optional extras.

## Development model

**This project is developed by Claude** (Fable 5 or later) operating agentically in Claude Code,
with the user directing scope and reviewing outcomes. The plan is written for that developer:
phases carry dependency-ordered hard exit gates instead of time estimates, independent work fans
out to parallel subagents, and every claim of "done" is backed by archived evidence
(screenshots, live-fetch records, gate output) rather than assertion. See the standing rules at
the top of [ROADMAP.md](ROADMAP.md).
