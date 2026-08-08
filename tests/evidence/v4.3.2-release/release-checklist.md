# Local Suite v4.3.2 — release checklist

Target: exactly 103 manifest tools plus the generated hub (104 generated HTML pages), with Audio Transfer as a separate card under the new Beta Tools category.

## Scope

- [x] Latest Audio Transfer reliability configuration integrated.
- [x] Manifest category is `beta`; hub label is `🧪 Beta Tools`.
- [x] Manifest `since` version is `v4.3.2`.
- [x] README, CLAUDE, ROADMAP, ARCHITECTURE, QUALITY, and historical count note updated for v4.3.2/current cardinality.
- [x] Generated `dist/audio.html`, hub, CSP, and service worker rebuilt from source.
- [x] Pages workflow runs `tests/audio-built.mjs`.

## Local verification

- [x] `python3 build.py --check` — all fatal gates and negative fixtures green; 103 tools plus hub.
- [x] `node tests/audio-built.mjs` — Audio Transfer and Beta Tools assertions green.
- [x] Fountain schedule matrix — 143 deterministic no-loss cases through 1 MiB and 143 one-systematic-packet-loss cases reconstruct exact bytes.
- [x] `node tests/audio-modem.mjs` — exact C0/R1 encode/decode at 44.1/48 kHz with acquisition beyond the old 4,096-sample window.
- [x] `node tests/optical-built.mjs` — Optical Transfer regression green.
- [x] Foundation and focused feature gates green: locations, favorites/recents, Flight, Parks, Arcade, and Flood.
- [x] `node tests/smoke.mjs` — 104/104 generated pages green.
- [x] `node tests/pwa-verify.mjs coexist` — 108-entry v4 cache green with v3 coexistence.
- [x] `node tests/pwa-verify.mjs install` — 108-entry precache, offline shell/function, clean manifest, and zero installability errors.
- [x] Headed Chromium installability — `beforeinstallprompt` fired, service worker controlled the page, manifest/installability errors were empty, and the hub screenshot was visually reviewed.
- [x] Audio Transfer desktop screenshot reviewed at 1200×900 — no clipping, overlap, overflow, malformed controls, or hierarchy defects.
- [x] `git diff --check` — clean.

## Publication

- [x] Merge verified v4.3.2 changes to `main` and push.
- [x] GitHub Pages verification/deployment workflow succeeds — run `31276598456`.
- [x] Hosted hub exposes Beta Tools and links Audio Transfer.
- [x] Hosted core artifacts match committed `dist/` bytes.
- [ ] Tag and publish `v4.3.2` release after hosted verification.

## Evidence files

- `build-check.txt`
- `audio-built.txt`
- `audio-modem.txt`
- `smoke.txt`
- `pwa-coexist.txt`
- `pwa-install.txt`
- `pwa-headed.txt`
- `headed-installability.png`
- `audio-page.png`
- `hosted-verify.txt`
- `release-notes.md`
