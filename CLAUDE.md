# Local Suite 4 — development instructions

Local Suite 4 is the released continuation of the verified v2/v3 single-file suite. It contains
100 manifest tools plus a generated hub. The source is in `tools/`; committed, self-contained
output is in `dist/`.

## Read first

1. [README.md](README.md) — product contract and current release.
2. [ROADMAP.md](ROADMAP.md) — current status and backlog.
3. [ARCHITECTURE.md](ARCHITECTURE.md) — technical decisions and invariants.
4. [MIGRATION.md](MIGRATION.md), [API-AND-RELAY.md](API-AND-RELAY.md), [PWA.md](PWA.md), and
   [QUALITY.md](QUALITY.md) as the work requires.

`HANDOFF.md` is an archived v2 migration handoff. It is retained as provenance, not current state.
The historical sibling `../Local Suite` repository and `v1-import` object are not present in this
checkout; do not claim otherwise. Existing migration evidence remains under `tests/evidence/`.

## Standing rules

- Nothing ships unverified. Archive command output, screenshots, and live-fetch records under
  `tests/evidence/`.
- `python3 build.py --check` is authoritative. Never route around a failing gate.
- Never edit `dist/` by hand. Edit `tools/`, `core/`, `manifest/`, or `build.py`, then rebuild.
- Keep every built tool self-contained and double-clickable under `file://`.
- Preserve keyless-first data access, local `suite.*` storage, explicit freshness/offline states,
  generated CSP, and the no-framework/no-runtime-dependency contract.
- Serialize changes to `core/` and `build.py`; independently scoped tool work may run in parallel.
- Keep changes simple. Do not introduce an account, service, framework, or required relay.
- API keys are user-owned local data. Never commit, print, or place them in URLs when a provider
  supports header authentication.

## Current project state (v4.0.0, 2026-07-30)

- 71 v1 tools are preserved on the v2 architecture; Settings, Flight Tracker, The Arcade, and 26
  further v4 tools bring the manifest to 100 tools, plus the hub (101 generated HTML pages).
- V4 adds suite-wide favorites and recently-used quick access (core chrome + hub sections), a
  live flight weather map (Open-Meteo precipitation grid, NWS SIGMETs and METARs), a re-audited
  29-resource National Parks Explorer with a drawn boundary map, The Arcade (five playable games,
  art inlined from the owned repos via `data-suite-asset`), and 26 new offline/keyless tools.
- GitHub repository: https://github.com/Overplant-Paving/local-suite-4
- Hosted suite: https://overplant-paving.github.io/local-suite-4/
- Release evidence and the final checklist live under `tests/evidence/v4-release/`.
- The headed Chromium gate verifies a real `beforeinstallprompt` event, zero manifest and
  installability errors, service-worker control, same-origin manifest icons under CSP, and the
  `suite-v4-` precache. Full build, PWA, update, and 101-page smoke gates remain mandatory for
  future releases.

## Distribution model

GitHub Pages publishes committed `dist/` files. The same files can be copied and opened directly.
The service worker is hosted-mode-only and never caches provider API responses. `relay/worker.js`
is an optional power-user template; no core tool depends on it.
