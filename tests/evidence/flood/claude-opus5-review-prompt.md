# Opus 5 concurrent flood implementation review and repair

Work in `/home/intelligence-zero/work/local-suite-4` on the current uncommitted Flood Risk & Conditions implementation. A separate GPT-5.6 Sol agent is concurrently performing a **read-only** review; you are the only child agent authorized to edit.

Read `CLAUDE.md`, `FLOOD-TOOL-PLAN.md`, `tests/evidence/flood-feasibility/live-probe.md`, `tests/evidence/flood/`, `tools/flood.html`, `tests/flood-built.mjs`, flood fixtures/interactions, `manifest/tools.json`, `build.py`, and relevant shared code before changing anything.

## Mission

Perform a second rigorous engineering review with Claude Opus 5, investigate the remaining live-source questions, and fix every confirmed defect you find. Do not merely produce suggestions: make narrowly scoped repairs, add regression coverage, rebuild generated output through `build.py`, and run relevant tests.

## Known areas requiring attention

1. **Manual refresh correctness.** `#refreshBtn` currently calls `loadAlerts(gen)` and `loadGauges(...)` with normal cache TTLs. Verify whether clicking “Refresh current conditions” actually makes fresh network requests when caches are still fresh. If not, fix it by forcing a network attempt while retaining the existing cached fallback on failure, and add deterministic regression coverage.
2. **FEMA live query failures.** Archived evidence shows the live NFHL layer-28 endpoint returning HTTP 200 with embedded ArcGIS 400 errors for both GeoJSON and Esri JSON during a service-degradation episode. Run bounded, read-only live probes against the public New Orleans test point to determine whether a reliable request-shape workaround currently exists. Compare at least attributes-only JSON, simplified Esri JSON with and without `outSR=4326`, and simplified GeoJSON. Never make export, neighborhood-envelope, or unbounded requests. If a reliable bounded shape works, incorporate the smallest safe fallback without weakening the existing request limits and add a test. If all shapes fail, preserve the honest unavailable state and update evidence with the current result rather than inventing a workaround.
3. **Independent FEMA cache honesty.** Check stale/error behavior for zone, panel, LOMR, and availability sub-results. Ensure a failed enrichment refresh cannot silently present stale panel/LOMR/availability data as freshly verified. Add regression coverage for any fix.
4. Audit all other FEMA/Census/NWS/NWPS parsing, race handling, escaping, request bounding, cache identity/TTL/pruning, partial/offline states, accessibility, responsive layout, CSP, `file://` behavior, documentation counts, CI, and test blind spots.
5. Treat remote payload types as untrusted. Look for paths where malformed-but-HTTP-200 data could create a false “no alert/no gauge/no zone” claim or throw during rendering.

## Constraints

- Do not commit, push, branch, rewrite history, or access secrets/`.env` files.
- Do not edit `dist/` manually; change source/tests/docs and run `python3 build.py`.
- Do not modify unrelated tools or shared core unless a proven root-cause fix requires it.
- Preserve the no-framework, keyless, self-contained `file://` architecture.
- Keep all automatic requests bounded and do not add a relay, account, external map, analytics, or risk score.
- Never overclaim FEMA results or turn service/malformed-data failures into “no flood risk.”
- Preserve historical v4.0 evidence.
- Archive new public live-probe output and relevant command results under `tests/evidence/flood/` without secrets or private addresses.

## Verification

After repairs, run at minimum:

- `python3 build.py`
- `python3 build.py --check`
- `cd tests && node flood-built.mjs`
- `cd tests && node verify-tool.mjs flood`
- relevant location/cross-tab tests if touched
- `git diff --check`

Do not rerun the full 102-page smoke or every PWA mode unless your changes plausibly affect them; Hermes already ran those successfully and will rerun final gates after reconciliation.

Finish with a concise report of findings, exact edits, exact test outcomes, live FEMA probe results, remaining limitations, and confirmation that no commit/push occurred.
