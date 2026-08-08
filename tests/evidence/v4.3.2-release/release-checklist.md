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
- [x] `node tests/optical-built.mjs` — Optical Transfer regression green.
- [x] Foundation and focused feature gates green: locations, favorites/recents, Flight, Parks, Arcade, and Flood.
- [x] `node tests/smoke.mjs` — 104/104 generated pages green.
- [x] `node tests/pwa-verify.mjs coexist` — 108-entry v4 cache green with v3 coexistence.
- [x] `git diff --check` — clean.

## Publication

- [ ] Merge verified v4.3.2 changes to `main` and push.
- [ ] GitHub Pages verification/deployment workflow succeeds.
- [ ] Hosted hub exposes Beta Tools and links Audio Transfer.
- [ ] Hosted core artifacts match committed `dist/` bytes.
- [ ] Tag and publish `v4.3.2` release after hosted verification.

## Evidence files

- `build-check.txt`
- `audio-built.txt`
- `smoke.txt`
- `pwa-coexist.txt`
- `release-notes.md`
