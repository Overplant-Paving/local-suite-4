# Flood tool API feasibility probe

Date: 2026-07-31T12:48:32-05:00  
Repository revision: `8c27538`  
Scope: read-only live checks for a proposed Local Suite flood-risk tool. No credentials were used.

## Official services checked

- FEMA National Flood Hazard Layer (NFHL):
  `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer`
- National Weather Service active alerts:
  `https://api.weather.gov/alerts/active?point={lat},{lon}`
- NOAA National Water Prediction Service (NWPS):
  `https://api.water.noaa.gov/nwps/v1`
- NWPS Swagger document:
  `https://api.water.noaa.gov/nwps/v1/docs/swagger.json`

Requests supplied either `Origin: null` (the `file://` browser case) or
`Origin: https://overplant-paving.github.io`. An additional Playwright Chromium probe opened the
existing source `tools/geo.html` from `file://` and issued all three proposed initial-host requests
from the page context. FEMA, NWS, and NWPS each returned HTTP 200 with zero console/page errors:

| Browser `file://` request | Time | Download | Records |
|---|---:|---:|---:|
| FEMA simplified layer 28 point | 291 ms | 19,063 B | 1 feature |
| NWS point alerts | 111 ms | 8,424 B | 1 feature |
| NWPS bounded gauges | 324 ms | 28,171 B | 27 gauges |

The final generated `flood.html` CSP and complete rendering path still need to be exercised by the
focused built-page gate; the probe establishes actual `file://` CORS compatibility, not production
feature completion.

## FEMA service inventory and CORS

The NFHL service returned HTTP 200 and reported ArcGIS Server 11.1 with `Map,Query,Data`
capabilities, 32 layers, and a 2,000-record maximum per layer query.

Relevant layers:

| Layer | Name | Intended use |
|---:|---|---|
| 0 | NFHL Availability | Distinguish no returned zone from no NFHL coverage |
| 1 | LOMRs | Detect map revisions intersecting the checked point |
| 3 | FIRM Panels | Panel number, effective date, scale, and study identity |
| 28 | Flood Hazard Zones | Point classification and containing polygon |
| 34 | LOMAs | Not recommended for automatic nearby matching; a nearby point does not prove applicability |

Layer 28 reported `JSON, geoJSON, PBF` query support. Its verified classification fields were:
`DFIRM_ID`, `FLD_ZONE`, `ZONE_SUBTY`, `SFHA_TF`, `STATIC_BFE`, `V_DATUM`, `DEPTH`, `LEN_UNIT`,
`VELOCITY`, `VEL_UNIT`, `DUAL_ZONE`, and `SOURCE_CIT`. Missing numeric values appeared as FEMA's
`-9999` sentinel in the live sample and must not be displayed as real measurements.

The service echoed both tested origins and sent `Vary: Origin`:

- `Origin: null` -> `Access-Control-Allow-Origin: null`
- `Origin: https://overplant-paving.github.io` ->
  `Access-Control-Allow-Origin: https://overplant-paving.github.io`

All proposed FEMA operations are simple GETs with no custom request headers, so they do not require
a preflight.

## Measured request shapes

Measurements are single live observations, not an SLA. Times include this machine's network path.

### FEMA point classification

A New Orleans point (`29.9511,-90.0715`) returned zone X, subtype `0.2 PCT ANNUAL CHANCE FLOOD
HAZARD`, `SFHA_TF=F`, and `DFIRM_ID=22071C`.

| Shape | Time | Download | Result |
|---|---:|---:|---|
| Layer 28 point, limited attributes, no geometry | 0.209 s | 1,410 B | 1 feature |
| Layer 28 point, full unsimplified GeoJSON polygon | 1.019 s | 1,374,036 B | 1 feature |
| Layer 28 point, GeoJSON with `geometryPrecision=5` and `maxAllowableOffset=0.00005` | 0.295 s | 19,043 B | 1 feature |
| Same simplified request as PBF | 0.353 s | 148,760 B | larger than GeoJSON in this probe |
| Layer 3 panel point query | 0.205 s | 3,136 B | 2 overlapping panels |
| Layer 1 LOMR point query | 0.133 s | 1,384 B | 0 intersecting revisions |
| Multi-layer ArcGIS `identify` (0, 1, 3, 28) | 0.600 s | 2,180 B | returned string-valued attributes |

The point intersected two panels from different studies. The panel whose `DFIRM_ID` matched the
zone feature (`22071C`) was the relevant primary panel. An implementation must match identities
rather than pick the first panel.

The simplified point-polygon request was also checked at five cities:

| Point | Time | Download | Returned zone |
|---|---:|---:|---|
| New Orleans | 0.302 s | 19,063 B | X |
| Houston | 0.194 s | 14,710 B | X |
| Cedar Rapids | 0.182 s | 14,653 B | X |
| Miami | 0.161 s | 1,004 B | AE |
| Sacramento | 0.201 s | 5,516 B | X |

### Rejected automatic map requests

A roughly 2 km neighborhood envelope returned up to 167 polygons, 908,170 B, and 3.096 s in New
Orleans. Even a 250 m envelope returned 211,010 B. A FEMA `MapServer/export` PNG took 19.313 s for
65,121 B in the live sample. These shapes are not suitable for automatic page load.

The proposed map should therefore draw only the simplified polygon containing the point, with a
fixed local viewport and a clear statement that adjacent zones are not being classified. A full
street-context map remains an explicit link to FEMA's Map Service Center.

## NWS alerts

The NWS point request returned HTTP 200, `Access-Control-Allow-Origin: *`, GeoJSON, 8,424 B, and
0.116 s at the New Orleans sample point. It contained one non-flood alert (`Heat Advisory`), which
proves the tool must filter the response to flood/hydrologic events rather than treating any alert
as a flood alert.

## NOAA NWPS gauges

The official Swagger document exposes:

- `GET /nwps/v1/gauges` with `bbox.xmin`, `bbox.ymin`, `bbox.xmax`, `bbox.ymax`, and
  `srid=EPSG_4326`
- `GET /nwps/v1/gauges/{identifier}` for metadata and flood thresholds
- `GET /nwps/v1/gauges/{identifier}/stageflow/{observed|forecast}`

NWPS returned `Access-Control-Allow-Origin: *`. An unbounded gauges request was too large and timed
out during the initial probe; every browser request must use a small bounding box.

A +/-0.15 degree latitude box with longitude adjusted by `cos(latitude)` produced:

| Point | Time | Download | Gauges |
|---|---:|---:|---:|
| New Orleans | 0.436 s | 28,172 B | 27 |
| Houston | 0.345 s | 8,105 B | 8 |
| Cedar Rapids | 0.341 s | 3,049 B | 3 |
| Miami | 0.214 s | 4,070 B | 4 |
| Sacramento | 0.214 s | 4,100 B | 4 |

The list response already includes observed and forecast values, units, validity times, and flood
categories, so the initial page does not need per-gauge metadata requests. Individual gauge
metadata measured 60,981-117,706 B. Full stageflow responses measured 125,325-392,009 B because
observed histories can contain hundreds or thousands of points. Forecast-only stageflow was much
smaller (4,390-16,894 B) and is acceptable only after an explicit user action.

## Initial-load budget derived from the sample

New Orleans sample total for the proposed five calls:

- simplified FEMA zone polygon: 19,063 B
- FEMA panel: 3,136 B
- FEMA LOMR: 1,384 B
- NWS alerts: 8,424 B
- NWPS bounded gauge list: 28,172 B
- total: 60,179 B (58.8 KiB)

The critical classification plus alerts were 26.8 KiB. Because sections can load independently and
requests go to only three hosts, the UI should render FEMA classification as soon as layer 28
returns instead of waiting for every request.

## Feasibility verdict

The keyless direct-browser design is feasible based on current HTTP/CORS behavior and an exercised
Chromium `file://` fetch from a Local Suite source page. The performant shape is: exact point input,
limited point queries, simplified containing-zone geometry, bounded NWPS search, independent
caches, and no automatic neighborhood map/export or full gauge history. The remaining hard gate is
the generated `flood.html` itself under its final CSP, with mocked edge cases and an archived live
rendering run.
