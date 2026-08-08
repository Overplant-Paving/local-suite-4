# ROADMAP.md — phased execution plan

**Developer: Claude (Fable 5 or later), operating agentically in Claude Code.** Phases are ordered
by dependency and risk isolation, not by human effort — there are no time estimates because none
are meaningful. Each phase defines entry conditions, the work, and **hard exit gates**: a phase is
not done until every gate passes with evidence (command output, screenshots, live-fetch results),
and no gate is skippable by judgment call. Specs live in [ARCHITECTURE.md](ARCHITECTURE.md); the
per-tool playbook and burn-down table live in [MIGRATION.md](MIGRATION.md); the quality bar is
[QUALITY.md](QUALITY.md) — read all three before executing any phase.

Standing rules for the executing agent:

1. **Nothing ships unverified.** "It should work" is not a state. Every tool gets opened, exercised,
   and screenshot-compared before its box is ticked.
2. **Parallelize the independent; serialize the risky.** Tool migrations fan out to subagents in
   batches; core/`build.py` changes are single-threaded and land before anything that depends on them.
3. **The gates are the authority.** If `build.py --check` and this roadmap disagree, fix the
   disagreement before proceeding — never route around a failing gate.
4. **v1 is the reference implementation.** Every migrated tool is diffed against its v1 original
   (`v1-import` tag) for behavior and design parity.
5. **Update the burn-down table and this status block in the same commit as the work.**

## Current status

- [x] Analysis of v1 complete (architecture + quality/risk audits, July 2026)
- [x] Planning document set written
- [x] Version-control hazard fixed during the original migration; historical v1 parity evidence is archived under `tests/evidence/`
- [x] Phase 0 — Foundation (2026-07-15 — evidence: `tests/evidence/phase0/gates.txt`)
- [x] Phase 1 — Core machinery, proven on pilots (2026-07-15 — 3 pilots at Definition of Done; CSP verdict: full hashes, all 3 browsers, recorded in ARCHITECTURE D6 addendum; evidence: `tests/evidence/{focus,weather,index,phase1}/`)
- [x] Phase 2 — Full migration: 71/71 migrated 2026-07-16 with green gates and archived parity evidence. The planned sibling-repository archive note never landed; that repository and the `v1-import` object are not present in this clone, so this is recorded as historical provenance rather than an open v3 release gate.
- [x] Phase 3 — PWA + sharing: generated service worker, webmanifest and icons; file parity, offline matrix, update path and headed Chromium installability verified. V3 Pages is live at <https://overplant-paving.github.io/local-suite-3/>. Evidence: `tests/evidence/phase3/` and `tests/evidence/v3-release/`.
- [x] Phase 4 — Suite-wide audit: Settings, CSP, escaping, accessibility and full smoke evidence completed. The planned `v2.0` tag was never created and is superseded, not backfilled.
- [x] V3 foundation — multiple saved locations, Flight Tracker and the 29-resource National Parks Explorer complete with focused and full-suite evidence.
- [x] **Local Suite v3.0.0 — first formal release, 2026-07-25.** Release checklist: `tests/evidence/v3-release/release-checklist.md`.
- [x] Guided API-key setup in Settings (2026-07-25) — provider-ordered wizard, `suite.profile.*`
  form-fill, paste routing, and a live per-key check; one api.data.gov signup now fills the NASA,
  Congress.gov and USDA FoodData rows after each provider verifies the key. Settings becomes
  `"network": "keyed"` (requests only on click). Signup itself stays manual by design — see
  API-AND-RELAY.md §3. Evidence: `tests/evidence/settings/keysetup/`, gate:
  `node tests/settings-keysetup.mjs`.
- [x] Color Studio photo palette fixed (2026-07-25) — "colors from a photo" had been broken since
  CSP went suite-wide in Phase 4: `color.html` set an `<img>` src to `URL.createObjectURL(file)`,
  and the generated `img-src 'self' data:` refuses `blob:` URLs, so every valid photo fell into the
  "Could not read that image" handler in **both** `file://` and hosted mode. Now decoded with
  `createImageBitmap`, which is not an image-source fetch and leaves the canvas untainted — no CSP
  change, no `core/` change. The smoke suite only asserts zero console errors *on load*, which is
  why an after-interaction violation went unseen; the new focused test closes that blind spot and
  was confirmed to fail against the pre-fix build (12 assertions, both modes) before passing against
  the fixed one. Evidence: `tests/evidence/color/csp-blob/`, gate: `node tests/color-photo.mjs`.
- [x] Meteor Patrol retired (2026-07-25) — the parked v1 arcade prototype and the `games` hub
  category are removed rather than finished, converting Phase 4 item 5's holding state ("finish or
  park") into a final answer. The hub's work-in-progress card and `CAT_LABEL.games` are gone;
  `.card.wip` stays because the un-built source-hub guard still uses it. Games reopen only with a
  purpose-built toy at full Definition of Done. Evidence: `tests/evidence/games-retire/`.
- [x] Automatic first location (2026-07-25) — the suite already shared one location; now it acquires
  the first one itself via browser geolocation (no network request, no CSP change), at the hub and
  in all 23 location tools, with a Settings toggle (`suite.location.auto`) and a remembered refusal.
  See ARCHITECTURE.md §6.1. Evidence: `tests/evidence/location-auto/`, gate:
  `node tests/location-auto.mjs`.

## Overview

| Phase | Goal | Hard exit gate |
|---|---|---|
| 0 | Repo + skeleton | `--check` green on empty manifest; toplevel verifies; v1 imported as reference tag |
| 1 | Core + generator proven end-to-end | 3 pilots pass the full per-tool Definition of Done, incl. CSP verdict across 3 browsers |
| 2 | All 71 tools migrated | 71/71 pass Definition of Done; zero placeholder URLs; parity evidence archived |
| 3 | PWA + GitHub sharing | repo on GitHub, Pages link works from a fresh profile; installed PWA verified offline; file:// byte-identical |
| 4 | Suite-wide audit | every QUALITY.md checklist passes with evidence; smoke suite green on all 72 files; tag `v2.0` |

---

## Phase 0 — Foundation

**Goal:** a correct repository and a skeleton that builds.

Context: the original hazard (empty `.git` stubs resolving to an accidental home-directory repo)
was fixed on 2026-07-15 — v1 now lives in a real repo at `../Local Suite` (`main`, commit
`7088cab`). This phase sets up **this** folder.

Work:
1. `git init -b main` in `Local Suite 2`. **Gate:** `git rev-parse --show-toplevel` prints this
   folder. Add `.gitignore` (OS junk, `tests/node_modules/`).
2. Import v1 as the reference baseline: `git fetch ../Local\ Suite main` → tag it `v1-import`.
   Every migration diff in Phase 2 is reviewed against this tag.
3. Commit the planning docs.
4. Skeleton: `build.py` (arg parsing, all gate stubs failing loudly as "not implemented" rather
   than passing vacuously), `core/suite.css` + `core/suite.js` (empty), `manifest/tools.json`
   (`schemaVersion: 2`, empty `tools`), `tools/`, `dist/`, `tests/`.

**Exit gates:** toplevel correct · `v1-import` tag resolves and contains all 175 v1 files ·
`python build.py --check` runs and reports its own unimplemented gates explicitly · all committed.

---

## Phase 1 — Core machinery, proven on pilots

**Goal:** every piece of shared machinery implemented and proven on three real tools **before**
the 71-tool fan-out. This phase is deliberately serialized — it is the foundation everything else
builds on, and quality here multiplies across every later file.

Work:
1. **`core/suite.css`** — extract from the byte-identical v1 theme block (canonical:
   `weather.html:8–70` at `v1-import`) + reset + font stack + shared chrome + focus-visible +
   `prefers-reduced-motion`. Verify extraction correctness by diffing rendered computed styles of
   a pilot against its v1 original in both themes, not by eyeballing.
2. **`core/suite.js`** — the complete `Suite` namespace per ARCHITECTURE.md §3. Every public
   function gets exercised by at least one pilot; no dead API surface ships.
3. **`build.py`** — complete: inlining, hub marker injection, every `--check` gate implemented
   (no stubs remain), `--new`, `--serve`. The escaping heuristic and all fatal gates get negative
   tests: deliberately broken fixture inputs that must fail the check (see QUALITY.md §3).
4. **Pilots** (full [MIGRATION.md](MIGRATION.md) recipe + Definition of Done each):
   - `focus.html` — offline, storage-heavy; **includes adding its missing export/import** (the
     known data-loss risk; fixed at first touch, not deferred).
   - `weather.html` — canonical fetcher; proves `Suite.fetchJSON` against live NWS, including the
     stale-cache offline path (verified by exercising it, e.g. blocking the network).
   - `index.html` — the hub; proves manifest-driven generation with a 3-entry manifest.
5. **CSP verdict** — the generated hash-based CSP tested on all three pilots in Chrome, Edge, and
   Firefox **from `file://`**. Record the verdict (full hashes / per-file fallback) as an
   addendum to ADR D6 in ARCHITECTURE.md. This decision blocks Phase 2's template.

**Exit gates:** 3 pilots pass the per-tool Definition of Done (QUALITY.md §4) with parity evidence ·
`--check` fully implemented with negative tests passing · CSP verdict recorded · `Suite` API 100%
exercised by pilots.

---

## Phase 2 — Full migration, parallel batches

**Goal:** all 71 tools through the recipe at pilot quality. Batches group by risk class so that a
shared defect surfaces in the first batch of its class, not the last; **within a batch, tools are
independent and migrate in parallel** (fan out to subagents; one tool = one subagent task = one
reviewed commit).

- **Batch A — zero-network (21 tools).** Simplest class; validates the recipe at scale before the
  fetch-dependent classes. Full interaction verification per tool (offline tools have no "it
  fetched, good enough" shortcut — exercise the actual feature: generate the password, run the
  timer, draw the QR).
- **Batch B — CORS-open fetchers (33 tools).** Every fetch converges on `Suite.fetchJSON`. Per
  tool: one **live** fetch verified + the stale-cache offline path verified. `cacheTtlMin`
  declared per source class (API-AND-RELAY.md §2).
- **Batch C — keyed, CORS-blocked, rate-limited (12 tools).** `Suite.key()` for apod, nutrition,
  congress, gas, parks, markets (live-verified with demo keys where a demo tier exists; with a
  real key where the user has one; otherwise the no-key UX path is what gets verified — it must
  be a designed state, not an error state). The 4 formerly-broken tools get their simple fixes
  (API-AND-RELAY.md §5): jobs + inflation embed monthly BLS numbers via `--refresh-data`;
  airport + custom transit get link-out cards (**embedded data and link-out cards are first-class
  UI states, verified like any feature**). BART key externalized (v1 `transit.html:163` →
  `suite.key.bart`).
  Rate-limited feeds (launches, markets, nearby, apod) get TTL + backoff, verified by simulating
  a 429.
- **Batch D — large-embedded-data specials (3 tools: password, word, passes).** The 62 KB EFF
  wordlist line, the embedded dictionary, and the SGP4 math must survive the build **byte-exact**
  (assert by extracting and hashing the data segments pre/post build, not by spot-checking).

**Exit gates:** 71/71 rows ticked in the burn-down table, each with Definition of Done evidence ·
zero `.example` URLs anywhere in dist (`--check` greps for it) · `--check` green · every commit
diffed against `v1-import` · v1 folder declared read-only archive (note added to its README/hub).

---

## Phase 3 — PWA + GitHub sharing

**Goal:** the repo goes on GitHub, Pages serves it, and the served mode is installable.
Spec: [PWA.md](PWA.md), [API-AND-RELAY.md](API-AND-RELAY.md).

Work:
1. `build.py` emits `dist/sw.js` (precache from manifest, content-hash cache name) +
   `dist/manifest.webmanifest`. Icons produced in `core/icons/` per the suite design language.
2. Protocol-gated registration wired in `Suite`. **Gate:** dist output opened from `file://` is
   **byte-identical** to the pre-PWA build except for the registration block itself (assert by
   diff, not assumption).
3. Install verified on Chrome and Edge: standalone launch, per-tool deep link, and the ~21
   zero-network tools exercised with the network fully disabled after install.
4. **Push to GitHub, enable Pages on `dist/`** (needs the user's GitHub account once — flag when
   reached). Optionally add the one-line scheduled Action that re-runs `--refresh-data` monthly
   for the BLS numbers.
5. **Sharing story verified:** open the Pages link in a fresh browser profile — everything works,
   install prompt appears, zero setup.

**Exit gates:** offline matrix (PWA.md §4) verified row by row · shared-link path verified from a
fresh profile · zero file:// regressions (diff evidence) · SW update path verified (build →
reload → new content within one reload).

---

## Phase 4 — Suite-wide audit → v2.0

**Goal:** every checklist in [QUALITY.md](QUALITY.md) passes with evidence across all 72 files.
This is an audit phase, not a cleanup phase — most items were done at migration time; this phase
**proves** it and catches drift.

Work, in order:
1. **`settings.html`** — new tool, built to the same Definition of Done: suite-wide backup/restore
   (round-trip verified: export → wipe a scratch profile → import → all `suite.*` keys identical),
   key manager, relay config + live test, theme/location, storage viewer, cache purge.
2. **CSP suite-wide** — per the Phase 1 verdict, emitted for all files; `--check` proves hashes
   match on every file.
3. **Accessibility audit** — the full QUALITY.md §2 checklist per tool, executed and recorded
   (icon-button labels, `Suite.liveRegion` on every async region, keyboard paths, contrast in both
   palettes). Migration-time a11y work gets re-verified here, not trusted.
4. **Escaping audit** — line-by-line review of the 5 flagged files (factbook, art, dictionary,
   word, wiki) plus a suite-wide re-run of the interpolation heuristic; every flag resolved as
   fixed or "verified clean" with the reasoning recorded in the burn-down table.
5. **Games** — `games` category added to manifest/hub; meteor-patrol either brought to suite
   quality (missing sprites completed via the forge pipeline, theme integrated) or explicitly
   parked with a "work in progress" card in the hub — a deliberate state, not a loose end.
6. **Smoke suite** — `tests/smoke.mjs` (Playwright) run against **all 72 dist files**: zero
   console errors, chrome renders, theme toggle flips, offline card renders under fetch-block.
   This is mandatory, not optional (QUALITY.md §3).
7. Release checklist (QUALITY.md §5) executed; tag **`v2.0`**.

**Exit gates:** smoke suite green 72/72 · all QUALITY.md checklists pass with recorded evidence ·
release checklist executed · tag pushed.

---

## V3 work

- [x] Multiple saved locations — named collection in `suite.locations`, active
  `suite.location` compatibility mirror, Settings manager, hub switcher, v2 migration, storage
  failure feedback, and cache-safe active switching. Focused contract test + Settings/hub
  interactions + 73/73 smoke green; evidence: `tests/evidence/v3-multiple-locations/`.
- [x] Individual Flight Tracker — dated flight lookup, provider status/ETA, last-known world-map
  position, telemetry, stale-cache handling, deep links, rate-conscious refresh, Settings key
  integration, Airport-page link, deterministic provider/error/offline tests, responsive evidence,
  and 74/74 smoke coverage under `tests/evidence/flight/`.
- [x] Live keyed flight verification — user-authorized Aviationstack request plus Airplanes.live
  ADS-B position fallback returned HTTP 200 from both providers under built `file://`; a live JL80
  instance rendered route, ETA, coordinates, map, and fresh position with zero console errors.
  No key or account credential is committed.
- [x] National Parks Explorer — expanded the original alert watcher into a park-centered interface
  covering all 29 documented NPS API resources across Overview, Alerts, Plan a visit, Explore,
  Learn, Media, and Reference tabs. Uses `X-Api-Key` header authentication, lazy resource groups,
  endpoint-specific caching, stale/offline labels, deep links, watched parks, gallery-scoped assets,
  and on-demand handling for three currently failing upstream services. Deterministic 29/29
  endpoint coverage, responsive evidence, built `file://` live-key verification, and zero console
  errors on the 26 healthy live resources are recorded under `tests/evidence/parks/` and
  `tests/evidence/v3-nps-explorer/`. No key is committed.

## V4 work

- [x] **Local Suite v4.3.2 — Audio Transfer beta, 2026-08-08.** Added Audio Transfer as the 103rd
  manifest tool and placed it in the new **Beta Tools** hub category. The self-contained page sends
  arbitrary binary files speaker-to-microphone using audible C0/R1 BPSK OFDM, bounded deterministic
  robust-soliton fountain equations, CRC32C, repeated identity packets, and SHA-256-gated download.
  Hosted/PWA receive uses microphone permission; sender payload bytes never use a network or relay.
  Gates: `node tests/audio-built.mjs`; explicit same-room hardware gate: `node tests/audio-physical.mjs`.

- [x] **Local Suite v4.3.1 — Optical Transfer hardening, 2026-08-06.** Corrected desktop and
  responsive QR geometry with stage-relative square sizing; stopped hidden sender work; reset
  receiver state on mode changes; made verification, invalid UTF-8, and failure progress accurate;
  rejected impossible QR/ECC combinations early; guarded asynchronous camera-setting updates;
  bounded equation buffers to 32 MiB; clarified integrity versus sender authenticity; added
  reduced-motion pacing and vendor hash checks; and expanded focused rendered-layout/lifecycle
  regressions. Release evidence: `tests/evidence/v4.3.1-release/`.

- [x] **Local Suite v4.3.0 — Arcade expansion, 2026-08-06.** Expanded The Arcade from five to
  seven verified browser games with Unicorn 42069er: The Sprinkle Mines and Miner 42069er. Added
  exact live Pages/source destinations, repository-derived optimized/inlined card art with exact
  provenance, truthful image alternatives, stronger destination/alt regression coverage, and
  desktop/mobile visual evidence. Release evidence: `tests/evidence/v4.3-release/` and
  `tests/evidence/arcade-2026-08-06/`.

- [x] **Local Suite v4.2.0 — Optical Transfer, 2026-08-02.** Released as the 102nd manifest tool:
  one self-contained Send/Receive page with DCF2 containers, deterministic LT
  fountain recovery, inlined QR encoder and ZXing-WASM worker, SHA-256-gated completion, bounded
  hostile-input handling, honest mobile HTTPS/PWA behavior, focused deterministic tests, and MIT
  provenance. Architecture: `OPTICAL-TRANSFER.md`; feature evidence: `tests/evidence/optical/`;
  release evidence: `tests/evidence/v4.2-release/`.

- [x] **Local Suite v4.1.0 — Flood Risk & Conditions, released 2026-07-31.** Implemented,
  built and green on both its deterministic gate and the strict live acceptance gate
  `tests/flood-live-accept.mjs`, which returned the recorded New Orleans result (zone X,
  `SFHA_TF=F`, a drawn footprint, zero CSP/console errors). Deployed to GitHub Pages from commit
  `8fa73f1`. New `flood.html` (101st manifest
  tool; 102 generated pages; `RELEASE_TOOL_COUNT` raised with the count gate reworded generically).
  One exact, explicitly confirmed U.S. point is screened against FEMA NFHL layer 28 (limited
  fields, simplified containing polygon + inline SVG footprint with a text equivalent and
  approximate edge distance), FIRM panels/LOMRs (only after zone data exists, panels matched by
  `DFIRM_ID`), the layer 0 availability fallback (only on an empty zone answer), NWS point flood
  alerts, and a bbox-bounded NWPS gauge list ranked flood-category-first. Two-step
  Census-match-then-confirm address flow; tool-local `suite.flood.target` (never the shared suite
  location); generation-token race handling with a single retry after an unrelated cross-tab
  suite-location abort; independent bounded per-source caches; no risk score, no "safe" wording,
  no export/neighborhood/unbounded/history requests by construction. Plan: `FLOOD-TOOL-PLAN.md`.
  Upstream evidence: layers 28/3/1 returned HTTP 200 with ArcGIS 400 bodies during an earlier
  bounded shape-by-shape probe (`tests/evidence/flood/fema-outage-2026-07-31.md`). Layer 28 recovered
  during final acceptance and produced the expected classification/geometry. One recovery run
  rendered panel/LOMR failures independently; the final rerun loaded those enrichments too.
  Evidence: `tests/evidence/flood-feasibility/live-probe.md` + `tests/evidence/flood/`. Gates:
  `node tests/flood-built.mjs` + `node tests/verify-tool.mjs flood` (both wired into the Pages
  workflow), plus the release-blocking `node tests/flood-live-accept.mjs`. Live outage capture is
  the separate, non-asserting `node tests/flood-live-run.mjs`.
- [x] **Local Suite v4.0.0 — 100 tools, 2026-07-30.** Release checklist:
  `tests/evidence/v4-release/release-checklist.md`.
- [x] Suite-wide favorites + recently used — `suite.hub.favorites` / `suite.hub.recents`, chrome
  star injected from core beside every theme button, hub Favorites/Recently-used sections with
  cross-tab sync, bounded deduped recents excluding the hub and Settings, unknown-id tolerance.
  Gate: `node tests/favorites-recents.mjs`.
- [x] Flight Tracker live weather map — regional map combining the aircraft position with an
  Open-Meteo precipitation grid, NWS SIGMET hazard outlines (with the aviation feed's [lat, lon]
  ring order corrected), decoded departure/arrival METARs, and an arrival-hour outlook; world
  view retained; all weather surfaces keyless + CORS-open with per-panel stale stamps.
  Aviationstack request-safety, quotas, and cache identities unchanged. Gate:
  `node tests/flight-built.mjs` + `node tests/verify-tool.mjs flight`.
- [x] National Parks Explorer re-audit — official swagger still documents exactly 29 resources
  (none added/renamed/removed); conservative live probe: 29/29 HTTP 200
  (`tests/evidence/v4-release/nps-live-probe.txt`). `/events` and `/roadevents` recovered
  upstream and now load with their tab; WZDx `core_details` unwrapped; boundary GeoJSON stays
  on-demand (190–315 KB, never cached to browser storage) and is now drawn as an outline map
  with a textual geometry/bounds equivalent. The 30-day directory is separated from two-hour
  selected detail, both pagination dialects have practical controls, resource-specific fields are
  visible, and 401/403/429 stop the queued tab fan-out. Gates: `node tests/nps-schema-inventory.mjs`
  + `node tests/parks-built.mjs` + `node tests/verify-tool.mjs parks`.
- [x] The Arcade — seven owned games (expanded in v4.3.0; Bathhouse Brigade desktop/mobile,
  Chromatic Chains desktop/mobile, DOOM 1993 shareware, Unicorn 42069er, Miner 42069er), with every
  card linking to a live-verified GitHub Pages deployment, art copied from the game repos (DOOM:
  screenshot of its own deployment, credited
  to id Software), optimized and inlined at build time via the new `data-suite-asset` marker.
  Games category reopened. Gate: `node tests/arcade-built.mjs`.
- [x] 26 further v4 tools (manifest 100 total): offline — calc, hash, checklists, image, ics,
  typing, metronome, periodic, body, savings, budget, recipes, fuellog, healthlog, skyevents;
  keyless CORS-open (all re-verified 2026-07-30) — dns, overhead, spending, rhymes, cite,
  weatherhistory, tropical, discussion, nasaimages, worldbank, wayback. Each at the full
  Definition of Done with `tests/interactions/<id>.mjs` evidence.

## After v3.0.0 (backlog, unscheduled)

> **v4 note:** the Tier 1 and Tier 2 card candidates below (calc, hash, checklists, image, ics)
> shipped in v4.0.0, with the Tier 3 fold-ins landing as calc modes. The Data Workbench upgrade
> to `dataviewer.html` and the spike-gated QR read tab remain open backlog.

**Next utilities — ranked candidate slate (2026-07-25).** Every entry is a candidate, not a
commitment; each is written up in `CATALOG.md` §10 marked *proposed (not built)*, and each is
zero-network, so it needs no key, no endpoint, and no stale-cache path. Ranked by size of the
verified gap, then everyday frequency, then whether it reaches the Definition of Done with no new
`core/` API, then implementation risk. Building one means `python3 build.py --new <id>` plus the
same Definition of Done (QUALITY.md §4) as any migrated tool.

- **Tier 1 — build first.** 10.14 Calculator & Percentage Workbench (`calc.html`) · 10.15 File
  Integrity & Hash Desk (`hash.html`) · 10.16 Checklist & Routine Tracker (`checklists.html`).
  Each closes a verified gap: no arithmetic surface exists anywhere in 73 tools; `text.html` hashes
  text but has no file path at all; nothing holds a reusable list that resets.
- **Tier 2 — strong, one real risk each.** 10.17 Image Toolbox (`image.html` — must use
  `createImageBitmap`, not `blob:` image URLs) · 10.18 Calendar / ICS Maker (`ics.html` — an
  unforgiving format that fails silently downstream) · Data Workbench as an **upgrade to
  `dataviewer.html`**, not a second card (CATALOG 10.7).
- **Tier 3 — fold into existing tools, no new cards.** Number base & bitwise desk, duration and
  timesheet math, and unit-price comparison as `calc.html` modes; a regex tester as a fourth tab in
  `text.html` (CATALOG 10.3).
- **Spike-gated.** A "read" tab for `qr.html`: prove `getUserMedia` works from `file://` in Chrome
  *and* Firefox before any design work, and drop it outright if it needs hosting (CATALOG 10.2).
- Constraints that shape all of the above, verified against built `dist/` files under `file://`: no
  `eval`/`new Function` (sha256-pinned `script-src`), no Web Workers, no `blob:` images under the
  generated `img-src 'self' data:`. Object-URL downloads are unaffected.

**Games.** Reopened in v4 with The Arcade (see V4 work above). The Meteor Patrol retirement
stands; any future in-suite game is still held to the full Definition of Done.

- Periodic CATALOG endpoint re-verification sweep (verification dates are part of the contract;
  the USGS legacy water API sunset ~Q1 2027 is already flagged).
