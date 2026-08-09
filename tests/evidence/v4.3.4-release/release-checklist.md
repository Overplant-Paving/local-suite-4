# Local Suite v4.3.4 — release checklist

Target: exactly 105 manifest tools plus the generated hub (106 generated HTML pages), with Optical Transfer Beta as a separate third card under Beta Tools and stable Optical Transfer preserved byte-for-byte.

## Scope

- [x] Separate `optical-beta` manifest identity with `cat: beta`; stable `optical` remains `cat: util`.
- [x] Manifest `since` version is `v4.3.4`.
- [x] Beta receiver offers 30/60/90/120 FPS requests with 30 FPS default.
- [x] Delivered camera settings are reported truthfully; absent frame rate is shown as unreported.
- [x] Live camera constraints are serialized and newest selection wins delayed races.
- [x] Stable source, built artifact, focused test, documentation, and DCF2/LT wire format are unchanged.
- [x] Builder allowlists only exact stable/Beta Optical Transfer filenames for ZXing worker/WASM embedding.
- [x] README, CLAUDE, ROADMAP, ARCHITECTURE, QUALITY, CATALOG, and `build.py` reflect v4.3.4 and current cardinality.
- [x] Generated Beta page, hub, CSP, and service worker rebuilt from source; no `dist/` file was hand-edited.
- [x] Pages workflow runs both stable and Beta Optical Transfer focused gates.

## Local verification

- [x] `python3 build.py` — 106 files built; 110-entry `suite-v4-` precache (`final-suite-gates.txt`).
- [x] `python3 build.py --check` — all fatal gates green at 105 manifest tools (`final-suite-gates.txt`).
- [x] `node tests/optical-built.mjs` — stable regression green (`final-suite-gates.txt`).
- [x] `node tests/optical-beta-built.mjs` — Beta regression green (`final-suite-gates.txt`).
- [x] `node tests/smoke.mjs` — 106/106 generated pages green (`final-suite-gates.txt`).
- [x] `node tests/pwa-verify.mjs coexist` — 110-entry current cache with v3 coexistence (`final-suite-gates.txt`).
- [x] `node tests/pwa-verify.mjs install` — 110-entry precache, clean manifest/installability, offline shell/function (`final-suite-gates.txt`).
- [x] `node tests/pwa-verify.mjs update` — changed content reached the active cache within one reload; canary removed and release build restored (`pwa-update.txt`).
- [x] Headed Chromium — `beforeinstallprompt`, service-worker control, clean installability/console, and reviewed full hub screenshot (`pwa-headed.txt`, `headed-installability.png`, `screenshot-review.md`).
- [x] Stable Optical Transfer source/built/test/docs match v4.3.3 byte-for-byte (`stable-preservation.txt`).
- [x] `git diff --check` — clean (`final-suite-gates.txt`).

## Publication

- [ ] Artifact-bearing v4.3.4 commit pushed to `main`.
- [ ] GitHub Pages verification/deployment succeeds for the artifact-bearing commit.
- [ ] Hosted `index.html`, `optical-beta.html`, `optical.html`, `sw.js`, and `manifest.webmanifest` match committed `dist/` bytes.
- [ ] Hosted browser renders Optical Transfer Beta under Beta Tools with 30/60/90/120 FPS options and stable Optical Transfer still present.
- [ ] Hosted evidence committed and pushed; final Pages deployment SHA equals final `origin/main`.
- [ ] Annotated `v4.3.4` tag and GitHub Release published.

## Evidence files

- `release-notes.md`
- `release-checklist.md`
- `final-suite-gates.txt`
- `stable-preservation.txt`
- `pwa-update.txt`
- `pwa-headed.txt`
- `headed-installability.png`
- `screenshot-review.md`
- `hosted-verify.txt` (added after artifact deployment)
- `hosted-browser.json` (added after artifact deployment)
