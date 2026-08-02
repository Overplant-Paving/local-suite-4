# Flood Risk & Conditions — implementation plan

Status: **released in Local Suite v4.1.0 and deployed on 2026-07-31.** `tools/flood.html` is built
into `dist/` and passes its deterministic gate (`tests/flood-built.mjs`). The strict live
acceptance gate `tests/flood-live-accept.mjs` is also green: after an earlier NFHL query outage,
layer 28 returned the recorded New Orleans classification and footprint with zero CSP/console
errors. One recovery run rendered panel/LOMR failures independently; the final rerun loaded those
enrichments too (see
`tests/evidence/flood/fema-outage-2026-07-31.md`).

## 1. Product decision

Build a separate **Flood Risk & Conditions** page rather than expanding `rivers.html`.

The two pages answer different questions:

- `rivers.html`: monitor many USGS gauges and favorites.
- `flood.html`: check one exact U.S. point for mapped FEMA hazard, current flood alerts, and nearby
  forecast-gauge context.

Keeping them separate preserves the existing river-monitor workflow and lets the flood page require
an explicit address or coordinate instead of a city/ZIP centroid. The flood page should link to
`rivers.html` for the broader gauge board.

Adding this card changed the v4.0 manifest from 100 to 101 tools and generated HTML from 101 to 102
pages. The later v4.2 Optical Transfer release raises the current contract to 102 tools and 103
generated pages. `build.py` enforces the current exact release identity count.

## 2. Outcome and non-goals

### The page must answer

1. **What FEMA flood zone contains this exact point?**
2. **Is it inside a mapped Special Flood Hazard Area (SFHA)?**
3. **What FIRM panel/effective date and intersecting LOMR apply?**
4. **Is an NWS flood-related alert active at the point?**
5. **What are nearby NWPS gauges reporting and forecasting?**
6. **How close is the point to the edge of its containing FEMA zone, approximately?**
7. **Where can the user verify the result on FEMA's official map?**

### Explicit non-goals

- No proprietary risk score or blended red/yellow/green score.
- No claim that a point is “safe,” “not at risk,” or legally outside a floodplain.
- No insurance, lending, survey, permitting, or elevation-certificate determination.
- No parcel-boundary lookup; the public sources in scope classify a coordinate, not a structure.
- No automatic neighborhood polygon query, FEMA export image, OSM tile map, or external map library.
- No automatic LOMA matching. A nearby LOMA point does not establish that a determination applies
  to the checked property.
- No unbounded NWPS gauge request and no automatic full hydrograph/history download.

## 3. Data sources and exact responsibilities

| Source | Endpoint shape | Responsibility | Initial TTL |
|---|---|---|---:|
| Census Geocoder | `geocoding.geo.census.gov/geocoder/locations/onelineaddress` (JSONP) | U.S. street-address match point | 7 days |
| FEMA NFHL layer 28 | `/MapServer/28/query` | Zone fields plus simplified containing polygon | 7 days |
| FEMA NFHL layer 3 | `/MapServer/3/query` | FIRM panel, effective date, scale | 7 days |
| FEMA NFHL layer 1 | `/MapServer/1/query` | LOMR areas intersecting the point | 24 hours |
| FEMA NFHL layer 0 | `/MapServer/0/query` | On-demand coverage check only when layer 28 is empty | 7 days |
| NWS alerts | `api.weather.gov/alerts/active?point=lat,lon` | Current flood/hydrologic alerts | 5 minutes |
| NOAA NWPS | `api.water.noaa.gov/nwps/v1/gauges?bbox...` | Nearby observed/forecast status | 15 minutes |

Authoritative references and current probe evidence live in
`tests/evidence/flood-feasibility/live-probe.md`.

## 4. Input model: precision before convenience

### Primary input

One text field accepts either:

- a full U.S. street address, or
- `latitude, longitude`.

A full address uses the Census geocoder already proven by `geo.html`. A Census match may be an
interpolated/address-range point rather than a surveyed building or parcel coordinate, so the page
must identify the geocoder and show the queried point. The flood tool must not accept a ZIP/city
centroid as a property classification without an explicit “approximate point” warning.

Address entry is deliberately two-step: **Find address** performs only the Census lookup, then a
match card shows the normalized address and coordinates with **Check this point** and **Edit**
actions. If Census returns several candidates, list them rather than selecting the first. FEMA/NWS/
NWPS requests start only after the user confirms one match. Direct coordinates and device position
can proceed with one explicit Check action because the point is already known.

### Shortcuts

- **Use device position**: call `navigator.geolocation.getCurrentPosition` and preserve the reported
  accuracy for this result.
- **Use suite location**: copy `Suite.location.get()` into the tool target, but label it “suite
  location — may be approximate.” Do not silently classify it as a property address. Register a
  focused `Suite.location.watch(callback)` that refreshes only the shortcut's displayed candidate;
  a cross-tab suite-location change must not replace an already checked flood target.
- **Paste coordinates**: entirely local until the user presses Check.

### Storage

Use a tool-specific target instead of replacing the suite-wide active location:

```text
suite.flood.target = {lat, lon, label, source, accuracy, checkedAt}
```

This prevents a house being researched from unexpectedly becoming the weather, parks, and nearby
location for the whole suite. Provide an explicit optional action to save the target as the suite
location if the user wants that.

No core schema migration is required for a new additive `suite.flood.*` key.

### Privacy behavior

Do not send any location to FEMA/NWS/NOAA until the user explicitly checks a known point. An address
may first go only to the Census geocoder; its returned point must be confirmed separately. After a
target has been checked and saved locally, reopening the page may paint cached data immediately and
refresh expired current-condition sections. State that the checked coordinate is sent directly to
FEMA/NWS/NOAA; there is no Local Suite server or account.

## 5. Request pipeline optimized for time-to-answer

### 5.1 Normalize once

1. Parse/validate coordinates locally, or obtain a Census address match.
2. Display the matched address and the six-decimal coordinate that will actually be queried before
   classification.
3. Increment a request-generation token for every new target.
4. Build cache identities from normalized coordinates:
   - FEMA: `lat.toFixed(5)_lon.toFixed(5)`
   - NWS alerts: `lat.toFixed(4)_lon.toFixed(4)`
   - NWPS list: `lat.toFixed(3)_lon.toFixed(3)`
5. Ignore every render result whose generation token is no longer current.

`Suite.fetchJSON` already prevents an old active-suite-location response from overwriting a new
active location, but `suite.flood.target` is independent. The page therefore needs its own token.
Because the shared helper also aborts when `suite.location` changes in another tab, wrap each flood
request with one narrowly scoped retry: if the helper reports an active-location change and the
flood generation token is still current, repeat the same coordinate-keyed request once under the
new suite-location snapshot. Never retry a superseded flood target or loop indefinitely.

### 5.2 Paint cached sections immediately

Read FEMA, alerts, and gauge envelopes independently. Render any available stale/fresh section
without waiting for another source. Every section carries its own source timestamp and stale label.

### 5.3 Stage requests around the critical answer

Do not put the whole page behind one `Promise.all`. Start the three independent, user-visible
sources together and render each section when it resolves:

1. **Critical FEMA classification** — layer 28 point query with limited fields and simplified
   geometry.
2. **Current alert status** — NWS point alerts, filtered client-side.
3. **Nearby conditions** — bounded NWPS list request.

As soon as layer 28 returns one or more zone features, start the two small FEMA enrichment requests
in parallel:

4. **FIRM context** — layer 3 panel point query with only
   `DFIRM_ID,FIRM_PAN,PANEL_TYP,EFF_DATE,SCALE,PNP_REASON,SOURCE_CIT`.
5. **Map revisions** — layer 1 LOMR point query with only
   `DFIRM_ID,LOMR_ID,EFF_DATE,CASE_NO,SCALE,STATUS,SOURCE_CIT`.

If layer 28 is empty, skip panel/LOMR and make only the layer 0 availability fallback. This keeps
the time-to-classification equal to the fastest FEMA query, avoids two useless calls outside NFHL
coverage, and still lets panel/revision details appear shortly afterward without delaying alerts or
gauges.

### 5.4 FEMA layer 28 request

Use:

```text
geometry={lon},{lat}
geometryType=esriGeometryPoint
inSR=4326
spatialRel=esriSpatialRelIntersects
outFields=DFIRM_ID,FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,V_DATUM,DEPTH,LEN_UNIT,VELOCITY,VEL_UNIT,DUAL_ZONE,SOURCE_CIT
returnGeometry=true
outSR=4326
geometryPrecision=5
maxAllowableOffset=0.00005
f=geojson
```

Do not request `outFields=*`. Do not omit the simplification controls: the live New Orleans polygon
was 1.37 MB unsimplified and about 19 KB simplified.

If several zone features intersect the point, retain and show all of them. Never pick the first
record as the sole answer. The summary says SFHA when **any** returned feature has `SFHA_TF=T`, but
the detail section lists every zone/subtype and any `DUAL_ZONE` value.

Treat `null`, string `"Null"`, non-finite numbers, and FEMA's `-9999` sentinel as missing. Only show
base flood elevation, depth, or velocity when a valid value and unit/datum are available.

If layer 28 returns no feature, query layer 0. Distinguish:

- NFHL coverage exists but no zone feature returned;
- NFHL coverage is not available; and
- the service could not be reached.

None of those states may render as “not in a flood zone.”

### 5.5 Panel and revision selection

Layer 3 may return overlapping panels. Rank/display panels as follows:

1. panel `DFIRM_ID` matches a returned zone's `DFIRM_ID`;
2. printed/effective panels before non-printed panels;
3. newest effective date;
4. if ambiguity remains, show all matching panels instead of guessing.

Layer 1 returns LOMR areas intersecting the exact point. Show case number, status, effective date,
and source identity, newest first. Wording must say the revision area intersects the point, not that
a legal determination has been made for a structure.

### 5.6 NWS alert filtering

Fetch the normal point-alert collection, then retain events whose event/headline includes flood or
storm-surge hydrologic wording. Include watches, warnings, advisories, statements, and hydrologic
outlooks; do not treat unrelated alerts as flood alerts.

Sort retained alerts by:

1. severity (`Extreme`, `Severe`, `Moderate`, `Minor`, `Unknown`),
2. urgency,
3. effective/sent time.

Display event, severity, area, effective/ending time, headline, and instructions when present. If the
response contains only unrelated alerts, say “No active flood-related NWS alert at this point,” not
“No active alerts.”

### 5.7 NWPS bounded search

Never call `/gauges` without a bounding box. Initial request:

- latitude: `lat +/- (radiusKm / 111.2)` — `+/- 0.1799` for the 20 km search, so the advertised
  radius is genuinely covered due north and south rather than only 16.7 km
- longitude: `lon +/- ((radiusKm / 111.2) / max(0.3, cos(latitude)))`
- `srid=EPSG_4326`
- `catfim=false`

Compute haversine distance locally and retain gauges within 20 km. Ignore non-finite coordinates and
`-999` status sentinels. Rank up to three cards by:

1. highest observed or forecast flood category (`major`, `moderate`, `minor`, `action`, then no
   flooding/undefined),
2. valid forecast availability,
3. distance.

This surfaces an active flood-stage gauge even if it is not the geographically nearest record.
Every card must still say the water body/site name and distance because the nearest gauge may not
represent the property's drainage path.

The list response already contains observed and forecast values, units, validity times, and flood
categories. Do not automatically fetch per-gauge metadata or stageflow.

If no useful gauge is found, offer two explicit actions:

- **Search within 50 km** — a larger one-time bbox request;
- **Open River & Streamflow Gauges** — `rivers.html`.

A future detail expander may fetch forecast-only stageflow for one selected gauge. Full observed
history and metadata remain user-initiated because live samples measured roughly 61-118 KB for
metadata and 125-392 KB for combined stageflow.

## 6. Rendering plan

### 6.1 Page order

1. Header and exact-target form.
2. **At a glance** three-column/stacked summary:
   - FEMA mapped hazard/SFHA;
   - active flood alert state;
   - most important nearby gauge state.
3. **FEMA mapped risk**:
   - zone code and FEMA subtype in plain language;
   - SFHA status;
   - valid BFE/depth/velocity values;
   - FIRM panel and effective date;
   - LOMR notice;
   - source/freshness stamp.
4. **Containing-zone footprint** SVG and textual equivalent.
5. **Current flood conditions**:
   - active NWS flood alerts;
   - up to three NWPS gauge cards.
6. **Verify officially** links to FEMA Map Service Center, the relevant FEMA service metadata, NWS,
   and NWPS.
7. Scope/disclaimer footer.

On narrow screens the summary and cards become a single column. No horizontal scrolling is allowed.

### 6.2 Zone interpretation

Use `SFHA_TF` and FEMA's returned `ZONE_SUBTY` as the primary interpretation. A small local table may
explain common codes (A/AE/AO/AH/VE/V/X/D), but it must fall back to the official subtype and never
invent a classification for an unknown code.

Never collapse zone X into one meaning: its subtype can describe either the 0.2-percent annual
chance hazard or an area of minimal mapped hazard.

Do not translate “outside SFHA” into “low/no risk.” Use wording such as:

> Outside the mapped Special Flood Hazard Area at this coordinate. Flooding can still occur, and
> map or property determinations may differ.

### 6.3 Inline SVG footprint

Render the simplified GeoJSON polygon without a map library:

- fixed local viewport centered on the checked point;
- local equirectangular projection suitable for the small display extent;
- clip paths to the viewport;
- FEMA zone fill/stroke plus a high-contrast point marker;
- no animation;
- redraw after theme changes;
- `role="img"` and an `aria-label` describing the zone and point.

Iterate Polygon and MultiPolygon rings and compute an approximate shortest distance from the point
to any ring segment in a local meter projection. Label it “approximate distance to this mapped zone
edge.” Suppress the number when geometry is malformed or the geolocation accuracy is too poor to
make it meaningful.

The SVG caption must state that only the polygon containing the point is drawn. Areas outside the
shape are not classified by this mini-view; use the official FEMA map for adjacent zones and street
context.

Do not use automatic ArcGIS export images or neighborhood envelope geometry. The feasibility probe
measured 19.3 seconds for export and up to 908 KB for a 2 km neighborhood query.

## 7. Cache and storage discipline

Proposed keys:

```text
suite.flood.target
suite.cache.flood.geocode.<normalized-query>
suite.cache.flood.fema.<lat5>_<lon5>
suite.cache.flood.alerts.<lat4>_<lon4>
suite.cache.flood.gauges.<lat3>_<lon3>
```

Rules:

- Use `{t,v}` envelopes and `Suite.store`/`Suite.fetchJSON` conventions.
- Keep FEMA, alert, and gauge timestamps independent.
- Merge successful FEMA subresults into an existing bundle so a panel timeout cannot erase a valid
  cached zone result.
- Bound the flood cache to the newest 10 coordinate targets and the newest 20 geocoder queries;
  prune only `suite.cache.flood.*`.
- Do not store automatically downloaded full hydrographs or neighborhood polygons.
- Cache identity never includes a human address alone; final FEMA/NWS/NWPS identity is coordinates.
- A target change may leave its coordinate-keyed cache entry, but it must never render into the new
  target because of the generation-token check.

## 8. Performance budget and acceptance

Live samples support this target budget:

- critical FEMA zone response: <= 25 KiB typical;
- full initial data transfer: <= 75 KiB typical for the 20 km gauge search;
- no single automatic response over 150 KiB;
- first uncached FEMA classification visible within 1.5 seconds on a normal broadband test path;
- cached classification visible before any network response;
- no automatic request count above six after an already-resolved address (zone, at most one
  GeoJSON→Esri dialect fallback, panel, LOMR, NWS alerts, NWPS gauges) — five when the primary
  zone dialect succeeds;
- no repeating timer for FEMA; current alerts/gauges refresh only at their TTL, on explicit refresh,
  or when a stale saved target is reopened/visibility returns;
- hidden tabs do not poll.

The New Orleans live sample totaled 60,179 B (58.8 KiB) for simplified zone geometry, panel, LOMR,
alerts, and the bounded gauge list. These are observations, not provider SLAs; tests must assert
request shapes and budgets against fixtures rather than hard-code live timings.

## 9. Failure and stale-state matrix

| Condition | Required UI |
|---|---|
| Address does not match | Ask for a complete U.S. address or coordinates; make no hazard claim |
| FEMA zone succeeds, panel fails | Show zone; panel says unavailable; preserve cached panel if any |
| FEMA returns multiple zones | Show all; SFHA summary is true if any feature says true |
| FEMA zone empty, availability present | “Coverage exists; no zone feature returned — verify officially” |
| FEMA availability empty | “NFHL coverage not available for this point” |
| Only stale FEMA cache exists | Render with exact cached timestamp and stale label |
| NWS has unrelated alerts only | “No active flood-related NWS alert”; do not say no alerts at all |
| NWS fails | Keep FEMA result; current-alert section says unavailable/stale |
| NWPS has no gauges within 20 km | Offer 50 km search and link to `rivers.html` |
| NWPS values are `-999`/out of service | Render unavailable/out-of-service, never a numeric reading |
| Target changes during requests | Old responses may cache by old coordinates but cannot update current UI |
| Entire network is blocked | Cached sections render independently; uncached sections explain what is unavailable |

## 10. Security, accessibility, and wording requirements

- Add only verified endpoint hosts to the manifest-generated CSP.
- The Census JSONP host goes in `scriptEndpoints`; all FEMA/NWS/NWPS endpoints go in `endpoints`.
- Use `textContent`/DOM construction for remote values. If `innerHTML` is used, every remote value is
  passed through `Suite.esc`.
- No inline event handlers and no remote scripts other than the narrowly allowed Census callback.
- Every async section is a polite live region, but loading changes must not repeatedly announce the
  whole page.
- Form labels, Enter submission, focus return after target selection, keyboard-operable disclosure
  controls, visible focus, reduced motion, and WCAG AA in both themes are mandatory.
- The map has a textual equivalent containing zone, SFHA status, and approximate edge distance.
- Keep alert instructions verbatim but clearly attributed to NWS.
- Prominent scope note:

> Informational screening only. This page classifies the coordinate you checked using public FEMA
> map data. It is not a parcel survey, elevation certificate, insurance quote, lender
> determination, or guarantee that flooding will or will not occur.

## 11. File-by-file implementation tasks

### Task A — release contract and scaffold

Files:

- `build.py`
- `manifest/tools.json`
- `tools/flood.html` (new)
- `tests/games-retire.mjs` (remove/update its current-count log rather than leaving `100` stale)

Work:

1. Change the release tool-count constant from 100 to 101 and remove v4-specific wording from the
   generic count gate/docstring while preserving under/over/duplicate negative tests.
2. Add manifest entry:
   - id/file: `flood` / `flood.html`
   - name: `Flood Risk & Conditions`
   - category: `earth`
   - complexity: `L`
   - network: `cors-open`
   - since: the chosen feature-release identity (recommended `v4.1`)
   - endpoints: FEMA NFHL, NWS API, NWPS API, Census geocoder
   - `scriptEndpoints`: Census geocoder only
   - storage: `suite.theme`, `suite.location`, target, and bounded flood cache keys
   - manifest `cacheTtlMin`: use the fastest automatic source (5) and document per-source TTLs in
     CATALOG/API docs.
3. Scaffold valid source HTML with shared CSS/JS markers; do not edit `dist/`.

Acceptance:

- under/over/duplicate count negative tests still fire;
- generated hub lists 101 tools exactly once;
- generated CSP records all four declared endpoint hosts in `connect-src` and only Census is added
  as a remote host in `script-src`.

### Task B — target acquisition

File: `tools/flood.html`

Work:

1. Coordinate parser and validation.
2. Census JSONP helper with timeout/cleanup and a seven-day bounded cache.
3. Device-position path preserving accuracy.
4. Explicit suite-location copy path.
5. Focused suite-location watcher that updates the shortcut without replacing the flood target.
6. Tool-specific target persistence and request-generation token.

Acceptance:

- one/multiple/no Census matches, direct coordinates, device point, approximate suite point,
  timeout, and target-change races are deterministic tests;
- an address lookup contacts Census only, displays the match point, and cannot start FEMA/NWS/NWPS
  before **Check this point**;
- direct/device points cannot start hazard requests before their explicit Check action;
- a cross-tab `suite.location` change updates the shortcut candidate but leaves the checked
  `suite.flood.target` and rendered result unchanged;
- if that cross-tab change occurs during a flood request, the still-current target retries once and
  completes; a superseded target does not retry or render.

### Task C — FEMA classification and footprint

File: `tools/flood.html`

Work:

1. Layer 28 simplified point query and normalizer.
2. Layer 3 panel query with DFIRM matching.
3. Layer 1 intersecting LOMR query.
4. Layer 0 fallback only for empty zones.
5. Composite bounded cache with partial-result preservation.
6. Plain-language status cards, sentinel handling, SVG footprint, and edge-distance calculation.

Acceptance:

- fixtures cover AE/SFHA, X 0.2-percent, X minimal, D/undetermined, VE/coastal, AO/depth, dual or
  overlapping zones, missing fields, `-9999`, no feature with/without availability, overlapping
  panels, and intersecting LOMR;
- geometry parser handles Polygon and MultiPolygon without page errors;
- no unsimplified or envelope request can be emitted.

### Task D — current alerts and gauges

File: `tools/flood.html`

Work:

1. NWS point request, flood-event filtering, severity sorting, and independent 5-minute cache.
2. NWPS bounded request, sentinel normalization, haversine filtering/ranking, and independent
   15-minute cache.
3. Optional 50 km user-triggered expansion and official gauge links.
4. Link to `rivers.html`; do not duplicate its USGS favorites board.

Acceptance:

- unrelated NWS alerts do not trigger a flood warning;
- flood watch/warning/advisory/outlook fixtures render correctly;
- active flood-stage gauge outranks a nearer no-flood gauge while still showing distance/site;
- unbounded `/gauges` and automatic stageflow requests are impossible by construction/test.

### Task E — documentation and catalog contract

Files:

- `CATALOG.md`
- `API-AND-RELAY.md`
- `ARCHITECTURE.md`
- `QUALITY.md`
- `README.md`
- `ROADMAP.md`
- `CLAUDE.md`

Work:

1. Add endpoint narratives, fields, TTLs, CORS verification, source limitations, and official links.
2. Add FEMA NFHL and NOAA NWPS to the source/rate registry.
3. Update 100/101-tool and 101/102-page current-release language at release time; preserve v4.0.0
   historical statements as historical facts.
4. Add a planned/completed roadmap entry with evidence links.
5. Record the absence of parcel/legal determination and the exact-address requirement.
6. Leave `V4_BRIEF.md` and `tests/evidence/v4-release/` unchanged: their 100-tool counts are
   historical release evidence, not current-product metadata.

Acceptance:

- manifest/CATALOG cross-check has no new warning;
- all counts agree across machine truth, docs, hub, smoke output, and release checklist.

### Task F — deterministic and live verification

New files:

- `tests/interactions/flood.mjs`
- `tests/flood-built.mjs`
- `tests/evidence/flood/` artifacts

Likely touched:

- `.github/workflows/pages.yml` to run `tests/flood-built.mjs` before deployment
- any other current-version aggregate test runner/list that enumerates focused gates
- release evidence/checklist files when actually releasing

Tests:

1. Route deterministic Census, FEMA layers 0/1/3/28, NWS, and NWPS fixtures.
2. Assert exact request parameters, field allowlist, simplification, bbox bounds, and absence of
   unbounded/history/export requests.
3. Exercise all failure/stale/race cases from sections 8-9.
4. Verify generated CSP and built `file://` behavior.
5. Verify remote strings cannot inject markup.
6. Run keyboard, live-region, map text-equivalent, both-theme, narrow/mobile, and horizontal-overflow
   checks.
7. Archive one live address/coordinate fetch with response values redacted to public fields only,
   timings/sizes, CORS, screenshots, and console/CSP output.
8. Test offline with each cache independently present/absent.

Commands/gates:

```text
python3 build.py
python3 build.py --check
cd tests && node flood-built.mjs
cd tests && node verify-tool.mjs flood
cd tests && node smoke.mjs
```

Run the existing PWA/installability/update gates because the precache grows and manifest/page counts
change. Archive all outputs under `tests/evidence/flood/` and the release evidence directory.

## 12. Release acceptance criteria

The feature is done only when:

- a matched address or entered coordinate produces the correct FEMA classification for the exact
  query point displayed by the built `file://` page;
- no ambiguous/empty source state is presented as “safe” or “outside flood risk”;
- panel identity matches zone `DFIRM_ID` or the ambiguity is shown;
- current NWS and NWPS sections cannot block the FEMA result;
- cached, stale, partial, offline, and target-race paths all render honestly;
- automatic network shape stays bounded and excludes export, neighborhood geometry, metadata, and
  history fan-out;
- generated CSP has no violation and remote data is escaped;
- focused tests, `build.py --check`, full smoke, PWA/installability, update, and hosted exact-artifact
  checks are green with archived evidence;
- source and generated `dist/` are in sync;
- no secrets, relay, account, framework, or runtime dependency is added.

## 13. Rollback

Before release, rollback is removal of `flood.html`, its manifest entry/tests/docs, restoration of the
100-tool count constant, and a rebuild. There is no shared-core or localStorage migration to undo.
Existing `suite.flood.*` browser keys are inert if the page is removed and can be purged through
Settings.

After release, prefer fixing or temporarily removing only the failing live subsection. FEMA, NWS,
and NWPS sections are independently rendered/cached, so an upstream outage should not require
retiring the whole tool.

## 14. Deferred enhancements

Only consider after the base page passes all gates:

- user-triggered forecast-only NWPS sparkline for one selected gauge;
- user-entered FEMA LOMA/LOMR case-number lookup;
- printable one-page screening summary with source timestamps and checked coordinates;
- URL fragment deep link containing coordinates, only after a privacy review and explicit share
  action;
- CatFIM/inundation products, only after a separate API/schema/coverage/performance spike.

Do not add a street basemap merely for appearance. The official FEMA map link is more accurate and
the inline footprint plus textual classification serves the Local Suite contract without tile
fan-out or a mapping dependency.
