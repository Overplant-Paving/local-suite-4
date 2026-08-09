# Local Suite 4 — development instructions

Local Suite 4 is the continuation of the verified v2/v3 single-file suite. It contains
104 manifest tools plus a generated hub (105 generated pages). The source is in `tools/`;
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

## Current project state (v4.3.3, 2026-08-09)

- **v4.3.3 is the current release (2026-08-09).** It contains 104 tools plus the hub (105
  generated HTML pages) and adds ChromaLink as the second Beta Tools entry: phone-to-phone
  optical transfer via 8-color animated frames and RaptorQ fountain decoding through the camera.
  Source: strict TypeScript/Vite subproject `chromalink/` (npm confined there);
  `chromalink/scripts/export-suite.mjs` deterministically regenerates `tools/chromalink.html`,
  and `python3 build.py` emits `dist/chromalink.html` (`RELEASE_TOOL_COUNT` is 104). Optical
  Transfer and Audio Transfer are unchanged. The PWA precache holds 109 entries. A same-day
  review-fix pass hardened hostile-OTI bounds and transferId+OTI session locking, serialized the
  camera frame pump, added receiver/sender lifecycle guards, the 70vmin aiming guide with exact
  status texts, per-reason worker statistics, and decode-failure-only 240/320 px fallback
  scales; `node tests/chromalink-built.mjs` is wired into the Pages workflow. A same-day final
  hardening pass contained `decoder.addPacket` throws in the receive session (typed
  `decoder-failed` rejection, safe disposal, lock release), replaced the receiver's shared
  finalizing flag with session-scoped finalization ownership, and made the sender's Start button
  track true validity (no overlapping streams, start-time-invalid files stay disarmed).
  Synthetic/browser gates pass — 82 Vitest tests, 58 built-page checks; release evidence:
  `tests/evidence/v4.3.3-release/`, implementation evidence: `tests/evidence/chromalink/`.
  Two-phone physical over-air performance remains an unverified beta claim.
- **v4.3.2 was released and deployed on 2026-08-08.** It contains 103 tools plus the hub (104
  generated HTML pages)
  and adds Audio Transfer as a separate tool in the new **Beta Tools** category. Audio Transfer uses
  audible C0/R1 BPSK OFDM, bounded robust-soliton fountain recovery, CRC32C, and SHA-256-gated
  reconstruction with no payload network path. v4.3.1's Optical Transfer hardening is retained.
  Generated-page and deterministic digital-loopback gates pass; two-device physical over-air
  compatibility, reliability, range, and goodput remain unverified beta claims.
- **v4.3.1 was released and deployed on 2026-08-06.** It retains 102 tools plus the hub and hardens
  Optical Transfer without changing its DCF2/LT wire format.
- **v4.3.0 was released and deployed on 2026-08-06.** It contains 102 tools plus the hub and
  expands The Arcade from five to seven verified browser games with Unicorn 42069er: The
  Sprinkle Mines and Miner 42069er. Their repository-derived card art is optimized, provenance-
  recorded, and inlined; focused tests gate all destinations, truthful alternatives, link safety,
  file/hosted behavior, and mobile layout.
- **v4.2.0 was released and deployed on 2026-08-02.** It added Optical Transfer: a self-contained
  Send/Receive page with deterministic LT fountain recovery, inlined QR encoding and ZXing-WASM
  decoding, bounded hostile-input handling, SHA-256-gated completion, honest mobile HTTPS/PWA
  behavior, and preserved third-party provenance.
- **v4.1.0 was released and deployed on 2026-07-31.** It added `flood.html`: FEMA NFHL point
  classification (with a two-step Census address
  confirmation, tool-local `suite.flood.target`, an inline containing-zone SVG footprint, NWS
  flood alerts, and bounded NWPS gauges). Plan and evidence: `FLOOD-TOOL-PLAN.md`,
  `tests/evidence/flood-feasibility/`, `tests/evidence/flood/`; focused gate
  `tests/flood-built.mjs` runs in the Pages workflow; the live acceptance gate is deliberately not
  wired into CI, because a third-party outage must not block deploying the other tools. The
  v4.0.0 statements below and the archived v4 release evidence keep their historical 100-tool
  counts.
- V4 adds suite-wide favorites and recently-used quick access (core chrome + hub sections), a
  live flight weather map (Open-Meteo precipitation grid, NWS SIGMETs and METARs), a re-audited
  29-resource National Parks Explorer with a drawn boundary map, The Arcade (seven playable games,
  art inlined from the owned repos via `data-suite-asset`), and 26 new offline/keyless tools.
- GitHub repository: https://github.com/Overplant-Paving/local-suite-4
- Hosted suite: https://overplant-paving.github.io/local-suite-4/
- Current release evidence and the final checklist live under `tests/evidence/v4.3.3-release/`;
  ChromaLink implementation evidence lives under `tests/evidence/chromalink/`.
- The headed Chromium gate verifies a real `beforeinstallprompt` event, zero manifest and
  installability errors, service-worker control, same-origin manifest icons under CSP, and the
  `suite-v4-` precache. Full build, PWA, update, and 105-page smoke gates remain mandatory for
  future releases.

## Distribution model

GitHub Pages publishes committed `dist/` files. The same files can be copied and opened directly.
The service worker is hosted-mode-only and never caches provider API responses. `relay/worker.js`
is an optional power-user template; no core tool depends on it.
