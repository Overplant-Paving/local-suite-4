# Reconcile the completed GPT-5.6 Sol review

Resume your Flood Risk & Conditions review/repair work in `/home/intelligence-zero/work/local-suite-4`.

A concurrent read-only GPT-5.6 Sol review has finished. Read its complete report at `tests/evidence/flood/codex-review.md`. Independently validate every finding against the current code (which includes your prior repairs), then fix every confirmed issue with narrowly scoped production changes and deterministic regression tests. Do not dismiss findings merely because prior tests pass.

## Reconciliation direction

Treat these as confirmed or strongly indicated unless current code proves otherwise:

1. Separate outage diagnostics from strict release acceptance. Add or convert a live acceptance runner so it requires the recorded New Orleans result (zone X, `SFHA_TF=F`, a footprint, zero CSP/console errors) and exits nonzero while FEMA cannot classify. Keep outage evidence capture separate. Change current-release documentation from “complete/released” to an implemented release candidate blocked on strict live FEMA acceptance; preserve historical v4.0 facts.
2. Implement three-state SFHA interpretation: inside only for normalized explicit T; outside only when every readable returned record is normalized explicit F; otherwise unknown. Never turn missing/malformed values into an outside-SFHA claim.
3. Validate records inside nonempty FEMA/NWS/NWPS arrays. If records are unreadable, use unknown/partial language; never filter malformed records into a false negative. Handle malformed NWS field types safely, including non-string description/instruction/headline values.
4. Add an acquisition-generation guard covering address lookup, device geolocation, edits, direct checks, and suite-location checks. Prevent slow callbacks from replacing newer work. For maximum clarity and safety, render a returned device position—with reported accuracy—as a candidate requiring a separate “Check this point” action.
5. Display `STATIC_BFE` only with a valid FEMA `LEN_UNIT`, using that normalized unit rather than hard-coding feet; preserve `V_DATUM` separately. Test feet, meters, and missing-unit cases.
6. Fix the root shared-helper defect in `core/suite.js`: the stale-cache location-change rejection must consistently carry `locationChanged=true`, like the successful-response path. Add focused cross-tab coverage for expired cached data plus failed network.
7. Normalize `DFIRM_ID`; rank explicit printed panel status above unknown; label a primary only for a unique winning rank tuple. If matching panels tie, clearly show ambiguity rather than choosing the first.
8. Derive NWPS request bounds from the advertised radius (`radiusKm / 111.2`, longitude adjusted by cosine) so a 20 km search covers all cardinal directions. Keep the haversine filter and add a 16.7–20 km north/south fixture.
9. Treat `obs_not_current`/`fcst_not_current` and similar categories as unavailable, suppress sentinel/implausible dates such as year 0001, and require current usable forecast data when ranking forecast availability.
10. Validate complete closed FEMA rings; discard malformed rings rather than joining surviving vertices. If no valid geometry remains, do not claim the point is inside a drawn footprint or compute edge distance.
11. Improve async accessibility with concise per-section status/live nodes and meaningful `aria-busy` transitions. Avoid making the whole three-tile glance group re-announce for one tile. Test classification, enrichment completion/failure, and current-condition announcements.
12. Keep the bounded GeoJSON→Esri fallback, revise the documented automatic maximum from five to six, and add a test asserting the six-request ceiling when fallback plus enrichments and current-condition calls occur.
13. Resolve all current lifecycle/count contradictions identified in the review: implementation-plan status, CLAUDE current counts/smoke count, build.py JSONP comment, and any related current-state text. Preserve explicitly historical records.

Also inspect for interactions among these fixes and any additional defects. Maintain the no-framework, keyless, bounded-request, self-contained `file://` contract.

## Constraints and verification

- Do not commit, push, branch, rewrite history, inspect secrets, or edit `dist/` manually.
- Update source/tests/docs/evidence, then rebuild with `python3 build.py`.
- Run `python3 build.py --check`, `cd tests && node flood-built.mjs`, `node verify-tool.mjs flood`, relevant location/cross-tab tests, and `git diff --check`.
- Run the strict live acceptance once and archive its expected failure if FEMA remains down; do not misreport it as passing.
- Do not rerun the full smoke/PWA suite; Hermes will do that after your edits.

Finish with a finding-by-finding disposition, exact changed files, exact test results, strict live-acceptance outcome, remaining blockers, and confirmation that no commit/push occurred.
