# Hermes final verification — Flood Risk & Conditions

Date: 2026-07-31
Working tree: `main...origin/main`, uncommitted

## Independent reviews

- Claude Code Opus 5, high effort, reviewed and repaired the implementation without a monetary cap.
- GPT-5.6 Sol, high reasoning, completed a separate read-only review. It reported no P0 issues and
  13 P1/P2/P3 findings. Confirmed findings were reconciled and covered by regression scenarios.
- No commit, push, branch, or history rewrite occurred.

## Authoritative build and deterministic gates

- `python3 build.py` — PASS: 102 HTML files built; final service-worker cache
  `suite-v4-06ef2a954aa3`, 106 precached entries.
- `python3 build.py --check` — PASS: every fatal gate and every negative fixture green;
  manifest 101 tools + hub, 71 v1 migrations, 30 suite-native.
- `git diff --check` — PASS.
- Temporary `PWA-UPDATE-CANARY` — absent from both `tools/` and `dist/` after the final rebuild.

## Flood-specific verification

- `cd tests && node flood-built.mjs` — PASS: 62/62 deterministic scenarios green.
- `cd tests && node verify-tool.mjs flood` — PASS using Playwright Chromium; evidence refreshed in
  `tests/evidence/flood/`; no unexpected console/CSP issue.
- `cd tests && node flood-live-accept.mjs` — PASS: all 12 strict live checks green at the recorded
  New Orleans public coordinate. FEMA returned zone X, `SFHA_TF=F`, subtype 0.2% annual-chance,
  study `22071C`, a valid containing polygon, and an approximate edge distance; FIRM panel and LOMR
  enrichments loaded; zero CSP violations and zero console/page errors. Evidence:
  `live-accept.txt` and `live-accept.png`.

The first recovery run demonstrated one test-harness false negative: the strict runner's broad
`/unavailable/` expression matched an independently unavailable panel/LOMR message even though the
core zone classification and footprint were valid. The assertion was narrowed to core-classification
errors and rerun. The final run loaded the enrichments too and passed 12/12.

## Suite regression verification

- `node smoke.mjs` — PASS: 102/102 generated pages green under `file://`.
- `node multiple-locations.mjs` — PASS, including shared-fetch in-flight protection.
- `node location-cross-tab.mjs` — PASS; 32 covered tools.
- `node favorites-recents.mjs` — PASS.
- `node flight-built.mjs` — PASS.
- `node parks-built.mjs` — PASS, 29/29 resource rows.
- `node arcade-built.mjs` — PASS.
- `node games-retire.mjs` — PASS; 101 manifest tools represented and retired content absent.

## PWA verification

- `node pwa-verify.mjs install` — PASS: installability clean, 106-entry precache, offline shell and
  offline function checks green.
- `node pwa-verify.mjs coexist` — PASS: v3 fixture cache preserved, current v4 cache correct.
- `node pwa-headed-verify.mjs evidence/flood/headed-installability.png` — PASS: real
  `beforeinstallprompt`, service-worker control, no manifest/installability/console errors.
- `node pwa-verify.mjs update` — PASS after the documented orchestration: serve the baseline build,
  place the canary in source without rebuilding, then let the verifier rebuild mid-session. Cache
  changed from `suite-v4-06ef2a954aa3` to `suite-v4-2b9d68a110d7`, new content arrived within one
  reload, and the old cache was removed. An initial operator run had rebuilt the canary too early and
  correctly failed because the cache name could not change; that was a test-procedure error, not a
  product failure. The canary was removed and the final baseline rebuilt and rechecked.

## Release state

The page and suite integration are technically release-ready. The v4.1 working tree remains
uncommitted and unpublished; committing, pushing, tagging, and deployment require explicit user
authorization.
