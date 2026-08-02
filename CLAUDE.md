# Local Suite 4 — development instructions

Local Suite 4 is the continuation of the verified v2/v3 single-file suite. It contains
102 manifest tools plus a generated hub (103 generated pages). The source is in `tools/`;
committed, self-contained output is in `dist/`.

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

## Current project state (v4.1 release candidate, 2026-07-31)

- **v4.1 is implemented but NOT released.** The last shipped release is v4.0.0. The strict live
  acceptance gate `tests/flood-live-accept.mjs` is green: the final run returned the recorded New
  Orleans zone X / `SFHA_TF=F` classification and a valid footprint with zero CSP/console errors.
  One recovery run still rendered supplementary FIRM-panel and LOMR failures independently; the
  final rerun loaded those enrichments too.
  Do not describe v4.1 as shipped until the remaining release steps are completed, and do not treat
  the non-asserting `tests/flood-live-run.mjs` outage capture as acceptance.

- 71 v1 tools are preserved on the v2 architecture; Settings, Flight Tracker, The Arcade, 26
  further v4 tools, the v4.1 Flood Risk & Conditions page, and staged Optical Transfer bring the
  integration worktree to 102 tools, plus the hub (103 generated HTML pages). Optical Transfer is
  not part of the existing v4.1 release claim.
- V4.1 adds `flood.html`: FEMA NFHL point classification (with a two-step Census address
  confirmation, tool-local `suite.flood.target`, an inline containing-zone SVG footprint, NWS
  flood alerts, and bounded NWPS gauges). Plan and evidence: `FLOOD-TOOL-PLAN.md`,
  `tests/evidence/flood-feasibility/`, `tests/evidence/flood/`; focused gate
  `tests/flood-built.mjs` runs in the Pages workflow; the live acceptance gate is deliberately not
  wired into CI, because a third-party outage must not block deploying the other 100 tools. The
  v4.0.0 statements below and the archived v4 release evidence keep their historical 100-tool
  counts.
- V4 adds suite-wide favorites and recently-used quick access (core chrome + hub sections), a
  live flight weather map (Open-Meteo precipitation grid, NWS SIGMETs and METARs), a re-audited
  29-resource National Parks Explorer with a drawn boundary map, The Arcade (five playable games,
  art inlined from the owned repos via `data-suite-asset`), and 26 new offline/keyless tools.
- GitHub repository: https://github.com/Overplant-Paving/local-suite-4
- Hosted suite: https://overplant-paving.github.io/local-suite-4/
- Release evidence and the final checklist live under `tests/evidence/v4-release/`.
- The headed Chromium gate verifies a real `beforeinstallprompt` event, zero manifest and
  installability errors, service-worker control, same-origin manifest icons under CSP, and the
  `suite-v4-` precache. Full build, PWA, update, and 102-page smoke gates remain mandatory for
  future releases.

## Distribution model

GitHub Pages publishes committed `dist/` files. The same files can be copied and opened directly.
The service worker is hosted-mode-only and never caches provider API responses. `relay/worker.js`
is an optional power-user template; no core tool depends on it.
