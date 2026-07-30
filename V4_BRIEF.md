# Local Suite v4 implementation brief

You are the primary implementation agent. Work directly in this repository. This checkout is based on `Overplant-Paving/local-suite-3`; `upstream` remains v3 and `origin` is the new empty `Overplant-Paving/local-suite-4` repository. Do not commit, push, create releases, change remotes, expose secrets, or weaken fatal gates. Hermes will independently inspect, test, commit, and publish.

## Required outcome

Ship a polished Local Suite **v4.0.0** that preserves the existing no-framework, local-first, single-file `file://` contract and has **exactly 100 manifest tools** (plus the generated hub). V3 has 73, so add exactly 27 genuinely useful complete tools/pages, counting the new Arcade as one. Do not use placeholders, duplicated mini-variants, fake live data, or cards that merely link elsewhere except where a source inherently cannot be consumed in-browser and the existing policy permits a clearly labeled official-source handoff.

Read `CLAUDE.md`, `README.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `MIGRATION.md`, `API-AND-RELAY.md`, `PWA.md`, `QUALITY.md`, the manifest, relevant tools, build logic, and tests before changing code. Update all v3 naming, release metadata, URLs, PWA metadata, docs, generated artifacts, and tests to v4/local-suite-4. Keep `dist/` generated from source only.

## Product requirements

### 1. One hundred useful tools
- Add 27 complete tools total, including The Arcade, so `manifest/tools.json` contains exactly 100 entries.
- Choose the other 26 based on practical utility, keyless/offline-first access, browser CORS reality, source quality, and non-overlap with the 73 existing tools.
- Each new tool must provide meaningful interaction or information, responsive design, accessible native controls, honest freshness/error/offline states, safe rendering, appropriate local persistence, manifest metadata, catalog/docs, generated dist output, and deterministic tests.
- Prefer government/authoritative public data and offline calculators. Avoid paid services, OAuth, required relays, tracking, and runtime frameworks.

### 2. Flight Tracker live flight weather map
- Improve `flight.html` with a genuinely useful live map that combines the tracked aircraft’s freshest available position with live/recent aviation weather. It must show the flight/aircraft location and useful weather context (for example radar/precipitation plus METAR/TAF or hazards where available), not merely a static link or decorative map.
- Preserve the existing Aviationstack + Airplanes.live request-safety behavior, quotas, manual refresh defaults, cache identities, stale disclosure, and `file://` support.
- Use authoritative/CORS-compatible sources where practical (Aviation Weather Center/NWS/NOAA/Open-Meteo as appropriate), honest timestamps and attribution, a useful fallback when position or weather layers are unavailable, keyboard-accessible controls, mobile usability, and CSP-safe rendering.
- Do not embed credentials or put provider keys in URLs when header auth is supported.

### 3. National Parks Explorer complete category coverage
- The official source is `https://www.nps.gov/subjects/developer/api-documentation.htm` and the live NPS API. V3 claims 29 documented resources. Audit the current official documentation and live contracts and ensure the parks page visibly exposes useful information from **every currently available documented API resource/category**, including reference/taxonomy/media/GeoJSON/dependent resources where applicable—not only endpoint names or hidden test calls.
- Organize the UI around visitor tasks while preserving full endpoint/resource coverage, lazy loading, request generation guards, exact cache identities, pagination, header authentication (`X-Api-Key`), rate-limit safety, stale disclosure, safe URL handling, and explicit provider-defect states.
- A validated development key exists at `~/.config/local-suite/nps-api-key` mode 0600. It may be read only by test/probe code without printing it, putting it in process arguments, screenshots, source, evidence, browser localStorage, or git. Use small live probes conservatively; stop on 429. Browser users still configure their own `suite.key.nps`.
- Update deterministic fixtures/tests to prove visible coverage for every documented resource and use a small live verification to validate response shapes/status without exposing the key.

### 4. Favorites and recently used
- Add suite-wide quick access for favoriting tools/pages and showing recently used tools.
- Favorites must be toggleable from hub cards and from individual tool chrome, persist locally, stay synchronized across tabs, be keyboard/screen-reader accessible, and have obvious pressed/favorited state.
- Recently used must update when a real tool page is opened, deduplicate, order most-recent-first, be bounded, exclude or sensibly handle the hub/settings, avoid write loops, and be visible as a useful hub section.
- Preserve compatibility with suite-wide backup/restore/reset and document the new `suite.*` storage keys. Add deterministic tests for favorites, recents, cross-tab updates, missing/retired IDs, accessibility semantics, and mobile layout.

### 5. The Arcade
- Add a manifest page named **The Arcade** with a polished responsive grid of large clickable icons/cards using game art. Each card must clearly identify edition/device where applicable, have useful metadata, and link to a playable GitHub Pages URL when the repository actually publishes one; otherwise link to the exact repository and label that destination honestly. Open external destinations safely.
- Include exactly these repositories:
  - https://github.com/Overplant-Paving/bathhouse-brigade-mobile.git
  - https://github.com/Overplant-Paving/bathhouse-brigade.git
  - https://github.com/Overplant-Paving/doom-shareware.git
  - https://github.com/Overplant-Paving/chromatic-chains-mobile.git
  - https://github.com/Overplant-Paving/chromatic-chains-desktop.git
- Inspect those repositories and hosted Pages rather than guessing URLs or art. Prefer suitable existing game art/screenshots from those owned repositories, copied locally and inlined by the v4 build as data assets so the Arcade remains self-contained. If any new image must be created or transformed creatively, invoke **Codex CLI** through its installed image-generation skills (`~/.codex/skills/`)—do not synthesize or hand-draw replacement art yourself. Record source/provenance and optimize payload sizes. Do not modify the game repositories.
- Test all five cards, labels, destinations, image load/alt text, keyboard activation, external-link safety, CSP, file mode, hosted mode, and mobile layout.

## Verification and evidence

Expand tests rather than weakening them. At minimum:
- `python3 build.py`
- focused tests for favorites/recents, flight, parks, Arcade, and representative new tools
- `python3 build.py --check`
- all existing mandatory tests including smoke/PWA/update/settings/location/color gates that apply
- `git diff --check`
- a secret scan that proves the NPS key bytes are absent without printing the key
- headed Chromium desktop and mobile evidence for hub favorites/recents, flight weather map, parks categories, Arcade, and representative new tools; inspect screenshots and fix visual defects
- no console/page errors, no mobile horizontal overflow, generated source/dist parity

Archive concise release evidence under `tests/evidence/v4-release/`, including a checklist and actual command outputs. Do not claim live behavior that was not exercised. If an upstream service is unavailable, preserve deterministic coverage and document the exact verified limitation.

At completion, print a concise handoff: exact tool count, chosen 27 tools, major files changed, APIs/sources used, live verification results, test commands/results, screenshot/evidence paths, any remaining limitations, and `git status --short`.