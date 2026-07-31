Perform a rigorous read-only engineering review of all uncommitted Flood Risk & Conditions changes in `/home/intelligence-zero/work/local-suite-4`.

Read `CLAUDE.md`, `FLOOD-TOOL-PLAN.md`, `tests/evidence/flood-feasibility/live-probe.md`, `tools/flood.html`, `manifest/tools.json`, `build.py`, the flood tests/fixtures, workflow changes, generated `dist/flood.html`, and all related documentation/count changes.

Review for actionable defects only, especially:

- FEMA NFHL query correctness, schema normalization, layer fallback behavior, panel matching, LOMR semantics, overlapping zones, sentinel values, geometry conversion, and non-overclaiming language.
- Census two-step JSONP safety, cleanup, candidate precision, and input parsing.
- NWS flood-alert filtering and NWPS bbox/ranking/current-value handling.
- Race behavior under target changes and cross-tab suite-location changes.
- Independent cache identity, TTL, bounded history, stale/offline behavior, and storage isolation.
- DOM escaping, CSP, request bounding, prohibited request paths, accessibility, keyboard/focus/live-region behavior, responsive layout, and `file://` compatibility.
- Whether deterministic tests can pass while production behavior is wrong; flag fixture/test blind spots.
- Manifest/build/PWA/CI/release-count/documentation consistency.

Do not edit any file, run destructive commands, commit, push, or access secrets. You may run read-only inspections and tests. Report only findings that merit a code change, ordered by severity (P0–P3), each with precise `path:line`, failure mechanism, and a concrete fix. If no actionable defect is found, state that explicitly and list the highest residual risks or untested live-source assumptions separately.
