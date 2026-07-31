# FEMA NFHL request-shape investigation — 2026-07-31 evening

Question asked: while the live NFHL layer-28 endpoint was answering HTTP 200 with embedded ArcGIS
400 errors, was there a *request-shape* workaround (a different dialect, a different `outSR`, a
cheaper projection) that would let `flood.html` recover a real classification?

**Answer: no.** The failure is on the service's query backend, not in the request. Every bounded
point query against layers 28, 3 and 1 failed in every shape tested, at more than one point. No
workaround was incorporated; the tool keeps its honest "could not be reached" state.

Raw output: [`fema-request-shape-probes.txt`](fema-request-shape-probes.txt) (read-only `curl`,
`Origin: null`, single public New Orleans / Miami city coordinates, no export, no envelope, no
unbounded request).

## What was compared

| # | Shape (layer 28 unless noted) | Result |
|---:|---|---|
| 1 | attributes only, `returnGeometry=false`, `f=json` | 400 `Failed to execute query.` |
| 2 | simplified GeoJSON **with** `outSR=4326` (the tool's primary) | 400 `The provided output spatial reference is not supported with geoJSON format.` |
| 3 | simplified GeoJSON **without** `outSR` | same 400 as #2 |
| 4 | simplified Esri JSON **with** `outSR=4326` (the tool's fallback) | 400 `Failed to execute query.` |
| 5 | simplified Esri JSON **without** `outSR` | 400 `Failed to execute query.` |
| 6 | `returnCountOnly=true` — the cheapest possible point query | 400 `Failed to execute query.` |
| 7 | `returnIdsOnly=true` | 400 `Failed to execute query.` |
| 8 | shape #1 at a second public point (Miami) | 400 `Failed to execute query.` |
| 9 | layer 3, FIRM panel attributes only | 400 `Failed to execute query.` |
| 10 | layer 1, LOMR attributes only | 400 `Failed to execute query.` |
| 11 | layer 0, NFHL availability count | **HTTP 200 `{"count":1}`** |
| 12 | service metadata root | **HTTP 200**, ArcGIS 11.1, 32 layers |

An out-of-band check with `where=1=0&returnCountOnly=true` (no geometry at all) returned
`{"code":400,"extendedCode":-2147467261,"message":"Unable to complete operation."}` — the ArcGIS
signature for a layer whose underlying data source cannot be opened.

## Reading of the result

- The service front end is healthy (metadata, CORS, `Vary: Origin`, and layer 0 all answer
  normally). The vector layers backing 28/3/1 are what is failing.
- Because a query that touches **no geometry and returns no rows** fails identically, the failure
  cannot be caused by anything in the request: not the dialect, not `outSR`, not the field
  allowlist, not the simplification parameters, not the point.
- The `f=geojson` message in #2/#3 is a *different* error only because ArcGIS validates the output
  spatial reference against layer metadata before it reaches the data source. It is a symptom of
  the same outage, not an independent dialect bug — the identical GeoJSON shape returned 19,043 B
  of real polygon at 12:48 the same day (`tests/evidence/flood-feasibility/live-probe.md`).

## What this changed in the tool

Nothing was added to work around the outage — there is nothing to work around. Two smaller
corrections came out of the investigation:

1. The comment above `fetchZone()` previously described the episode as the service "400-ing
   `f=geojson` at the validation layer while otherwise degraded", which reads as a dialect bug. It
   now records what the probes actually show. The single Esri-JSON fallback is **kept**: it costs
   one bounded request and still recovers a genuine geojson-only rejection, which #2/#3 shows the
   validation layer is capable of producing on its own.
2. Layer 0 answering `{"count":1}` while layer 28 is down is exactly the state in which a page
   could talk itself into "coverage exists, no zone here". `flood.html` only queries layer 0 after
   layer 28 returns an *empty but valid* feature collection — never after an error and (as of this
   review) never after an unreadable payload. Both paths are now covered by
   `tests/flood-built.mjs` ("FEMA unreachable is not 'no flood zone'" and "unreadable 200 payloads
   produce unknown states, never a negative claim").

## This outage is release-blocking, and a gate now says so

Recording the outage is not the same as accepting it. Two runners now exist, and they must not be
confused:

| Runner | Asserts? | Exit code while FEMA is down | Purpose |
|---|---|---|---|
| `tests/flood-live-run.mjs` | no | 0 | diagnostic capture of whatever the services do |
| `tests/flood-live-accept.mjs` | yes | **1** | release acceptance: requires the recorded correct answer |

`flood-live-accept.mjs` requires, for the public New Orleans coordinate: zone X, the explicit
outside-SFHA state (`SFHA_TF=F`), the 0.2% annual-chance subtype, study `22071C`, a drawn footprint
with at least one zone path, a computed zone-edge distance, and zero CSP/console errors. Its
current run is archived at [`live-accept.txt`](live-accept.txt) / [`live-accept.png`](live-accept.png)
and **fails 9 of 12 checks, exit code 1** — the three that pass are the negative CSP/console checks.

At that point v4.1 remained an implemented release candidate rather than a release. The strict live
runner is not wired into the Pages deploy workflow: a transient third-party outage must not block
deploying the other 100 tools. It remains a manual release gate recorded in `QUALITY.md` and
`ROADMAP.md`.

## Live page behaviour during the outage

`node tests/flood-live-run.mjs` against the built `file://dist/flood.html`
(see [`live-run.txt`](live-run.txt)): FEMA renders "could not be reached … this is not 'no flood
zone'", the NWS and NWPS sections render normally and independently, exactly two bounded FEMA
requests are emitted (primary + one fallback), and there are zero CSP violations and zero console
errors.

## Recovery observation during final acceptance

Later on 2026-07-31, the final strict run found layer 28 healthy again. The same New Orleans point
returned the recorded zone X / `SFHA_TF=F` result, study `22071C`, a valid containing polygon, and
an approximate edge distance with zero CSP or console errors. That run still reported FIRM-panel
and LOMR enrichment unavailable, but those supplementary failures were isolated and did not retract
or misstate the live zone classification. The strict runner initially produced one false negative
because its broad `/unavailable/` check matched that supplementary wording; the assertion was
narrowed to core classification errors and rerun. The final rerun loaded panel and LOMR enrichment
as well and passed all 12 checks. Final evidence is `live-accept.txt` and `live-accept.png`.
