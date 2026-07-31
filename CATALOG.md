# The Local Suite — a catalog of single-file command centers

A build-out plan for a family of **single-file HTML tools**: information dashboards and utilities
in the spirit of the Local Weather station. Every tool follows the same philosophy:

- **One `.html` file.** No build step, no framework, no npm. Inline CSS and JS. Copy it anywhere, double-click it, it works.
- **Free, open data — government sources first.** Your tax dollars already paid for NOAA, USGS, NASA, BLS, FDA. Use them.
- **No tracking, no ads, no accounts.** The only requests a tool makes are to the data source itself. Many tools make *zero* requests.
- **Pleasant and calm.** Readable typography, light/dark aware, graceful "data unavailable" states. Peace of mind, not engagement metrics.
- **Remembers politely.** Preferences (your location, favorite stations, units) live in `localStorage` on your machine — nowhere else.

> **How this list was checked (July 2026):** every API below was verified against current documentation.
> Endpoints marked **CORS ✓** are documented or widely community-confirmed as callable from browser
> JavaScript; ones marked **verify** should get a 10-second `fetch()` test from a `file://` page before
> you build on them; ones marked **no CORS** are confirmed blockers with the workaround stated.

## Suite conventions

Adopt these in every tool so the suite feels like one product:

1. **Location memory.** First run asks for a ZIP or uses the browser geolocation prompt once; store `{lat, lon, label}` in `localStorage` under a shared key like `suite.location` so every tool picks it up.
2. **Graceful degradation.** Every fetch wrapped with a timeout and a friendly offline/error card. A dashboard with stale data should say *when* the data is from, not pretend.
3. **Shared look.** A small common set of CSS variables (background, card, accent, text) with `prefers-color-scheme` dark mode. Copy the `:root` block between tools.
4. **Attribution footer.** One line naming the data source (e.g. "Data: National Weather Service") — good manners for free data, and it tells future-you where the data comes from.
5. **The `file://` rule of thumb.** APIs that send `Access-Control-Allow-Origin: *` work even when the page is opened straight from disk. If a tool misbehaves from `file://`, serve the folder with one line — `python -m http.server 8000` — and open `http://localhost:8000`. Some browser features (geolocation, clipboard) require this anyway. Note: a local server does **not** fix a missing-CORS API — those need a relay or a different source.
6. **Be a good citizen.** These are free services: cache responses in `localStorage` with a timestamp, refresh on sensible intervals (weather: 10 min; earthquakes: 5 min; CPI: daily), and identify yourself where the API asks (e.g. an `email=` or `application=` query param). One browser quirk: **don't set a custom `User-Agent` header from JS** — CORS preflight forbids it (NWS's User-Agent guidance is for server-side callers; your browser's own UA is accepted).
7. **Keys in a single file.** A few sources need a free key, which ends up visible in the file. That's fine for a personal local tool — just don't publish the file with your key in it.

**Legend** — each entry lists:
- **Data:** exact endpoints to call.
- **Key:** `none` (nothing at all), `free key` (instant registration), or `demo tier` (works keyless with low limits).
- **Local:** `file:// ✅` (CORS open — works opened from disk) · `relay ❌` (API blocks browser calls; needs a tiny proxy or a different source) · `offline 🟢` (no network at all) · `JSONP 🔶` (works via the old script-tag trick, which the API officially supports).
- **Complexity:** S (an evening) · M (a weekend) · L (a project).

---

## 1 · Weather & Sky

### 1.1 Weather Station — *built* ✅
The original: current conditions, forecast, and details for your saved location.
- **Data:** `https://api.weather.gov/points/{lat},{lon}` → forecast/hourly/stations URLs.
- **Key:** none · **Local:** file:// ✅ (CORS ✓) · **Complexity:** M
- **Suggested file:** `weather.html`

### 1.2 Severe Weather Alert Board
A wall-mountable board that turns red when it matters: active watches/warnings for your area, sorted by severity, with full alert text on tap.
- **Data:** `https://api.weather.gov/alerts/active?point={lat},{lon}` (or `?area={ST}`).
- **Key:** none · **Local:** file:// ✅ (CORS ✓) · **Complexity:** S
- **Nice touch:** browser Notification API for new alerts while the tab is open; severity color scale (Extreme→magenta, Severe→red, Moderate→orange).
- **Suggested file:** `alerts.html`

### 1.3 Radar & Satellite Viewer
Animated recent radar loop and GOES satellite imagery centered on your region.
- **Data:** NWS radar loops `https://radar.weather.gov/ridge/standard/{STATION}_loop.gif`; GOES sector imagery from `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/…` image sequences.
- **Key:** none · **Local:** file:// ✅ (images via `<img>` aren't subject to CORS) · **Complexity:** S for image loops, L for a pannable tile map.
- **Suggested file:** `radar.html`

### 1.4 Air Quality & UV Panel
Current AQI with pollutant breakdown (PM2.5, ozone) on the EPA color scale, today's UV index, and a multi-day outlook.
- **Data:** Open-Meteo Air Quality `https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&longitude={lon}&hourly=pm2_5,ozone,us_aqi` (keyless, CORS ✓). EPA UV daily by ZIP: `https://data.epa.gov/dmapservice/getEnvirofactsUVDAILY/ZIP/{zip}/json` (keyless; CORS verify — the old `enviro.epa.gov/efservice` URLs are legacy). Official AQI option: AirNow `https://www.airnowapi.org/aq/observation/zipCode/current/` (free key, 500 req/hr per endpoint).
- **Key:** none (Open-Meteo/EPA) / free key (AirNow) · **Local:** file:// ✅ · **Complexity:** S
- **Honest note on pollen:** no free US pollen API exists — Open-Meteo's pollen variables are Europe-only (CAMS model). Don't promise pollen.
- **Suggested file:** `air.html`

### 1.5 Space Weather & Aurora Station
Kp index gauge, solar wind speed, geomagnetic storm scale, and "can I see the aurora tonight?" for your latitude.
- **Data:** NOAA SWPC JSON — `https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json`, `https://services.swpc.noaa.gov/products/noaa-scales.json`, aurora oval `https://services.swpc.noaa.gov/json/ovation_aurora_latest.json` (~1 MB grid — cache it).
- **Key:** none · **Local:** file:// ✅ (CORS verify — widely used from browsers) · **Complexity:** M
- **Suggested file:** `spaceweather.html`

### 1.6 Sun & Moon Almanac
Sunrise/sunset, golden hour, moon phase with a drawn moon, solstice/equinox countdowns — beautiful and fully offline.
- **Data:** all computable client-side with ~200 lines of standard astronomy math (NOAA solar equations, Meeus moon phase) — embed it. Keyless cross-checks: `https://aa.usno.navy.mil/api/rstt/oneday?date={d}&coords={lat},{lon}` (USNO; CORS likely absent) or `https://api.sunrise-sunset.org/json?lat={lat}&lng={lon}&formatted=0` (CORS reportedly open; attribution link required).
- **Key:** none · **Local:** offline 🟢 (math version) · **Complexity:** M
- **Suggested file:** `almanac.html`

### 1.7 Tides & Currents Board
Next high/low tides, a smooth tide curve for today, and water temperature for your nearest NOAA station.
- **Data:** NOAA CO-OPS `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&station={id}&date=today&datum=MLLW&units=english&time_zone=lst_ldt&format=json&interval=hilo`; add an `application=local-suite` param (encouraged). Station metadata via the CO-OPS mdapi.
- **Key:** none · **Local:** file:// ✅ (CORS verify — widely used client-side) · **Complexity:** M
- **Suggested file:** `tides.html`

### 1.8 Buoy & Marine Conditions
Wave height, period, wind, and water temp — surfers' and sailors' glanceboard.
- **Data:** primary: Open-Meteo Marine `https://marine-api.open-meteo.com/v1/marine?latitude={lat}&longitude={lon}&hourly=wave_height,wave_period` (keyless, CORS ✓). NDBC buoy feeds (`https://www.ndbc.noaa.gov/data/realtime2/{station}.txt`) are confirmed **no CORS** — browser fetch fails; only worth it if you run a tiny relay.
- **Key:** none · **Local:** file:// ✅ (Open-Meteo) / relay ❌ (NDBC) · **Complexity:** M
- **Suggested file:** `marine.html`

### 1.9 Climate "Normals" Comparator
"Is this July actually hotter than normal?" — today's conditions vs. 30-year normals for your station, plus record highs/lows.
- **Data:** NOAA NCEI Access API `https://www.ncei.noaa.gov/access/services/data/v1?dataset=normals-daily&…` (keyless for small queries; CORS ✓ — `Access-Control-Allow-Origin: *` verified Jul 2026. Gotcha: `units=standard` returns °F directly, not tenths).
- **Key:** none · **Local:** file:// ✅ (verified) · **Complexity:** L (NCEI's APIs are the least friendly of NOAA's)
- **Suggested file:** `normals.html`

---

## 2 · Earth & Nature

### 2.1 Earthquake Monitor
Live world/regional quake map and list, filterable by magnitude and distance from you; new-quake highlight.
- **Data:** USGS GeoJSON feeds — `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson` (also `2.5_week`, `significant_month`…); parameterized queries via `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson`. Keyless, CORS ✓, CDN-cached — the most dependable API in this whole catalog.
- **Key:** none · **Local:** file:// ✅ · **Complexity:** S (list) / M (draw dots on an embedded SVG world map — no tile server needed)
- **Suggested file:** `quakes.html`

### 2.2 River & Streamflow Gauges
Current gauge height and discharge for your favorite rivers, with flood-stage context — fishing, paddling, and flood awareness.
- **Data:** **build on the new** USGS Water Data API `https://api.waterdata.usgs.gov` (keyless; optional key raises limits). The legacy `waterservices.usgs.gov/nwis/iv/?format=json` still answers but is being decommissioned (degradation possible after Aug 2026, gone ~Q1 2027).
- **Gotcha (verified Jul 2026, v2 migration):** the OGC API **rejects unknown query params** — appending the good-citizen `application=local-suite` param draws HTTP 400 `InvalidQuery` (curl-verified: same URL 200 without it). Identify-yourself params are per-API: CO-OPS wants `application=`, this API forbids it.
- **Key:** none · **Local:** file:// ✅ (verify) · **Complexity:** M
- **Suggested file:** `rivers.html`

### 2.3 Wildfire Watchboard
Active large fires near you: name, size, containment, distance; smoke context via the air-quality data.
- **Data:** NIFC/WFIGS ArcGIS feature services (keyless, ArcGIS sends CORS ✓): incidents `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?f=geojson&where=1=1`, perimeters `…/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query`. NASA FIRMS satellite hotspots need a free MAP_KEY (5,000 calls/10 min).
- **Key:** none (WFIGS) / free key (FIRMS) · **Local:** file:// ✅ · **Complexity:** M
- **Suggested file:** `wildfire.html`

### 2.4 Drought Monitor
Your county's current U.S. Drought Monitor category and the trend over the past year.
- **Data:** ⚠️ USDM data services `https://usdmdataservices.unl.edu/api/…` are confirmed **no CORS** (no ACAO header; OPTIONS → 405, verified Jul 2026). Browser-friendly source for the same weekly USDM data: Esri Living Atlas ArcGIS `https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/US_Drought_Intensity_v1/FeatureServer` (CORS ✓ — layer 3 current point-in-polygon category, layer 2 weekly history). County FIPS/name from FCC block API `https://geo.fcc.gov/api/census/block/find` (keyless, CORS ✓).
- **Key:** none · **Local:** file:// ✅ (via Living Atlas) / relay ❌ (USDM direct) · **Complexity:** S
- **Suggested file:** `drought.html`

### 2.5 Volcano Status Board
U.S. volcanoes currently at elevated alert level, with color codes and links to activity notices. (Quietly reassuring most of the time.)
- **Data:** USGS HANS `https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes` (CORS ✓ verified Jul 2026; ~~`getVolcanoesUs`~~ does **not** exist — route error; enrich coordinates/threat via `volcanoes.usgs.gov/vsc/api/volcanoApi/elevated` instead, matched by vnum).
- **Key:** none · **Local:** verify · **Complexity:** S
- **Suggested file:** `volcano.html`

### 2.6 Snowpack & SNOTEL
Mountain snow depth and snow-water equivalent from SNOTEL stations — skiers and water-supply watchers.
- **Data:** USDA AWDB REST `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data` (keyless, CORS ✓ verified Jul 2026; Swagger docs at `/awdbRestApi/swagger-ui/index.html`). Gotcha: `/stations` ignores network/state filter params — fetch `stationTriplets=*:*:SNTL&activeOnly=true` (~900 stations with coords) and rank nearest client-side.
- **Key:** none · **Local:** verify · **Complexity:** M
- **Suggested file:** `snow.html`

### 2.7 Wildlife Sightings Nearby *(global source)*
Recent notable bird sightings around you (eBird) or all-taxa observations (iNaturalist).
- **Data:** iNaturalist `https://api.inaturalist.org/v1/observations?lat={lat}&lng={lon}&radius=25&order_by=observed_on` (keyless, CORS ✓). eBird needs a free key. Observation photos load from `inaturalist-open-data.s3.amazonaws.com` and `static.inaturalist.org`; the eBird API host is `api.ebird.org` (key via x-ebirdapitoken header) — v2, Jul 2026.
- **Key:** none (iNat) / free key (eBird) · **Local:** file:// ✅ · **Complexity:** S
- **Suggested file:** `wildlife.html`

### 2.8 Flood Risk & Conditions — *release candidate* 🔶 (v4.1; live acceptance green)
FEMA flood-zone screening for one exact U.S. point, plus active NWS flood alerts and nearby NOAA
forecast gauges. Deliberately **not** a risk score, parcel survey, or legal determination — it
classifies the coordinate you confirm and links to the official FEMA map for verification.
- **Data:** FEMA National Flood Hazard Layer ArcGIS service
  `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer` (keyless, CORS ✓ — echoes
  `Origin: null` and the GitHub Pages origin with `Vary: Origin`; verified live from a `file://`
  Chromium page 2026-07-31, evidence `tests/evidence/flood-feasibility/live-probe.md`). Layers used:
  28 flood-hazard zones (limited `outFields`, simplified point GeoJSON via `geometryPrecision=5` +
  `maxAllowableOffset=0.00005` — 19 KB vs 1.37 MB unsimplified; gotcha, observed live 2026-07-31
  afternoon and re-probed that evening: during a query-backend degradation the service answers
  HTTP 200 with embedded ArcGIS 400 error bodies — `f=geojson` draws a misleading "output spatial
  reference is not supported" validation error even with `outSR` omitted, while `f=json` draws
  "Failed to execute query". A bounded shape-by-shape probe
  (`tests/evidence/flood/fema-outage-2026-07-31.md`) established there is **no request-shape
  workaround**: attributes-only, count-only and ids-only queries fail identically at multiple
  points, and layers 3 and 1 fail with them, while layer 0 and the service metadata stay healthy —
  the layers' data source is down, not the request. The tool therefore treats error-in-200 bodies
  and unreadable-but-200 bodies as failures and shows the unavailable state; it still falls back
  exactly once from the GeoJSON dialect to the identical simplified Esri JSON query (normalized
  client-side), which recovers a genuine geojson-only rejection for one bounded request),
  3 FIRM panels, 1 LOMRs (both only
  after a zone record exists), 0 availability count (only when the zone answer is empty). NWS active
  alerts `https://api.weather.gov/alerts/active?point={lat},{lon}` (keyless, CORS ✓), filtered
  client-side to flood/hydrologic/storm-surge events. NOAA National Water Prediction Service
  `https://api.water.noaa.gov/nwps/v1/gauges` (keyless, CORS ✓) — **always bounded** with
  `bbox.*` + `srid=EPSG_4326&catfim=false` (an unbounded request times out); per-gauge
  metadata/stageflow (61–392 KB live) is never fetched automatically. Address matching only via the
  US Census geocoder `https://geocoding.geo.census.gov` (JSONP 🔶, same channel as geo.html), with a
  mandatory explicit point-confirmation step before any hazard request.
- **TTLs:** geocode + FEMA zone/panel/availability 7 d · LOMR 24 h · alerts 5 min · gauges 15 min;
  caches are coordinate-keyed, bounded (10 coordinate targets, 20 geocode queries), independent per
  source. Manifest `cacheTtlMin: 5` records the fastest automatic source.
- **Limitations:** the sources classify a coordinate, not a structure or parcel; Census matches can
  be interpolated street points; an empty zone answer is never rendered as "no flood risk", and
  neither is a service failure or a malformed HTTP 200 payload. Each FEMA sub-result (zone, panel,
  LOMR, availability) carries its own freshness: one whose refresh failed, or that is past its own
  TTL, is labelled "not re-verified in this check" rather than shown as current. "Refresh current
  conditions" always attempts the network regardless of TTL and falls back to the cached copy,
  which then stamps itself offline.
- **Key:** none · **Local:** file:// ✅ · **Complexity:** L
- **File:** `flood.html`

---

## 3 · Space & Flight

### 3.1 ISS Tracker
Where the Space Station is right now on a world map, its ground speed, and when it's overhead.
- **Data:** `https://api.wheretheiss.at/v1/satellites/25544` (keyless, ~1 req/sec — a 5-second refresh is plenty). Compute visible passes client-side from its TLE (`/satellites/25544/tles`) with an embedded SGP4 routine — the old open-notify pass-times API was permanently discontinued (its `iss-now.json` survives but is HTTP-only).
- **Key:** none · **Local:** file:// ✅ · **Complexity:** S (position dot) / L (pass predictions)
- **Suggested file:** `iss.html`

### 3.2 Astronomy Picture of the Day
NASA's APOD with its explanation — a serene "new tab" page.
- **Data:** `https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY` (demo tier documented 30 req/hr, 50/day per IP — **observed headers said 10/hr, Jul 2026**; a free key raises it to 1,000/hr). CORS ✓ (v2 live from file://, Jul 2026). Image hosts: apod.nasa.gov; video days link out (thumbnails img.youtube.com / i.vimeocdn.com).
- **Key:** demo tier / free key · **Local:** file:// ✅ · **Complexity:** S
- **Suggested file:** `apod.html`

### 3.3 Near-Earth Asteroid Watch
Today's close approaches: how big, how fast, how close (in lunar distances) — existential perspective with breakfast.
- **Data:** JPL SSD close-approach API `https://ssd-api.jpl.nasa.gov/cad.api` — **CORS regression (verified Jul 2026): cad.api no longer sends ACAO for any origin; all browser fetches blocked. Re-sourced to NeoWs (api.nasa.gov/neo/rest/v1/feed, CORS ✓ live-verified Jul 2026, demo tier) in Batch C — 30-day view paged as 4×7-day requests; NeoWs miss_distance.lunar uses a flat 389 LD/AU (tool keeps 384,400 km LD, ~0.044% delta).** `` (fully keyless); or NASA NeoWs `https://api.nasa.gov/neo/rest/v1/feed/today?api_key=DEMO_KEY`.
- **Key:** none (JPL) / demo tier (NeoWs) · **Local:** file:// ✅ · **Complexity:** S
- **Suggested file:** `asteroids.html`

### 3.4 Rocket Launch Schedule
Upcoming launches worldwide with countdowns, vehicle, pad, and mission blurbs.
- **Data:** Launch Library 2 — current version is **2.3.0 with renamed routes**: `https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=10&mode=list` (note `launches`, plural — the 2.2.0 `/launch/` path is legacy). Keyless, throttled 15 req/hr — cache in localStorage and refresh hourly. CORS ✓ (v2 live from file://, Jul 2026).
- **Key:** none · **Local:** file:// ✅ (verify) · **Complexity:** S
- **Suggested file:** `launches.html`

### 3.5 Airport & Flight-Weather Board
Departure-board-style view: METARs/TAFs for airports you care about, decoded to plain English, plus FAA delay status.
- **Data:** ⚠️ both natural sources block browsers: `https://aviationweather.gov/api/data/metar?ids=KJFK&format=json` has **CORS disabled** (confirmed), and FAA NAS status `https://nasstatus.faa.gov/api/airport-status-information` is XML-only and likely closed too. This tool needs a tiny relay (a 10-line CORS proxy you host) — or descope to linking out.
- **Key:** none · **Local:** relay ❌ · **Complexity:** M (plus the relay)
- **Suggested file:** `airport.html`

### 3.6 Individual Flight Tracker
Track one dated commercial flight with status, current or last-known coordinates, altitude,
speed, and the provider's estimated arrival time.
- **Data:** Aviationstack `https://api.aviationstack.com/v1/flights?access_key={key}&flight_iata=AA100&limit=100`, with records disambiguated locally by service date; when Aviationstack omits `live`, the tracker resolves its `aircraft.icao24` through keyless Airplanes.live `https://api.airplanes.live/v2/hex/{icao24}`. The Aviationstack personal tier advertises 100 requests/month; historical lookup is paid-only. Successful keyed Aviationstack and keyed-to-ADS-B position probes were live-verified Jul 2026; Airplanes.live returned `Access-Control-Allow-Origin: *` for `Origin: null`.
- **Weather map (v4):** the regional map combines the aircraft position with a live
  precipitation grid from keyless Open-Meteo `https://api.open-meteo.com/v1/forecast`
  (32-point multi-location `current=precipitation,weather_code` in one request, 5 min TTL)
  and active SIGMET hazard polygons from `https://api.weather.gov/aviation/sigmets`
  (10 min TTL; the aviation feed emits `[lat, lon]` rings, corrected client-side).
  Departure/arrival conditions come from `https://api.weather.gov/stations/{ICAO}/observations/latest`
  (10 min TTL, decoded, raw METAR shown when present; NWS covers mostly US airports — a
  designed "not available" card otherwise), and the arrival-hour outlook resolves the
  station's coordinates via `https://api.weather.gov/stations/{ICAO}` (7 d TTL) into an
  Open-Meteo hourly forecast (30 min TTL). All four weather surfaces are keyless + CORS-open
  (`Access-Control-Allow-Origin: *` re-verified 2026-07-30), so the map works from file://
  and each panel shows its own cached/stale stamp. The IWXXM TAF detail feed was evaluated
  and rejected: `api.weather.gov/stations/{id}/tafs/...` serves XML only.
- **Key:** personal Aviationstack key, user-created at `https://aviationstack.com/signup/free`, stored as `suite.key.aviationstack`; never committed · **Local:** file:// live-verified for both provider surfaces Jul 2026 · **Complexity:** M
- **Suggested file:** `flight.html`

### 3.7 Satellite Pass Predictor
When bright satellites (ISS, Starlink trains, Hubble) pass over your backyard tonight.
- **Data:** CelesTrak TLEs `https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json` + embedded SGP4 math (keyless); or N2YO API (free key, 1,000 req/hr) if you'd rather not implement SGP4.
- **Key:** none (CelesTrak+math) / free key (N2YO) · **Local:** file:// ✅ (verify CelesTrak) · **Complexity:** L
- **Suggested file:** `passes.html`

---

## 4 · Civic & Government

### 4.1 Federal Register Daily
What the federal government published *today*: rules, proposed rules, executive orders — filterable by agency and topic.
- **Data:** `https://www.federalregister.gov/api/v1/documents.json?conditions[publication_date][is]={date}&per_page=20` (keyless, well-documented, widely used client-side).
- **Key:** none · **Local:** file:// ✅ · **Complexity:** S
- **Suggested file:** `fedregister.html`

### 4.2 Congress Tracker
Recent bills, what passed this week, and your delegation's latest sponsored legislation.
- **Data:** Congress.gov API `https://api.congress.gov/v3/bill?api_key={key}` (free instant key via api.data.gov, 5,000 req/hr). Bill text via GovInfo `https://api.govinfo.gov/` (same api.data.gov key works).
- **Key:** free key · **Local:** verify (api.data.gov umbrella) · **Complexity:** M
- **Suggested file:** `congress.html`

### 4.3 Recall Radar
One board for the recalls that actually reach your household: food (FDA), vehicles (NHTSA — enter your cars once), and consumer products (CPSC).
- **Data:** openFDA `https://api.fda.gov/food/enforcement.json?search=distribution_pattern:"{state}"&limit=20` (keyless 240 req/min & 1,000/day per IP, CORS ✓); NHTSA `https://api.nhtsa.gov/recalls/recallsByVehicle?make={m}&model={mo}&modelYear={y}` (keyless; CORS ✓ — echoes request Origin, verified Jul 2026); CPSC `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart={date}` (keyless; **always filter** — unfiltered returns the entire dataset; CORS ✓ — `Access-Control-Allow-Origin: *` verified live Jul 2026, so all three panels can be built browser-side).
- **Key:** none · **Local:** file:// ✅ (openFDA) / verify (NHTSA, CPSC) · **Complexity:** M
- **Suggested file:** `recalls.html`

### 4.4 National Parks Explorer
A park-centered explorer for all 29 documented NPS API resources: overview, alerts, trip planning,
activities, learning material, multimedia, amenities, topic catalogs, road data, and boundaries.
- **Data:** NPS API `https://developer.nps.gov/api/v1/*`, authenticated with the safer
  `X-Api-Key` header (free personal key; default 1,000 requests per rolling hour). Park and
  resource images are served from `https://www.nps.gov/common/uploads/`. Both hosts are CORS/CSP
  allowlisted for `file://`; header preflight and `Origin: null` were verified Jul 2026.
- **Behavior:** a lightweight directory is cached 30 days, but the selected `/parks?parkCode=…`
  detail has a separate two-hour identity and its real provider/cache timestamp is shown.
  Resource groups load sequentially only when their tab opens, preventing a rejected key or 429
  from fanning out; exposed rate headers and the cooldown are visible. Standard resources use
  `start`/`limit` pagination while Events uses `pageNumber`/`pageSize`. Reference/media data use
  longer TTLs; stale cache is labeled and retained offline. Gallery assets are scoped by
  `galleryId` (including paging) because that endpoint ignores `parkCode`.
- **v4 re-audit (2026-07-30):** the official swagger specification still documents exactly these
  29 resources — none added, renamed, or removed since v3 — and a conservative one-request-per-
  resource live probe returned HTTP 200 for all 29 (evidence:
  `tests/evidence/v4-release/nps-live-probe.txt`). `/events` and `/roadevents`, which failed
  upstream during v3 verification, are healthy again and now load with their tab; real WZDx
  road events nest their fields under `core_details`, which the page unwraps.
  `/mapdata/parkboundaries/{sitecode}` is also healthy but its GeoJSON runs 190–315 KB per park
  (measured yell/dena), so it stays on demand, is never written to browser storage, and is now
  drawn as a simplified boundary outline with geometry types, coordinate count, bounds, center,
  and approximate area. Road GeoJSON retains and describes its geometry. Endpoint-specific
  renderers expose campground site/reservation/accessibility data, event timing/location/
  recurrence, parking live wait/accessibility, visitor-center contacts/hours/directions, activity
  duration/location/accessibility, relationship contents, and multimedia/caption facts.
- **Key:** free key · **Local:** file:// ✅ · **Complexity:** L
- **Suggested file:** `parks.html`

### 4.5 Treasury & National Debt Dashboard
Debt to the penny, interest on the debt, and auction results — the country's balance sheet at a glance.
- **Data:** FiscalData (keyless): `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1`, `v2/accounting/od/avg_interest_rates`, `v1/accounting/od/auctions_query`. Note: the *daily par yield curve* is **not** in FiscalData — it's XML/CSV on home.treasury.gov.
- **Key:** none · **Local:** file:// ✅ (verify) · **Complexity:** S
- **Suggested file:** `treasury.html`

### 4.6 Holiday & Observance Calendar
Federal holidays, market closures, DST changes, and "long weekend" countdowns for the year.
- **Data:** compute offline (US federal holidays are pure date math) — or Nager.Date `https://date.nager.at/api/v3/PublicHolidays/{year}/US` (keyless, explicitly "CORS enabled, browser ready", no rate limits; also `/LongWeekend/{year}/US`).
- **Key:** none · **Local:** offline 🟢 / file:// ✅ · **Complexity:** S
- **Suggested file:** `holidays.html`

### 4.7 Election & Voting Info *(seasonal)*
Registration deadlines, polling place lookup, and what's on your ballot.
- **Honest note:** this one resists the single-file pattern — the good lookup APIs need keys and terms; states fragment the rest. Keep it a curated static page of your state's deadlines + official lookup links, refreshed each cycle.
- **Key:** none · **Local:** offline 🟢 · **Complexity:** S
- **Suggested file:** `voting.html`

---

## 5 · Money & Economy

### 5.1 Cost-of-Living Tracker (CPI)
Inflation at a glance: headline CPI, core CPI, and the categories that hit home, with year-over-year sparklines.
- **Data:** ⚠️ BLS Public Data API (`https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0`, v1 keyless 25 queries/day; v2 free key 500/day) is confirmed **no CORS** — browser fetch fails from any origin. Options: a tiny relay; or a "refresh button that opens the BLS page" hybrid; or pre-baked monthly data you paste in (CPI updates once a month — honestly fine).
- **Key:** none/free key · **Local:** relay ❌ (or monthly manual paste 🟢) · **Complexity:** M
- **Suggested file:** `inflation.html`

### 5.2 Gas Price Tracker
National and regional average gas/diesel prices with trend lines.
- **Data:** EIA API v2 `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key={key}&frequency=weekly&data[0]=value` (free instant key; v1 is retired).
- **Key:** free key · **Local:** verify · **Complexity:** S
- **Suggested file:** `gas.html`

### 5.3 Exchange Rate Board
A currency board and converter for travel or remittances, with 30-day trend.
- **Data:** Frankfurter `https://api.frankfurter.dev/v1/latest?base=USD` (ECB reference rates, keyless, CORS ✓ — the `.dev` domain is current; `.app` still resolves); `https://open.er-api.com/v6/latest/USD` as a second keyless source (daily rates, attribution required).
- **Key:** none · **Local:** file:// ✅ · **Complexity:** S
- **Suggested file:** `currency.html`

### 5.4 Treasury Interest & Savings Glance
Average interest rates on treasuries and recent auction yields — the "should I move my savings" glance.
- **Data:** FiscalData `avg_interest_rates` + `auctions_query` datasets (keyless — see 4.5). The official daily par yield curve lives on home.treasury.gov as XML/CSV, not in an API — link out or parse the CSV via relay.
- **Key:** none · **Local:** file:// ✅ (verify) · **Complexity:** M
- **Suggested file:** `yields.html`

### 5.5 Jobs & Unemployment Snapshot
Unemployment rate, labor-force participation, latest jobs-report numbers.
- **Data:** BLS series `LNS14000000` etc. — same **no-CORS** caveat as 5.1; build the two as one `economy.html` behind one relay/paste workflow.
- **Key:** none/free key · **Local:** relay ❌ · **Complexity:** S once 5.1's plumbing exists
- **Suggested file:** `jobs.html`

### 5.6 Market Snapshot *(honest caveat)*
Index levels and a few tickers, once a day.
- **Data:** truly keyless + CORS-open stock quotes don't exist in 2026 — vendors monetize this data. Best free-key options: **Finnhub** (60 calls/min, CORS ✓) or Twelve Data (800/day); Alpha Vantage's free tier fell to 25 req/day. Stooq's keyless CSV has no CORS. Crypto is easier: CoinGecko `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd` (keyless ~5–15 calls/min, CORS ✓).
- **Key:** free key (stocks) / none (crypto) · **Local:** file:// ✅ · **Complexity:** M
- **Suggested file:** `markets.html`

---

## 6 · Health & Safety

### 6.1 Illness Activity Tracker
Flu/respiratory activity for your state, COVID wastewater trend — "should I be extra careful this week?"
- **Data:** CDC open data (Socrata — keyless for light use, free app token raises to ~1,000 req/hr, CORS ✓): NWSS wastewater `https://data.cdc.gov/resource/g653-rqe2.json?$limit=50` (raw sewershed; the built tool uses the state-percentile dataset `2ew6-ywp6` — v2, Jul 2026), NHSN weekly hospital respiratory data `…/resource/ua7e-t2fy.json`. (Dataset IDs rotate over the years — confirm on data.cdc.gov at build time; classic FluView/ILINet is CSV downloads, not Socrata.)
- **Key:** none · **Local:** file:// ✅ · **Complexity:** M
- **Suggested file:** `illness.html`

### 6.2 Medicine Cabinet Lookup
Type a drug name → plain-language label info: uses, warnings, interactions section, recalls.
- **Data:** openFDA `https://api.fda.gov/drug/label.json?search=openfda.brand_name:"{name}"&limit=1` and `/drug/enforcement.json` (keyless, CORS ✓).
- **Key:** none · **Local:** file:// ✅ · **Complexity:** M
- **Suggested file:** `medicine.html`

### 6.3 Food Recall Alerts
Standalone slim version of the Recall Radar focused on food, filtered to your state.
- **Data:** openFDA food enforcement (see 4.3).
- **Key:** none · **Local:** file:// ✅ · **Complexity:** S
- **Suggested file:** `foodrecalls.html`

### 6.4 Emergency Quick-Reference *(fully offline)*
First-aid steps, poison control number (1-800-222-1222), CPR rhythm, emergency contact card, ICE info — the page you hope to never open, guaranteed to work with no internet.
- **Data:** none — curated static content, editable in the file.
- **Key:** none · **Local:** offline 🟢 · **Complexity:** S
- **Suggested file:** `emergency.html`

### 6.5 Nutrition Lookup
Search a food, get calories/macros/nutrients; build a small "compare two foods" view.
- **Data:** USDA FoodData Central `https://api.nal.usda.gov/fdc/v1/foods/search?query={q}&api_key=DEMO_KEY` (demo: 30/hr, 50/day; free instant key: 1,000/hr). CORS ✓ (v2 live search from file://, Jul 2026).
- **Key:** demo tier / free key · **Local:** verify · **Complexity:** M
- **Suggested file:** `nutrition.html`

---

## 7 · Reference & Lookup

### 7.1 Dictionary & Thesaurus
Instant definitions, pronunciation, synonyms — the no-ads dictionary.
- **Data:** `https://api.dictionaryapi.dev/api/v2/entries/en/{word}` (keyless, CORS works in practice; a hobby project that occasionally throttles — cache lookups). Sturdier fallback: Wiktionary `https://en.wiktionary.org/api/rest_v1/page/definition/{term}` (keyless, CORS ✓, marked experimental).
- **Key:** none · **Local:** file:// ✅ · **Complexity:** S
- **Suggested file:** `dictionary.html`

### 7.2 Wikipedia Reader
Search + clean reader view for Wikipedia summaries; "random article" button; on-this-day and featured-article panels.
- **Data:** `https://en.wikipedia.org/api/rest_v1/page/summary/{title}` — thumbnails from `upload.wikimedia.org` (img-src); the built tool uses `onthisday/selected` (not `/all`) — v2, Jul 2026. ``, `…/api/rest_v1/feed/onthisday/all/{MM}/{DD}`, `…/api/rest_v1/feed/featured/{YYYY}/{MM}/{DD}` (keyless, CORS ✓; Wikimedia is tightening anonymous rate limits in 2026 — a personal tool's volume is far below them).
- **Key:** none · **Local:** file:// ✅ · **Complexity:** M
- **Suggested file:** `wiki.html`

### 7.3 Unit & Kitchen Converter *(fully offline)*
Every conversion you actually use: cooking volumes/weights (with ingredient densities), length/area, temperature, fuel economy, plus "half this recipe."
- **Data:** none — conversion tables embedded.
- **Key:** none · **Local:** offline 🟢 · **Complexity:** S
- **Suggested file:** `convert.html`

### 7.4 ZIP & Area Code Lookup
ZIP → city/state/coordinates; city → ZIPs; area code → region.
- **Data:** `https://api.zippopotam.us/us/{zip}` (keyless, CORS ✓ per its docs); area-code table is small enough to embed (offline).
- **Key:** none · **Local:** file:// ✅ / offline 🟢 · **Complexity:** S
- **Suggested file:** `zip.html`

### 7.5 Country & State Factbook
> **As shipped (v1 + v2, verified Jul 2026):** the built tool is fully offline — ~190 countries + 50 states embedded as constants, flags as emoji codepoints. The restcountries/Census endpoints below were the plan, kept as the upgrade path.

Pick a country: flag, capital, population, currency, languages. Pick a state: quick Census facts.
- **Data:** `https://restcountries.com/v3.1/name/{name}?fields=name,capital,population,currencies,languages,flags` (keyless, CORS ✓; note `/v3.1/all` now returns 400 **unless** you pass `?fields=…`). US Census data API `https://api.census.gov/data/2023/acs/acs5?get=NAME,B01001_001E&for=state:*` (keyless up to 500 queries/day/IP).
- **Key:** none · **Local:** file:// ✅ · **Complexity:** S
- **Suggested file:** `factbook.html`

### 7.6 Word of the Day & Etymology Desk
A daily word with definition and origin; keeps a little "words I've met" list in localStorage.
- **Data:** dictionaryapi.dev / Wiktionary (7.1) — or fully offline with an embedded curated list of a few hundred good words.
- **Key:** none · **Local:** file:// ✅ / offline 🟢 · **Complexity:** S
- **Suggested file:** `word.html`

### 7.7 Book & Library Lookup
Search books, see covers/editions, keep a "read next" list; ISBN lookup.
- **Data:** Open Library `https://openlibrary.org/search.json?q={q}` (keyless, CORS ✓ on search; 1 req/s anonymous). Covers: load `https://covers.openlibrary.org/b/isbn/{isbn}-M.jpg` as `<img>` (the covers host has CORS gaps for fetch — images don't care). Google Books keyless `https://www.googleapis.com/books/v1/volumes?q=` as backup. Google Books fallback: `www.googleapis.com` (JSON) + `books.google.com` (thumbnails) — v2, Jul 2026.
- **Key:** none · **Local:** file:// ✅ · **Complexity:** S
- **Suggested file:** `books.html`

### 7.8 Museum Postcard
A daily artwork from an open-access collection, with title/artist/date — like APOD for art.
- **Data:** ⚠️ the Met's JSON API (`https://collectionapi.metmuseum.org/public/collection/v1/objects/{id}`) is keyless but **CORS-disabled** — its *images* load fine via `<img>`, so either embed a curated list of a few hundred object IDs + image URLs (refresh the list occasionally), or use a relay. Alternatives with browser-open APIs: Art Institute of Chicago `https://api.artic.edu/api/v1/artworks` — AIC images from `www.artic.edu` (iiif), Met images from `images.metmuseum.org` (both img-src; v2, Jul 2026) `` (keyless, CORS ✓ — verify), Library of Congress `https://www.loc.gov/search/?q={q}&fo=json` (keyless; handle 429s).
- **Key:** none · **Local:** file:// ✅ (AIC/embedded list) / relay ❌ (Met JSON) · **Complexity:** S
- **Suggested file:** `art.html`

---

## 8 · Time & Planning

### 8.1 World Clock & Meeting Planner *(fully offline)*
Your people's time zones as a row of clocks, plus a "find a civil meeting time" slider across zones.
- **Data:** none — the browser's `Intl.DateTimeFormat` with IANA zone names does everything. (If you ever want a network time check: worldtimeapi.org was **sunset in 2026** — timeapi.io is the keyless CORS-enabled replacement.)
- **Key:** none · **Local:** offline 🟢 · **Complexity:** S
- **Suggested file:** `worldclock.html`

### 8.2 Countdown & Date Calculator *(fully offline)*
Days until/since anything; add/subtract business days; age calculator; saved countdowns.
- **Data:** none.
- **Key:** none · **Local:** offline 🟢 · **Complexity:** S
- **Suggested file:** `dates.html`

### 8.3 Daylight Planner *(fully offline)*
A year-at-a-glance daylight chart for your latitude: sunrise/sunset curves, DST jumps, "when do the dark months end."
- **Data:** none — same embedded solar math as the Almanac (1.6).
- **Key:** none · **Local:** offline 🟢 · **Complexity:** M
- **Suggested file:** `daylight.html`

### 8.4 Focus Timer *(fully offline)*
Pomodoro with gentle chimes (WebAudio — no audio files needed), session log in localStorage, and a big calm clock.
- **Data:** none.
- **Key:** none · **Local:** offline 🟢 · **Complexity:** S
- **Suggested file:** `focus.html`

### 8.5 Printable Calendar & Planner Pages *(fully offline)*
Generate a clean monthly calendar / weekly planner / habit tracker and print it (print CSS does the work).
- **Data:** none (optionally overlays holidays from 4.6).
- **Key:** none · **Local:** offline 🟢 · **Complexity:** S
- **Suggested file:** `printables.html`

---

## 9 · Local Life

### 9.1 Nearby Finder
"Where's the nearest pharmacy / EV charger / playground / library?" — query OpenStreetMap around your saved location, results as a list with distances and a simple map.
- **Data:** Overpass API `https://overpass-api.de/api/interpreter` (keyless, CORS ✓ in practice — overpass-turbo runs in the browser; fair use ~10k queries/day, mirror: overpass.kumi.systems). **Outage Jul 16 2026: primary answered HTTP 406 to everything and kumi hung/429'd for hours — plan for both being down (v2 nearby: cache + designed error state); live re-verify pending (tests/evidence/nearby/overpass-outage.txt).** Map tiles `https://tile.openstreetmap.org/{z}/{x}/{y}.png` load as `<img>` via Leaflet — light personal use is within the tile policy; attribution required.
- **Key:** none · **Local:** file:// ✅ · **Complexity:** M/L
- **Suggested file:** `nearby.html`

### 9.2 Geocoder & Coordinate Toolbox
Address ↔ coordinates both ways, plus distance/bearing between two points and coordinate format conversions (DMS, decimal).
- **Data:** cleanest keyless browser geocoder: Open-Meteo `https://geocoding-api.open-meteo.com/v1/search?name={q}&count=10` (CORS ✓, city-level). Full US street addresses: Census geocoder `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address={a}&benchmark=Public_AR_Current&format=jsonp&callback=fn` — **no CORS for fetch, but JSONP is officially supported** 🔶. Nominatim works from browsers (1 req/s policy; add `&email=you@example.com` from file:// since there's no Referer). Distance/bearing math offline.
- **Key:** none · **Local:** file:// ✅ / JSONP 🔶 (Census) · **Complexity:** S
- **Suggested file:** `geo.html`

### 9.3 Elevation Profiler
Elevation for any point, and a small elevation profile between two points.
- **Data:** USGS EPQS `https://epqs.nationalmap.gov/v1/json?x={lon}&y={lat}&units=Feet&wkid=4326` (keyless, US; CORS verify); global fallback `https://api.open-elevation.com/api/v1/lookup?locations={lat},{lon}` (keyless, CORS ✓ per docs).
- **Key:** none · **Local:** file:// ✅ · **Complexity:** S
- **Suggested file:** `elevation.html`

### 9.4 Trip Cost Estimator
Distance + your car's MPG + current gas prices (5.2's data) = what that road trip costs; compare two vehicles.
- **Data:** offline math; optionally EIA gas price (free key) and OSRM demo routing `https://router.project-osrm.org` (keyless demo — be gentle).
- **Key:** none/free key · **Local:** offline 🟢 core · **Complexity:** S
- **Suggested file:** `tripcost.html`

### 9.5 Transit Departure Board *(agency-dependent)*
Next departures for your stop, big-type, glanceable.
- **Data:** your transit agency's GTFS-realtime feed — availability, format (often protobuf!), key policy, and CORS vary wildly by agency. Some (e.g. BART, MTA) have JSON APIs with free keys. Honest note: scope this per-city; protobuf decoding in a single file is doable but L.
- **Key:** varies · **Local:** varies · **Complexity:** L
- **Suggested file:** `transit.html`

### 9.6 What's My Network
Your public IP, rough geolocation, ISP, and a latency sparkline to a few endpoints — the "is it my wifi or the site?" tool.
- **Data:** `https://api.ipify.org?format=json` · latency anchors ping `cloudflare.com` and `www.google.com` (HEAD timing only — v2, Jul 2026) · `` (IP only, keyless, CORS ✓) + `https://ipapi.co/json/` (geo/ISP, keyless 1,000/day, HTTPS + CORS ✓ — prefer it over ip-api.com, whose free tier is HTTP-only). Latency measured client-side with fetch timing.
- **Key:** none · **Local:** file:// ✅ · **Complexity:** S
- **Suggested file:** `network.html`

---

## 10 · Utilities & Toys (all fully offline 🟢)

Zero network requests, ever. These are the "works on an airplane" tier.

### 10.1 Password & Passphrase Generator
`crypto.getRandomValues` + the EFF large wordlist **embedded in the file** (7,776 words, ~60 KB — download once from `https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt` and paste in; eff.org sends no CORS so runtime fetch wouldn't work anyway). Strength meter, "say it out loud" passphrases.
- **Complexity:** S · **Suggested file:** `password.html`

### 10.2 QR Code Maker
Text/URL/wifi-credentials → QR, rendered on canvas by an embedded ~10 KB public-domain QR encoder. Print sheet of codes.
- **Complexity:** S · **Suggested file:** `qr.html`
- **Proposed addition — a "read" tab, spike-gated:** this tool makes codes but can't read one. A reader needs `getUserMedia` plus an embedded decoder (~15 KB), still zero-network. **Run the spike before designing anything:** confirm camera access works from `file://` in Chrome *and* Firefox. If it only works when hosted, drop the idea — a tool that fails when double-clicked breaks the suite's defining promise, and a camera prompt that leads nowhere is worse than no feature.

### 10.3 Text Toolbox
Word/char count, case conversion, sort/dedupe lines, diff two texts, SHA-256 hash (WebCrypto), URL/Base64 encode-decode.
- **Complexity:** S · **Suggested file:** `text.html`
- **Proposed addition — a regex tester** as a fourth tab beside Diff: same input, same mental model, too small to earn its own hub card. Note this tool hashes *text* only; hashing **files** is 10.15.

### 10.4 Color Studio
Picker, palette builder, contrast checker (WCAG), HEX/RGB/HSL conversions, "colors from an uploaded photo" (canvas).
- **Complexity:** M · **Suggested file:** `color.html`

### 10.5 Decision Maker
Dice, coins, spinners, "pick one from this list," random number with proper crypto randomness. Settle family disputes fairly.
- **Complexity:** S · **Suggested file:** `random.html`

### 10.6 Notepad That Stays
Markdown-ish notepad autosaving to localStorage, with export/import as a file. Several named notes. Your thoughts never leave the machine.
- **Complexity:** S/M · **Suggested file:** `notes.html`

### 10.7 Data Viewer
Drop a JSON or CSV file onto the page → pretty-printed, collapsible, searchable table view. No more pasting data into random websites.
- **Complexity:** M · **Suggested file:** `dataviewer.html`
- **Proposed upgrade — Data Workbench (M):** column type inference, sort/filter, select-rename-drop columns, dedupe, simple group/count/sum, JSON ↔ CSV, and export of the transformed result — with explicit row and file-size limits and a designed state above them. Deliberately an *evolution of this tool*, not a second card: any new tool would also start with "drop a CSV," and the hub doesn't need two of those.

### 10.8 Sound Machine
White/pink/brown noise, rain-ish synthesis via WebAudio, sleep timer. No audio files, no streaming service.
- **Complexity:** M · **Suggested file:** `sound.html`

### 10.9 Paper Generator
Print-perfect graph paper, lined paper, dot grid, music staves, Battleship grids — with margin and spacing controls.
- **Complexity:** S · **Suggested file:** `paper.html`

### 10.10 Stopwatch & Kitchen Timers
Multiple named timers (pasta, laundry, tea), stopwatch with laps, WebAudio chime, big-type display.
- **Complexity:** S · **Suggested file:** `timers.html`

### 10.11 Mortgage & Loan Workbench
Amortization schedule, extra-payment what-ifs, refinance comparison — all local, because your finances are nobody's telemetry.
- **Complexity:** M · **Suggested file:** `loan.html`

### 10.12 Flashcards
Spaced-repetition-lite flashcards stored in localStorage, import/export as JSON/CSV.
- **Complexity:** M · **Suggested file:** `flashcards.html`

### 10.13 Suite Settings *(offline except the checks you click)*
Backup/restore, the key manager and its guided setup, relay config, theme, locations, storage viewer.
- **Complexity:** M · **File:** `settings.html`
- **Data:** none of its own. It calls a provider **only** when you press Test or Save-and-check, one
  request per click, `no-store`, never cached: `api.nasa.gov/planetary/apod`,
  `api.congress.gov/v3/bill`, `api.nal.usda.gov/fdc/v1/foods/search`, `api.eia.gov/v2/`,
  `developer.nps.gov/api/v1/parks` (`X-Api-Key`), `finnhub.io/api/v1/quote`,
  `api.ebird.org/v2/data/obs` (`X-eBirdApiToken`), `api.bart.gov/api/stn.aspx`,
  `api.aviationstack.com/v1/flights`. Each is the cheapest request that proves a key, and each host
  is already catalogued for the tool that uses it.
- **Verified 2026-07-25 (CORS ✓, live):** every one of the nine rejects a bad key with 401/403 and a
  machine-readable body, so a rejection is never inferred from a network failure. NASA, Congress.gov
  and USDA FoodData proved to be one api.data.gov gateway (`via: api-umbrella`, shared `DEMO_KEY`),
  which is why one signup fills three key rows; **EIA and NPS run their own API Umbrella instances**
  and issue their own keys despite the identical error shape.
- **Gotcha:** Aviationstack's free tier is 100 requests/month, so its test costs one and is
  double-click confirmed, counted into `suite.flight.usage`.

### Proposed additions (2026-07-25)

10.1–10.13 are all built. The entries below are **candidates, not commitments** — every one is
zero-network, utility-first, and marked *proposed (not built)* until it ships. They are ranked in
`ROADMAP.md`'s post-v3 backlog; smaller ideas are recorded as sub-bullets on the tool that should
host them (see 10.2, 10.3, 10.7) rather than as new numbers, so a §10 number keeps meaning "a tool."

Four constraints shape every one of them, all verified against built `dist/` files under `file://`:
`eval`/`new Function` are impossible (per-file `script-src` is sha256-pinned), Web Workers are
unavailable (`worker-src 'self'` + `file://`), `blob:` image URLs are refused by the generated
`img-src 'self' data:` — use `createImageBitmap` + canvas + `toDataURL` — while downloads via
`URL.createObjectURL` + `a[download]` work fine, as `notes`/`paper`/`loan`/`qr` already prove.

### 10.14 Calculator & Percentage Workbench — *built* ✅ (v4)
A tape, not a keypad: every line is an expression you can go back and edit, with its result beside
it and earlier lines referencable, so a household calculation stays visible instead of vanishing
into a running total. Modes for percent-of / percent-change / markup-vs-margin, tip and tax with an
explicit rounding line, bill splitting with unequal shares and a reconciliation line naming who
absorbs the odd cent, ratios, and change-over-time (%Δ, CAGR). The most conspicuous daily-use gap in
the suite: 73 tools and none of them works out "18% of 64.50" — `convert.html` does units,
`loan.html` amortizes, and nothing does arithmetic. No `eval`: a hand-written tokenizer and
recursive-descent parser, which also bounds what a pasted expression can do. Money math is
integer-cent so `0.1 + 0.2` never surfaces; division by zero is a designed inline state, not `NaN`
in the tape. Worth mirroring the fraction parsing already in `convert.html` for `1 1/2` input.
- Also the right host for three ideas too small to be cards: a **number base & bitwise desk**
  (hex/bin/dec/oct, bit toggles, two's complement), **duration & timesheet math** (add/subtract
  `hh:mm`, total a week — `dates.html` owns calendar-day math and shouldn't grow a second model),
  and **unit-price comparison** ("is the big box cheaper?"), cross-linked from `convert.html`.
- **Data:** none — fully offline · **Key:** none · **Local:** file:// ✅
- **Complexity:** M · **Suggested file:** `calc.html` · **Storage:** `suite.calc.tape`, `suite.calc.mode`
- **As built (v4):** editable tape with `ans` chaining and receipt-style percent forms; tip & split with explicit odd-cent reconciliation; unit-price verdicts; BigInt base/two's-complement desk; hh:mm duration math with an hourly-rate line. Hand-written recursive-descent parser — nothing is ever eval'd.

### 10.15 File Integrity & Hash Desk — *built* ✅ (v4)
Drop files in, get hashes out: SHA-256 (default), SHA-1, SHA-512, with size, MIME type and
last-modified. Paste a published checksum for a large PASS / DOES NOT MATCH verdict — whitespace and
case tolerant, algorithm inferred from digest length — rather than making anyone compare 64 hex
characters by eye. Compare two files; copy or download a `SHA256SUMS`-style manifest. 10.3 hashes
*text* and contains no file reader at all, so today the question "is this download the file they
published?" sends people to a stranger's website with their file. `crypto.subtle.digest` has no
streaming API and workers are unavailable, so hashing means holding the file in memory: set an
explicit threshold and, above it, show a designed "too large to hash in the browser" card naming the
limit and the OS command that does it instead — the same first-class-state treatment the
blocked-source tools get. Cancel must work mid-hash. Reuse the drop-zone and its Enter/Space
keyboard path from `color.html`.
- **Data:** none — fully offline (Web Crypto) · **Key:** none · **Local:** file:// ✅
- **Complexity:** S · **Suggested file:** `hash.html` · **Storage:** none beyond `suite.theme` (as built, nothing about hashed files is retained)
- **As built (v4):** SHA-256/384/512 + legacy-labeled SHA-1 for dropped files and pasted text; the verify field accepts plain hex, `sha256:` prefixes, `sha256sum` lines, and BSD tag format for a MATCH/MISMATCH verdict naming the algorithm.

### 10.16 Checklist & Routine Tracker — *built* ✅ (v4)
Templates and runs, kept deliberately calm. A template is the master list (packing, pre-trip,
seasonal maintenance, weekly chores) with sections and per-item notes; a run is one instance of
working through it, remembering when it started and finished, archived rather than celebrated when
done. Optional recurrence stated in plain language — "resets Monday" — and applied when you open the
page, never in the background. Fills the gap between free-form Notes, study Flashcards, printed
habit grids, and Focus/Timers. JSON export/import following `flashcards.html`, print view following
`printables.html`. Explicitly no streaks, badges, scores, or notifications. Both keys hold
user-authored content, so every write checks what `Suite.store.set` returns and surfaces a save
failure — this is the class of tool where silent quota loss actually costs someone something.
Editing a template mid-run must not rewrite the run in progress: a run snapshots its items at start.
- **Data:** none — fully offline · **Key:** none · **Local:** file:// ✅
- **Complexity:** M · **Suggested file:** `checklists.html` · **Storage:** `suite.checklists.v1`
- **As built (v4):** named lists with progress, keyboard-accessible reorder, starter templates, JSON export/import, and the defining reset-the-checks-keep-the-items action for routines and packing lists.

### 10.17 Image Toolbox — *built* ✅ (v4)
Local-only resize (max dimension or percentage, aspect locked), crop, rotate/flip, PNG/JPEG/WebP
conversion, a quality slider with live before/after byte counts, and metadata-stripping by canvas
re-encode. No uploads, ever — the everyday "make this 4 MB photo emailable" errand currently means
handing a personal photo to a stranger's website. 10.4 opens a photo only to sample colors; nothing
resizes or exports one. Build it on `createImageBitmap(file)` + canvas, **not** `URL.createObjectURL`
on an `<img>`: the generated CSP refuses `blob:` image URLs, while the bitmap path is verified
working with untainted `getImageData` and a successful `toDataURL()`. Ship the honest caveats —
re-encoding drops common metadata but is not a forensic sanitizer, lossy output is lossy,
transparency survives only in formats that have it — plus explicit dimension and memory limits.
- **Data:** none — fully offline · **Key:** none · **Local:** file:// ✅
- **Complexity:** M · **Suggested file:** `image.html` · **Storage:** none beyond `suite.theme`
- **As built (v4):** `createImageBitmap` decode with a canvas preview (no `blob:` URLs, per the generated CSP), resize by width/height/percent with aspect lock, JPEG/PNG/WebP re-encode with quality and size-change readouts, and the honest EXIF note: canvas re-encoding outputs a file with no metadata.

### 10.18 Calendar / ICS Maker — *built* ✅ (v4)
Compose events (one-off, all-day, simple recurrence) and export a valid `.ics`; import a local
`.ics` into a private read-only agenda view. Seeded from a countdown in 8.2, an observance in 4.6,
or a meeting time from 8.1 — nothing in the suite can currently leave it as a calendar entry. File
import/export only, never OS calendar integration, which would need exactly the account coupling the
suite refuses. The format is fussier than it looks and a subtly malformed file fails *silently* in
the user's calendar app, which is the worst possible failure for a tool whose whole job is producing
a file: CRLF line endings, 75-octet line folding, escaping `,` `;` and newlines in text fields,
`DTSTART` in floating vs `TZID` vs UTC form, and DST-boundary events each need a test, with a
compose → export → re-import → compare round-trip as the cheapest way to hold the line.
- **Data:** none — fully offline · **Key:** none · **Local:** file:// ✅
- **Complexity:** M · **Suggested file:** `ics.html` · **Storage:** `suite.ics.draft`
- **As built (v4):** RFC 5545-strict serializer — CRLF, 75-octet folding, ordered TEXT escaping, floating local times, exclusive all-day DTEND, weekly BYDAY with COUNT/UNTIL endings, VALARM reminders — with a live preview, human summary sentence, and draft persistence.

**Considered and deliberately not proposed**, so the next reader doesn't re-propose them: recipe
scaling (7.3 has a Recipe scaler tab), Base64/URL encode-decode, text SHA-256 and text diff (all
10.3), printed habit grids (8.5), pomodoro (8.4), palette-from-photo (10.4), amortization and
refinance what-ifs (10.11), dice and pick-from-list (10.5). Storage and quota diagnostics belong in
10.13 as a section, not as a tool.

---

## 11 · Games & Arcade

### 11.1 The Arcade — *built* ✅ (v4)
A launcher for five browser games from this suite's own workshop: Bathhouse Brigade (desktop and
mobile editions), Chromatic Chains (desktop and mobile editions), and DOOM 1993 shareware in an
EmulatorJS/PrBoom wrapper. Every card links to its live GitHub Pages deployment (all five
verified playable 2026-07-30) plus the source repository, honestly labeled.
- **Data:** none — zero network requests. Card art is copied from the game repositories
  (DOOM: a screenshot of the repository's own deployment, credited to id Software), optimized,
  and inlined at build time via the `data-suite-asset` marker; provenance in
  `assets/arcade/PROVENANCE.md`.
- **Key:** none · **Local:** file:// ✅ (games themselves open on GitHub Pages) · **Complexity:** S
- **Suggested file:** `arcade.html`

## Suggested build order

1. **Quick wins that complete the "command center" feel:** Alerts board (1.2), Earthquake monitor (2.1), Space weather (1.5), Sun & moon almanac (1.6) — all keyless, all file://-friendly.
2. **Daily-use utilities:** Converter (7.3), World clock (8.1), Password generator (10.1), Dictionary (7.1).
3. **The satisfying dashboards:** Tides (1.7), Air quality (1.4), Treasury (4.5), Recall radar (4.3), APOD (3.2), Launches (3.4).
4. **The projects:** Radar map (1.3 L version), ISS with passes (3.1), Nearby finder (9.1), Transit board (9.5).

## API quick-reference

The short version of everything above. **CORS ✓** = documented/community-confirmed browser-callable; **verify** = do a 10-second `fetch()` test from a `file://` page first; **✗** = confirmed blocked (needs a relay, JSONP, or a different source).

| Source | Base | Key | Browser CORS |
|---|---|---|---|
| NWS weather/alerts | `api.weather.gov` | none | ✓ |
| NOAA SWPC space weather | `services.swpc.noaa.gov` | none | verify (widely used) |
| NOAA CO-OPS tides | `api.tidesandcurrents.noaa.gov` | none | verify (widely used) |
| NOAA NDBC buoys | `ndbc.noaa.gov/data/realtime2` | none | ✗ |
| Open-Meteo (weather/air/marine/geocoding/archive) | `*.open-meteo.com` (in use: `api.`, `marine-api.`, `air-quality-api.`, `geocoding-api.`, `archive-api.open-meteo.com` — v2, Jul 2026) | none (10k/day) | ✓ |
| USGS earthquakes | `earthquake.usgs.gov` | none | ✓ |
| USGS water (new) | `api.waterdata.usgs.gov` | optional | ✓ (OGC API; verified Jul 2026) |
| FEMA NFHL flood hazard | `hazards.fema.gov/arcgis/rest/services/public/NFHL` | none | ✓ (echoes Origin incl. null, Vary: Origin; live file:// fetch 2026-07-31) |
| NOAA NWPS gauges | `api.water.noaa.gov/nwps/v1` | none | ✓ (ACAO:*, verified 2026-07-31; bbox required — unbounded /gauges times out) |
| USGS elevation (EPQS) | `epqs.nationalmap.gov` | none | ✓ (v2 live browser fetch, Jul 2026) |
| USGS volcanoes (HANS) | `volcanoes.usgs.gov/hans-public` | none | ✓ (verified Jul 2026) |
| NIFC/WFIGS wildfires | `services3.arcgis.com/T4QMspbfLg3qTGWY` | none | ✓ (ArcGIS) |
| NASA FIRMS hotspots | `firms.modaps.eosdis.nasa.gov` | free MAP_KEY | verify |
| US Drought Monitor | `usdmdataservices.unl.edu` | none | ✗ (use Esri Living Atlas `US_Drought_Intensity_v1`, CORS ✓) |
| USDA SNOTEL (AWDB) | `wcc.sc.egov.usda.gov/awdbRestApi` | none | verify |
| USDA FoodData Central | `api.nal.usda.gov/fdc` | demo/free | ✓ (v2 live, Jul 2026) |
| EPA UV daily | `data.epa.gov/dmapservice` | none | verify |
| EPA AirNow | `airnowapi.org` | free key (500/hr) | verify |
| NASA APOD/NeoWs | `api.nasa.gov` | demo/free | ✓ |
| JPL close approaches | `ssd-api.jpl.nasa.gov` | none | ✗ (dropped ACAO ~Jul 2026; asteroids re-sourced to NeoWs) |
| CelesTrak TLEs | `celestrak.org` | none | ✓ (v2 live from file://, Jul 2026; keep their ≥2 h GP cache guidance) |
| wheretheiss.at | `api.wheretheiss.at` | none (1/sec) | ✓ (community) |
| Launch Library 2 | `ll.thespacedevs.com/2.3.0` | none (15/hr) | ✓ (v2 live, Jul 2026) |
| aviationweather.gov | `aviationweather.gov/api/data` | none | ✗ |
| Aviationstack | `api.aviationstack.com/v1/flights` | personal free key | ✓ (keyless 401 ACAO:*, Jul 2026; keyed response requires user key) |
| FAA NAS status | `nasstatus.faa.gov` | none | ✗ (likely; XML) |
| USNO astronomy | `aa.usno.navy.mil/api` | none | ✗ (likely) |
| sunrise-sunset.org | `api.sunrise-sunset.org` | none | ✓ (community) |
| Federal Register | `federalregister.gov/api/v1` | none | ✓ (community) |
| Congress.gov | `api.congress.gov/v3` | free key (5k/hr) | verify |
| Treasury FiscalData | `api.fiscaldata.treasury.gov` | none | ✓ (v2 verified Jul 2026; note: their WAF 500s HeadlessChrome UAs) |
| BLS (CPI/jobs) | `api.bls.gov/publicAPI` | none (v1) / free (v2) | ✗ |
| FRED | `api.stlouisfed.org` | free key | ✗ |
| EIA (energy) | `api.eia.gov/v2` | free key | verify |
| Frankfurter FX | `api.frankfurter.dev` | none | ✓ |
| open.er-api.com FX | `open.er-api.com` | none (daily) | ✓ (community) |
| CoinGecko | `api.coingecko.com` | none (~10/min) | ✓ (community) |
| Finnhub stocks | `finnhub.io/api/v1` | free key (60/min) | ✓ |
| CDC open data | `data.cdc.gov/resource` | none (light) | ✓ (Socrata) |
| openFDA | `api.fda.gov` | none (1k/day) | ✓ |
| NHTSA recalls/VIN | `api.nhtsa.gov`, `vpic.nhtsa.dot.gov` | none | ✓ (echoes Origin; verified Jul 2026) |
| CPSC recalls | `saferproducts.gov/RestWebServices` | none | ✓ (verified Jul 2026) |
| NPS parks | `developer.nps.gov/api/v1` | free key (1k/hr) | ✓ (official Swagger inventory and conservative built `file://` live-key verification Jul 30 2026: all 29 resources healthy; boundaries remain on demand because the GeoJSON is large) |
| Nager.Date holidays | `date.nager.at/api/v3` | none | ✓ |
| Census geocoder | `geocoding.geo.census.gov` | none | ✗ fetch / ✓ JSONP |
| Census data (ACS) | `api.census.gov/data` | none (500/day) | ✓ (community) |
| Wikipedia/Wikimedia REST | `en.wikipedia.org/api/rest_v1` | none | ✓ |
| Wiktionary definitions | `en.wiktionary.org/api/rest_v1` | none | ✓ |
| dictionaryapi.dev | `api.dictionaryapi.dev` | none | ✓ (community; flaky) |
| Zippopotam | `api.zippopotam.us` | none | ✓ |
| restcountries | `restcountries.com/v3.1` | none | ✓ (`/all` needs `?fields=`) |
| Nominatim | `nominatim.openstreetmap.org` | none (1/sec) | ✓ (identify yourself) |
| Overpass | `overpass-api.de` | none (fair use) | ✓ (community; Jul 16 2026 outage — see 9.1) |
| BART real-time | `api.bart.gov/api` | public demo key / free | ✓ (v2 live ETDs, Jul 2026; key externalized to suite.key.bart) |
| Open Library | `openlibrary.org` | none (1/sec) | ✓ (search; covers via `<img>`) |
| Google Books | `googleapis.com/books/v1` | optional | ✓ |
| Met Museum | `collectionapi.metmuseum.org` | none | ✗ (images via `<img>` fine) |
| Art Institute of Chicago | `api.artic.edu/api/v1` | none | verify |
| Library of Congress | `loc.gov` (`?fo=json`) | none | verify (handle 429s) |
| iNaturalist | `api.inaturalist.org/v1` | none | ✓ |
| iTunes Search | `itunes.apple.com/search` | none (20/min) | ✗ fetch / ✓ JSONP |
| TheMealDB/CocktailDB | `themealdb.com`, `thecocktaildb.com` | test key `1` | ✓ |
| timeapi.io | `timeapi.io` | none | ✓ (worldtimeapi is sunset) |
| ipify / ipapi.co | `api.ipify.org` / `ipapi.co` | none | ✓ |
| xkcd | `xkcd.com/info.0.json` | none | ✗ |
| USAspending | `api.usaspending.gov/api/v2` | none | ✓ (community) |
| Google + Cloudflare DNS-over-HTTPS | `dns.google/resolve`, `cloudflare-dns.com/dns-query` | none | ✓ (live `file://` verification Jul 30 2026; explicit lookup only) |
| Datamuse rhymes | `api.datamuse.com/words` | none | ✓ (live `file://` verification Jul 30 2026; cached per query) |
| Crossref works | `api.crossref.org/works` | none | ✓ (live `file://` verification Jul 30 2026; DOI lookup with polite cache) |
| NASA Image Library | `images-api.nasa.gov`, media at `images-assets.nasa.gov` | none | ✓ (live `file://` verification Jul 30 2026) |
| World Bank indicators | `api.worldbank.org/v2` | none | ✓ (live `file://` verification Jul 30 2026; JSON format requested) |
| Internet Archive availability | `archive.org/wayback/available` | none | ✓ (live `file://` verification Jul 30 2026; explicit URL check) |
| OSRM demo routing | `router.project-osrm.org` | none | ✓ (community; be gentle) |
