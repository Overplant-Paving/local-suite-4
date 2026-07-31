# Implement Flood Risk & Conditions completely

You are the primary implementation agent for Local Suite 4 at `/home/intelligence-zero/work/local-suite-4`.

## Required reads

Before editing, read and follow:

1. `CLAUDE.md`
2. `README.md`
3. `ARCHITECTURE.md`
4. `API-AND-RELAY.md`
5. `QUALITY.md`
6. `FLOOD-TOOL-PLAN.md` — this is the approved implementation specification
7. `tests/evidence/flood-feasibility/live-probe.md` — verified API shapes and performance evidence
8. Relevant neighboring source/tests, especially `tools/geo.html`, `tools/rivers.html`, `tools/alerts.html`, their interaction tests, `manifest/tools.json`, and `build.py`

## Mission

Implement Tasks A through F in `FLOOD-TOOL-PLAN.md` completely. Deliver a production-quality `Flood Risk & Conditions` page and all required source, manifest, tests, documentation, generated output, and verification evidence. Do not stop at a scaffold or partial implementation.

Use Claude Fable 5's strengths deliberately: sustain the entire multi-stage task, test your own work, inspect the rendered desktop/mobile result, and fix deficiencies before finishing.

## Hard constraints

- Work only in this repository.
- Do not commit, push, create branches, or rewrite history.
- Do not delete or overwrite the approved plan or feasibility evidence.
- Do not edit `dist/` by hand; edit source/manifest/build/docs/tests and rebuild.
- Preserve the no-framework, no-runtime-dependency, self-contained `file://` contract.
- Preserve keyless-first behavior, generated CSP, explicit freshness/offline states, and local `suite.*` storage.
- Never add an account, relay requirement, analytics, tracking, or secret.
- Never print or inspect credential files or `.env` files.
- Keep changes scoped to this flood feature and the exact release-count/current-doc references that must change.
- Preserve historical v4.0.0 records such as `V4_BRIEF.md` and `tests/evidence/v4-release/` unchanged.
- Treat all remote data as untrusted and escape it before inserting markup.
- Avoid unsupported legal/insurance claims and never label a location “safe” or “no flood risk.”
- Do not use a ZIP/city centroid as a property classification.

## Product and performance requirements

- New source page: `tools/flood.html`; generated page: `dist/flood.html`.
- Separate page, not an expansion of `rivers.html`.
- Address lookup is two-step: Census match first, explicit point confirmation second. Multiple candidates must be selectable; no FEMA/NWS/NWPS request before point confirmation.
- Support direct coordinates, device position with accuracy, and explicit copy of suite location with an approximation warning.
- Use a focused `Suite.location.watch(callback)` that updates only the shortcut candidate; do not replace the checked flood target.
- Use a flood-target generation token. If `Suite.fetchJSON` aborts due to an unrelated cross-tab suite-location change, retry the still-current target exactly once.
- Critical requests after confirmation: FEMA NFHL layer 28 simplified point GeoJSON, NWS active point alerts, and bounded NOAA NWPS gauges. Render them independently.
- Only after layer 28 returns zone data, request layer 3 FIRM panels and layer 1 intersecting LOMRs in parallel. If zone data is empty, skip those and make only the layer 0 availability fallback.
- Use the exact field allowlists, geometry simplification, cache TTLs, bounded cache history, NWPS bbox/radius, flood-event filtering, sentinel handling, panel `DFIRM_ID` matching, multiple-zone handling, and partial-state behavior specified in the plan.
- Inline visualization must use only the containing FEMA feature geometry in an accessible SVG/text equivalent. No OSM tiles, external mapping library, automatic FEMA export, neighborhood envelope query, unbounded gauge query, or automatic gauge metadata/history/stageflow.
- Do not create a blended proprietary risk score.
- Link to `rivers.html` and official FEMA/NWPS resources.
- Implement the recommended v4.1 feature-release contract: 101 manifest tools and 102 generated HTML pages, with generic count-gate wording and historical v4.0 evidence preserved.

## Testing and evidence

Create and run the focused deterministic tests specified by the plan, including at minimum:

- Census one/multiple/no-match and JSONP cleanup/timeout behavior
- No hazard requests before confirmed point
- Direct/device/suite-location flows and cross-tab behavior
- FEMA AE/SFHA, X 0.2%, X minimal, D, VE, AO/depth, dual/overlapping zones, missing/sentinel values, no-zone with and without NFHL availability, panel identity matching, and intersecting LOMR
- Polygon and MultiPolygon rendering and approximate edge distance
- NWS flood filtering and non-flood exclusion
- NWPS bounded query, ranking, invalid/out-of-service values, no gauges, and user-triggered expansion
- Independent stale/fresh/partial/offline caches
- Target-change and cross-tab races
- Remote-data escaping, keyboard/focus behavior, live regions, mobile width, both themes, and generated CSP
- Assertions that prohibited export/envelope/unbounded/history requests cannot be emitted

Archive actual command output, live fetch proof, screenshots, and final evidence under `tests/evidence/flood/` without secrets or private addresses. Use a public test coordinate/address.

Run and fix until all applicable gates are green, including:

- `python3 build.py`
- `python3 build.py --check`
- focused flood tests
- `cd tests && node verify-tool.mjs flood`
- `cd tests && node smoke.mjs`
- relevant multiple-location/cross-tab tests
- PWA/installability/offline/update checks required by the plan and current release process
- `git diff --check`

Update `.github/workflows/pages.yml` so the focused flood test runs before deployment. Update current-product counts/docs while leaving historical release evidence intact.

## Final response

Do not merely say “done.” Return:

1. concise implementation summary;
2. exact changed-file list;
3. exact commands run with pass/fail outcomes;
4. any live-source limitations or unverified items;
5. confirmation that no commit or push occurred.
