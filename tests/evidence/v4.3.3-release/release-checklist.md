# Local Suite v4.3.3 — release checklist

Target: exactly 104 manifest tools plus the generated hub (105 generated HTML pages), with ChromaLink as the second card under Beta Tools. Detailed ChromaLink implementation evidence (gate logs, screenshots, RED regressions, blur measurements) is archived under `tests/evidence/chromalink/` and is referenced rather than duplicated here.

## Scope

- [x] ChromaLink integrated with both 2026-08-09 hardening passes (hostile-OTI bounds, transferId+OTI session locking, `addPacket` containment, session-scoped finalization ownership, sender Start validity, lifecycle guards, 70vmin guide, exact status texts).
- [x] Manifest category is `beta`; ChromaLink sits beside Audio Transfer under `🧪 Beta Tools`.
- [x] Manifest `since` version is `v4.3.3`.
- [x] README, CLAUDE, ROADMAP, ARCHITECTURE, CHROMALINK.md, and `build.py` updated for v4.3.3/current cardinality (104 tools, 105 pages, 109-entry precache); v4.3.2 and earlier facts kept historical.
- [x] Generated `dist/chromalink.html`, hub, CSP, and service worker rebuilt from source; `dist/` never hand-edited.
- [x] Release copy distinguishes synthetic/browser verification from still-unverified two-phone physical over-air performance.
- [x] Optical Transfer and Audio Transfer unchanged (wire formats, behavior, docs).
- [x] Pages workflow runs `tests/chromalink-built.mjs`.

## Local verification (evidence: `tests/evidence/chromalink/`)

- [x] `npx tsc --noEmit` — exit 0, strict (`final-standalone-gates.log`).
- [x] `npx vitest run` — 82/82 across 13 files, incl. N100 99.0%/N60 98.0% production-path distortion gates against ≥95/≥98 floors, honest blur gate, and the 1 MiB E2E loopback under 20% frame loss within K·1.35 packets (`final-standalone-gates.log`, `blur-measurements.log`, `red-regressions.log`).
- [x] Export determinism — two build+export cycles byte-identical (`final-standalone-gates.log`).
- [x] `python3 build.py` — 105 files built; 109-entry `suite-v4-` precache (`final-suite-gates.log`).
- [x] `python3 build.py --check` — all fatal gates green at 104 manifest tools; negative fixtures fire (`final-suite-gates.log`).
- [x] `node tests/chromalink-built.mjs` — 58/58 (`final-suite-gates.log`).
- [x] `node tests/optical-built.mjs` — Optical Transfer regression green (`final-suite-gates.log`).
- [x] `node tests/audio-modem.mjs` + `node tests/audio-built.mjs` — Audio Transfer regression green (`final-suite-gates.log`).
- [x] `node tests/smoke.mjs` — 105/105 generated pages green (`final-smoke.log`).
- [x] Desktop and mobile screenshots reviewed — chooser, sender stream, receiver guide/searching states (`built-*.png`).
- [x] `git diff --check` — clean.
- [x] `node tests/pwa-verify.mjs coexist` — 109-entry v4 cache with v3 coexistence (`pwa-coexist.txt`).
- [x] `node tests/pwa-verify.mjs install` — 109-entry precache, offline shell/function, clean manifest, zero installability errors (`pwa-install.txt`).
- [x] `node tests/pwa-verify.mjs update` — changed source reached the active cache within one reload and the obsolete v4 cache was removed (`pwa-update.txt`); the temporary canary was then removed and the release build regenerated.
- [x] Headed Chromium installability — `beforeinstallprompt` fired, the service worker controlled the page, manifest/installability errors were empty, and the full hub screenshot was reviewed with both Beta Tools cards visible (`pwa-headed.txt`, `headed-installability.png`).

## Publication

- [x] Release commit `b37effacabff16f33cae89be6678785509087276` pushed to `main`.
- [x] GitHub Pages verification/deployment workflow succeeded: run `31318839087` — https://github.com/Overplant-Paving/local-suite-4/actions/runs/31318839087.
- [x] Hosted hub exposes ChromaLink beside Audio Transfer under Beta Tools: https://overplant-paving.github.io/local-suite-4/.
- [x] Hosted `index.html`, `chromalink.html`, `sw.js`, and `manifest.webmanifest` match committed `dist/` bytes exactly (`hosted-verify.txt`).
- [x] Annotated tag and GitHub release published: `v4.3.3` — https://github.com/Overplant-Paving/local-suite-4/releases/tag/v4.3.3.

## Evidence files

- `release-notes.md`
- `final-standalone-gates.txt` — clean install, strict TypeScript, 82/82 Vitest, Vite build/export.
- `final-suite-gates.txt` — Local Suite build/check, ChromaLink/Optical/Audio focused gates, 105/105 smoke.
- `pwa-coexist.txt`, `pwa-install.txt`, `pwa-update.txt`, `pwa-headed.txt`, `headed-installability.png`.
- `hosted-verify.txt`, `hosted-browser.json`, `hosted-hub.png`, `hosted-chromalink.png`, `hosted-chromalink-mobile.png`.
- Detailed implementation evidence: `tests/evidence/chromalink/` (`CHECKLIST.md`, `final-standalone-gates.log`, `final-suite-gates.log`, `final-smoke.log`, `red-regressions.log`, `blur-measurements.log`, `vision-tuning.log`, screenshots).
