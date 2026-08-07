# Local Suite v4.3.1 — release checklist

Target: exactly 102 manifest tools plus the generated hub (103 generated HTML pages).

## Release scope

- [x] Preserve and formally document the deployed v4.3.0 Arcade expansion.
- [x] Correct responsive/desktop QR geometry without changing the DCF2/LT wire format.
- [x] Stop hidden sender work and make sender/receiver mode teardown deterministic.
- [x] Correct verification, corruption, and invalid UTF-8 progress states.
- [x] Reject impossible QR/ECC tuning before streaming.
- [x] Guard asynchronous camera-setting updates and refresh actual settings.
- [x] Bound padded equation buffers to 32 MiB and clarify the payload/memory distinction.
- [x] Add reduced-motion pacing, integrity wording, and vendor hash verification.
- [x] Expand focused regression coverage for rendered layout, lifecycle races, and boundary conditions.

## Local release verification

- [x] `python3 build.py` — 103 generated HTML files; 107 PWA precache entries.
- [x] `python3 build.py --check` — all fatal gates and negative fixtures green.
- [x] Pages workflow foundation and focused feature contracts green locally.
- [x] Optical Transfer focused gate green.
- [x] Full Playwright smoke — 103/103 green.
- [x] PWA install/offline and v3/v4 coexistence green.
- [x] Headed installability gate green with zero manifest/installability errors.
- [x] `git diff --check` clean.

## Publication

- [x] Commit and push all v4.3.1 release changes to `main` as `8fd362d`.
- [x] GitHub Pages verification and deployment workflow succeeds — run
      <https://github.com/Overplant-Paving/local-suite-4/actions/runs/31139502818>.
- [x] Hosted suite and Optical Transfer return HTTP 200.
- [x] Hosted `index.html`, `optical.html`, `sw.js`, web manifest, and 192 px icon match committed
      `dist/` bytes by SHA-256.
- [x] Fresh hosted browser confirms square QR geometry at 1280 px and both sides of the 760/761 px
      breakpoint, all v4.3.1 behavior markers, the seven-game Arcade description, and zero errors.
- [x] Backfill the `v4.3.0` tag and GitHub Release at deployed commit `cc14f0c`:
      <https://github.com/Overplant-Paving/local-suite-4/releases/tag/v4.3.0>.
- [x] Push the `v4.3.1` tag and publish its GitHub Release from the final hosted-evidence commit.

## Evidence files

- `build-and-check.txt`
- `focused-gates.txt`
- `smoke-pwa.txt`
- `hosted-verify.txt`
- `release-notes.md`
