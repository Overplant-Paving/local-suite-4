# Local Suite v4.0.0 — completed release checklist

Target: exactly 100 manifest tools (73 v3 + 27 new, Arcade counted as one) plus the generated hub.

## New tool slate (27)

Offline (15): calc · hash · checklists · image · ics · typing · metronome · periodic · body ·
savings · budget · recipes · fuellog · healthlog · skyevents

Keyless network, CORS verified 2026-07-30 (11): dns (dns.google + cloudflare-dns) ·
overhead (api.airplanes.live) · spending (api.usaspending.gov) · rhymes (api.datamuse.com) ·
cite (api.crossref.org) · weatherhistory (archive-api.open-meteo.com + geocoding) ·
tropical (api.weather.gov products TWO + alerts) · discussion (api.weather.gov products AFD) ·
nasaimages (images-api.nasa.gov) · worldbank (api.worldbank.org) · wayback (archive.org)

Games (1): arcade — five Overplant-Paving games, all with live GitHub Pages
(verified 2026-07-30); art copied from the owned repos, doom-shareware has no in-repo art.

Rejected during source audit (2026-07-30): api.census.gov now key-required (302 →
missing_key.html) · NHC CurrentStorms.json no ACAO · rdap.org redirects to per-TLD registry
hosts (unworkable under generated CSP) · aviationweather.gov API still no ACAO.

## Work items

- [x] Rebrand v3 → v4: build.py, core/suite.js header, cache prefix suite-v4-, tests
      (games-retire.mjs absolute path, pwa-headed-verify prefix), docs, URLs → local-suite-4
- [x] Favorites + recents: core (suite.hub.favorites / suite.hub.recents), hub sections,
      per-tool chrome star injected from core, cross-tab, a11y, deterministic tests
- [x] Flight Tracker weather map: position + radar/precip + METAR/TAF context
      (api.weather.gov, Open-Meteo, radar.weather.gov), preserved request-safety
- [x] Parks Explorer: 29 documented resources re-audited against live swagger 2026-07-30
      (no additions/removals; /mapdata/parkboundaries/{sitecode} path param; /events pageSize);
      visible resource-specific output, GeoJSON geometry, practical pagination, true freshness,
      auth/rate suppression, fixtures, and conservative live probe
- [x] The Arcade: 5 cards, local optimized art, honest labels/destinations, tests
- [x] 27 new tools complete: manifest, CATALOG, a11y, offline/error states, tests
- [x] Docs: README, CLAUDE.md, ROADMAP, ARCHITECTURE (storage keys), API-AND-RELAY
      (new sources + rate limits), PWA, CATALOG
- [x] Exactly-100-distinct-ID fatal build gate with under/over/duplicate/mismatch negative tests;
      source/control-byte integrity covers tool HTML plus shared core JS/CSS with negative tests
- [x] `python3 build.py` · `python3 build.py --check` green
- [x] Focused tests: favorites/recents, flight, Parks, Arcade, all 26 non-Arcade new tools
- [x] Full smoke suite (101 files), PWA install/offline/update/v3-coexistence,
      settings/location/color gates
- [x] `git diff --check` · secret scan proves protected NPS key bytes absent
- [x] Headed Chromium desktop + mobile evidence; no console errors, CSP errors, or horizontal overflow
- [x] Documentation and handoff evidence complete

## Release evidence

- Build: `build.txt`, `build-check.txt` — 100 tools + hub; 101 generated HTML files;
  105 precache entries; every fatal and negative gate green.
- Functional: `focused-v4-tests.txt`, `focused-foundation-tests.txt`,
  `new-tools-tests.txt`, `smoke.txt` — focused suites green and smoke 101/101.
- NPS: `nps-schema-inventory.txt`, `nps-live-probe.txt` — 29/29 documented
  resources matched and 29/29 live probes healthy.
- PWA: `pwa-install-offline.txt`, `pwa-update.txt`, `pwa-coexistence.txt`,
  `headed-installability.txt` — install/offline, one-reload update, shared-origin v3/v4 cache
  coexistence, and headed installability all green.
- Visual: `headed-visual-checks.txt` and `visual/` — desktop/mobile checks and
  screenshots green, including Parks GeoJSON and populated Typing/Budget states.
- Security: `nps-secret-scan.txt` — protected key mode 0600 and zero exact
  occurrences in the repository.

No commit, push, remote change, or secret disclosure was performed.
