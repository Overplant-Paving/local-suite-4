# Local Suite v4.3.5 — release checklist

Target: exactly 106 manifest tools plus the generated hub (107 generated HTML pages), with Optical Transfer Beta Test 1 as the fourth Beta Tools card. Stable Optical Transfer and the existing Optical Transfer Beta remain byte-for-byte unchanged.

## Scope

- [x] Separate `optical-beta-test-1` manifest identity with `cat: beta`; stable `optical` remains `cat: util`, and prior `optical-beta` remains separate.
- [x] Manifest `since` version is `v4.3.5`.
- [x] Product page packages H66-R2: QR V37/2,563-byte frames, ECC L mask 4, approximately 30 presentations/s, sender ring depth 3, four receiver workers, processor capture, calibrated fixed ROI, ZXing fast global histogram, adaptive H40 recovery, and post-SHA closure.
- [x] Stable Optical Transfer and existing Optical Transfer Beta source, generated artifacts, focused tests, and documentation are unchanged relative to `origin/main`.
- [x] The production page excludes campaign, harness, ADB/CDP, localhost, synthetic-trial, and fixed 1 MiB benchmark pathways.
- [x] Builder uses an exact filename allowlist for the H8 worker transformation.
- [x] README, CLAUDE, ROADMAP, ARCHITECTURE, QUALITY, CATALOG, and `build.py` reflect v4.3.5 and current cardinality.
- [x] Generated Beta Test 1 page, hub, CSP, and service worker were rebuilt from source; no generated page was hand-edited.
- [x] Pages workflow runs stable, prior-Beta, and Beta Test 1 focused Optical Transfer gates.

## Local verification

- [x] `python3 build.py` — 107 generated HTML files and 111-entry `suite-v4-` precache (`local-release-gates.log`).
- [x] `python3 build.py --check` — all fatal and negative gates green at 106 manifest tools (`local-release-gates.log`).
- [x] Full Pages-equivalent focused gate sequence — green (`local-release-gates.log`).
- [x] Stable Optical Transfer focused regression — PASS (`local-release-gates.log`).
- [x] Existing Optical Transfer Beta focused regression — PASS (`local-release-gates.log`).
- [x] Optical Transfer Beta Test 1 focused production gate — PASS (`local-release-gates.log`).
- [x] Full smoke suite — 107/107 generated pages green (`local-release-gates.log`).
- [x] PWA v3/v4 cache coexistence — 111-entry current cache and foreign v3 cache preserved (`local-release-gates.log`).
- [x] PWA install/offline matrix — clean manifest/installability, 111-entry precache, offline shell/function (`pwa-install.txt`).
- [x] PWA update path — changed content activated within one reload and old v4 cache removed (`pwa-update.txt`).
- [x] Headed Chromium — `beforeinstallprompt`, service-worker control, clean installability/console, and reviewed hub screenshot (`headed-installability.txt`, `headed-installability.png`, `screenshot-review.md`).
- [x] Stable/prior-Beta protected files unchanged relative to `origin/main`.
- [x] `git diff --check` — clean.

## Publication

- [ ] Artifact-bearing v4.3.5 commit pushed to `main`.
- [ ] GitHub Pages verification/deployment succeeded for the artifact-bearing commit.
- [ ] Hosted `index.html`, `optical-beta-test-1.html`, `optical.html`, `optical-beta.html`, `sw.js`, and `manifest.webmanifest` match committed `dist/` bytes.
- [ ] Fresh hosted browser renders Optical Transfer Beta Test 1 as the fourth Beta Tools card without console or CSP errors.
- [ ] Hosted evidence committed and pushed; final Pages deployment SHA equals final `origin/main`.
- [ ] Annotated `v4.3.5` tag and GitHub Release published.
