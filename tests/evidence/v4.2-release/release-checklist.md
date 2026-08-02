# Local Suite v4.2.0 — release checklist

Target: exactly 102 manifest tools plus the generated hub (103 generated HTML pages).

## Release scope

- [x] Correct v4.1.0 metadata: Flood Risk & Conditions was released and deployed on 2026-07-31 from `8fa73f1`.
- [x] Add Optical Transfer as the 102nd tool with self-contained QR sending, camera receiving, deterministic LT fountain recovery, bounded hostile-input handling, and SHA-256-gated completion.
- [x] Preserve Decimen, node-qrcode, dijkstrajs, zxing-wasm, and ZXing-C++ provenance and licenses.
- [x] Register the tool in the hub, generated CSP, service-worker precache, Pages CI, architecture, catalog, quality policy, and roadmap.
- [x] Scope WASM/Blob/media CSP additions to Optical Transfer and reject arbitrary network additions.

## Local release verification

- [x] `python3 build.py` — 103 generated HTML files; 107 PWA precache entries.
- [x] `python3 build.py --check` — all fatal gates and negative fixtures green; 102 manifest tools plus hub.
- [x] Foundation contracts — multiple locations, location cross-tab, and favorites/recents green.
- [x] Feature contracts — Flight, Parks, Arcade, Flood, and Optical Transfer green.
- [x] Strict live Flood acceptance — recorded New Orleans zone X / `SFHA_TF=F` result, footprint, and zero CSP/console errors.
- [x] Full Playwright smoke — 103/103 green.
- [x] PWA install/offline — 107-entry cache complete; installability errors empty; representative offline tools functional.
- [x] PWA v3/v4 coexistence — current v4 cache retained with the seeded v3 cache; obsolete v4 cache removed.
- [x] Headed Chromium installability — `beforeinstallprompt` fired; manifest clean; service worker controlled the page; zero console/page errors.
- [x] Release hub screenshot reviewed: 102 tools, Optical Transfer visible, no clipping or visual corruption.
- [x] `git diff --check` clean.

## Publication

- [x] Push release commit `c51e8a4` to `main`.
- [x] GitHub Pages verification and deployment workflow succeeds — run
      <https://github.com/Overplant-Paving/local-suite-4/actions/runs/30736370492>.
- [x] Hosted hub, Optical Transfer, Flood Risk, service worker, and webmanifest return HTTP 200.
- [x] Hosted release artifacts match committed `dist/` byte-for-byte by SHA-256.
- [x] Fresh hosted browser QA reports 102 hub cards, Optical Transfer present, zero console/CSP
      errors, and no 390px horizontal overflow.
- [x] Backfill the missing `v4.1.0` tag and GitHub Release at deployed commit `8fa73f1`.
- [x] Push `v4.2.0` tag and publish the GitHub Release after this hosted-evidence commit.

## Evidence

- `build.txt`, `build-check.txt`
- `focused-foundation.txt`, `focused-features.txt`
- `flood-live-accept.txt`
- `smoke-pwa.txt`
- `headed-installability.txt`, `headed-installability.png`
- `hosted-verify.txt` — five public release files byte-identical to committed `dist/`
- `hosted-browser.txt`, `hosted-optical-mobile.png` — fresh public mobile browser QA
