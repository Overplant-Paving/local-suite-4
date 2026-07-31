/* Shared deterministic fixtures + request router for the Flood Risk & Conditions tests
   (tests/flood-built.mjs and tests/interactions/flood.mjs). Everything is served from
   Playwright routes — no live request ever leaves these tests. */

export const PT = { lat: 29.9511, lon: -90.0715 };   // public New Orleans city coordinate
export const ADDRESS = "1600 Pennsylvania Ave NW, Washington, DC";
export const ADDRESS_PT = { lat: 38.898754, lon: -77.03535 };

export const ZONE_FIELDS = "DFIRM_ID,FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,V_DATUM,DEPTH,LEN_UNIT,VELOCITY,VEL_UNIT,DUAL_ZONE,SOURCE_CIT";
export const PANEL_FIELDS = "DFIRM_ID,FIRM_PAN,PANEL_TYP,EFF_DATE,SCALE,PNP_REASON,SOURCE_CIT";
export const LOMR_FIELDS = "DFIRM_ID,LOMR_ID,EFF_DATE,CASE_NO,SCALE,STATUS,SOURCE_CIT";

export function squareAround(lat, lon, d = 0.005) {
  return { type: "Polygon", coordinates: [[
    [lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]
  ]] };
}
export function multiAround(lat, lon, d = 0.005) {
  /* two polygons, the first with a hole (3 rings total) */
  const outer = squareAround(lat, lon, d).coordinates[0];
  const hole = squareAround(lat + d / 2, lon + d / 2, d / 8).coordinates[0].slice().reverse();
  return { type: "MultiPolygon", coordinates: [
    [outer, hole],
    squareAround(lat + 3 * d, lon + 3 * d, d / 2).coordinates
  ] };
}
const ZONE_DEFAULTS = {
  DFIRM_ID: "22071C", FLD_ZONE: "AE", ZONE_SUBTY: null, SFHA_TF: "T",
  STATIC_BFE: -9999, V_DATUM: null, DEPTH: -9999, LEN_UNIT: "Feet",
  VELOCITY: -9999, VEL_UNIT: null, DUAL_ZONE: null, SOURCE_CIT: "STUDY_CIT_22071C"
};
export function zoneFC(list, at = PT) {
  return { type: "FeatureCollection", features: list.map(x => ({
    type: "Feature",
    properties: Object.assign({}, ZONE_DEFAULTS, x.props || {}),
    geometry: x.geometry === undefined ? squareAround(at.lat, at.lon) : x.geometry
  })) };
}
export const EMPTY_FC = { type: "FeatureCollection", features: [] };

export function arcgisTable(rows) { return { features: rows.map(a => ({ attributes: a })) }; }

export const PANELS = arcgisTable([
  { DFIRM_ID: "OTHER9", FIRM_PAN: "9999990002B", PANEL_TYP: "PRINTED",
    EFF_DATE: Date.UTC(2024, 5, 1), SCALE: "12000", PNP_REASON: null, SOURCE_CIT: "OTHER_CIT" },
  { DFIRM_ID: "22071C", FIRM_PAN: "2207100115F", PANEL_TYP: "PRINTED",
    EFF_DATE: Date.UTC(2016, 8, 30), SCALE: "24000", PNP_REASON: null, SOURCE_CIT: "PANEL_CIT" }
]);
export const LOMRS = arcgisTable([
  { DFIRM_ID: "22071C", LOMR_ID: "LOMR-77", EFF_DATE: Date.UTC(2023, 2, 15),
    CASE_NO: "22-06-1234P", SCALE: "24000", STATUS: "EFFECTIVE", SOURCE_CIT: "LOMR_CIT" }
]);
export const NO_LOMRS = arcgisTable([]);

export function alertsFC(list) { return { features: list.map(p => ({ properties: p })) }; }
export const ALERTS_MIXED = alertsFC([
  { event: "Heat Advisory", severity: "Moderate", urgency: "Expected", areaDesc: "Orleans Parish",
    headline: "Heat Advisory until 7 PM", description: "Hot.", effective: "2026-07-31T10:00:00-05:00", ends: "2026-07-31T19:00:00-05:00" },
  { event: "Flood Advisory", severity: "Minor", urgency: "Expected", areaDesc: "Orleans Parish",
    headline: "Flood Advisory for poor drainage areas", description: "Minor flooding of low-lying areas.",
    instruction: "Turn around, don't drown.", effective: "2026-07-31T11:00:00-05:00", ends: "2026-07-31T14:00:00-05:00" },
  { event: "Flood Warning", severity: "Severe", urgency: "Immediate", areaDesc: "Orleans Parish, LA",
    headline: "Flood Warning until further notice", description: "The river is above flood stage.",
    instruction: "Move to higher ground.", effective: "2026-07-31T09:00:00-05:00", ends: "2026-08-01T09:00:00-05:00" },
  { event: "Hydrologic Outlook", severity: "Unknown", urgency: "Future", areaDesc: "Southeast Louisiana",
    headline: "Hydrologic outlook for the lower Mississippi", description: "Rises are expected.", effective: "2026-07-31T08:00:00-05:00" },
  { event: "Tornado Warning", severity: "Extreme", urgency: "Immediate", areaDesc: "Orleans Parish",
    headline: "Tornado Warning", description: "Take cover now.", effective: "2026-07-31T12:00:00-05:00" }
]);
export const ALERTS_UNRELATED_ONLY = alertsFC([
  { event: "Heat Advisory", severity: "Moderate", urgency: "Expected", areaDesc: "Orleans Parish",
    headline: "Heat Advisory until 7 PM", description: "Hot.", effective: "2026-07-31T10:00:00-05:00" }
]);
export const ALERTS_NONE = alertsFC([]);

export function gauges(list) { return { gauges: list }; }
export const GAUGES_RANKED = gauges([
  { lid: "NEAR1", name: "Close Creek at Testville", latitude: PT.lat + 0.01, longitude: PT.lon,
    status: { observed: { primary: 3.2, primaryUnit: "ft", floodCategory: "no_flooding", validTime: "2026-07-31T12:00:00Z" },
              forecast: { primary: 3.4, primaryUnit: "ft", floodCategory: "no_flooding", validTime: "2026-08-01T12:00:00Z" } } },
  { lid: "FLOOD1", name: "Big River at Town", latitude: PT.lat + 0.12, longitude: PT.lon,
    status: { observed: { primary: 21.5, primaryUnit: "ft", floodCategory: "moderate", validTime: "2026-07-31T12:15:00Z" },
              forecast: { primary: 24.1, primaryUnit: "ft", floodCategory: "major", validTime: "2026-08-01T06:00:00Z" } } },
  { lid: "OOS1", name: "Broken Gauge Bayou", latitude: PT.lat - 0.02, longitude: PT.lon,
    status: { observed: { primary: -999, primaryUnit: "ft", floodCategory: "not_defined", validTime: "" }, forecast: null } },
  { lid: "FAR1", name: "Too Far River", latitude: PT.lat + 0.4, longitude: PT.lon,
    status: { observed: { primary: 9.9, primaryUnit: "ft", floodCategory: "major", validTime: "2026-07-31T12:00:00Z" } } }
]);
export const GAUGES_NONE = gauges([]);

/* 18 km due north and due south: inside the advertised 20 km radius, but outside the
   old ±0.15° (16.7 km) request box. */
export const GAUGES_NS_18KM = gauges([
  { lid: "N18", name: "North Fork at Eighteen", latitude: PT.lat + 18 / 111.2, longitude: PT.lon,
    status: { observed: { primary: 5.5, primaryUnit: "ft", floodCategory: "no_flooding", validTime: "2026-07-31T12:00:00Z" } } },
  { lid: "S18", name: "South Fork at Eighteen", latitude: PT.lat - 18 / 111.2, longitude: PT.lon,
    status: { observed: { primary: 4.5, primaryUnit: "ft", floodCategory: "no_flooding", validTime: "2026-07-31T12:00:00Z" } } }
]);

/* NWPS marks readings it no longer stands behind with *_not_current, usually alongside
   its 0001-01-01 sentinel time. The farther gauge has the only genuinely current
   forecast, so forecast-availability ranking must put it first. */
export const GAUGES_NOT_CURRENT = gauges([
  { lid: "STALE1", name: "Stale Bayou", latitude: PT.lat + 0.01, longitude: PT.lon,
    status: {
      observed: { primary: 12.5, primaryUnit: "ft", floodCategory: "obs_not_current", validTime: "0001-01-01T00:00:00Z" },
      forecast: { primary: 13.1, primaryUnit: "ft", floodCategory: "fcst_not_current", validTime: "0001-01-01T00:00:00Z" } } },
  { lid: "OK1", name: "Live Creek at Now", latitude: PT.lat + 0.05, longitude: PT.lon,
    status: {
      observed: { primary: 3.0, primaryUnit: "ft", floodCategory: "no_flooding", validTime: "2026-07-31T12:00:00Z" },
      forecast: { primary: 3.2, primaryUnit: "ft", floodCategory: "no_flooding", validTime: "2026-08-01T12:00:00Z" } } }
]);

/* Serve a fixture list clipped to the bbox the page actually asked for, exactly as the
   live service would — so a request box that is too small really does hide a gauge. */
export function gaugesInBbox(list) {
  return url => {
    const sp = new URL(url).searchParams;
    const x0 = +sp.get("bbox.xmin"), x1 = +sp.get("bbox.xmax");
    const y0 = +sp.get("bbox.ymin"), y1 = +sp.get("bbox.ymax");
    return gauges(list.gauges.filter(g =>
      g.longitude >= x0 && g.longitude <= x1 && g.latitude >= y0 && g.latitude <= y1));
  };
}

/* Recenter the ranked gauge set on whatever bbox the page actually queried, so the same
   fixture works for any checked point. */
export function gaugesNearUrl(url) {
  const sp = new URL(url).searchParams;
  const lat = (parseFloat(sp.get("bbox.ymin")) + parseFloat(sp.get("bbox.ymax"))) / 2;
  const lon = (parseFloat(sp.get("bbox.xmin")) + parseFloat(sp.get("bbox.xmax"))) / 2;
  if (!isFinite(lat) || !isFinite(lon)) return GAUGES_RANKED;
  return gauges(GAUGES_RANKED.gauges.map(g => Object.assign({}, g, {
    latitude: lat + (g.latitude - PT.lat), longitude: lon + (g.longitude - PT.lon) })));
}

export function censusMatch(matches) {
  return { result: { addressMatches: matches.map(m => ({
    matchedAddress: m.addr, coordinates: { x: m.lon, y: m.lat } })) } };
}
export const CENSUS_ONE = censusMatch([{ addr: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500", lat: ADDRESS_PT.lat, lon: ADDRESS_PT.lon }]);
export const CENSUS_TWO = censusMatch([
  { addr: "100 MAIN ST, SPRINGFIELD, IL, 62701", lat: 39.8, lon: -89.65 },
  { addr: "100 MAIN ST N, SPRINGFIELD, IL, 62702", lat: PT.lat, lon: PT.lon }
]);
export const CENSUS_NONE = censusMatch([]);

export function classify(url) {
  if (url.includes("geocoding.geo.census.gov")) return "census";
  if (url.includes("/NFHL/MapServer/28/query")) return "zone";
  if (url.includes("/NFHL/MapServer/3/query")) return "panel";
  if (url.includes("/NFHL/MapServer/1/query")) return "lomr";
  if (url.includes("/NFHL/MapServer/0/query")) return "avail";
  if (url.includes("api.weather.gov/alerts/active")) return "alerts";
  if (url.includes("api.water.noaa.gov/nwps/v1/gauges")) return "gauges";
  return "other";
}

/* Install the catch-all router on a context. cfg maps kind -> body object |
   "abort" | {status, contentType, body} | (url) => any of those | Promise. */
export async function installRouter(ctx, cfg, reqs) {
  await ctx.route(/^https?:/, async route => {
    const url = route.request().url();
    reqs.push(url);
    const kind = classify(url);
    let h = cfg[kind];
    try { if (typeof h === "function") h = h(url); if (h && typeof h.then === "function") h = await h; }
    catch (e) { h = null; }
    if (!h || h === "abort") return route.abort().catch(() => {});
    if (h.status) return route.fulfill(h).catch(() => {});
    if (kind === "census") {
      const cb = new URL(url).searchParams.get("callback") || "cb";
      return route.fulfill({ status: 200, contentType: "text/javascript",
        body: cb + "(" + JSON.stringify(h) + ")" }).catch(() => {});
    }
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify(h) }).catch(() => {});
  });
}

/* Request shapes the tool must never emit (plan §2, §5.7, §6.3). */
export function forbiddenRequests(reqs) {
  const bad = [];
  for (const u of reqs) {
    if (/\/MapServer\/export/i.test(u)) bad.push("FEMA export image: " + u);
    if (/esriGeometryEnvelope/i.test(u)) bad.push("neighborhood envelope query: " + u);
    if (/\/nwps\/v1\/gauges\/[^?]/.test(u)) bad.push("per-gauge metadata/stageflow: " + u);
    if (/stageflow/i.test(u)) bad.push("stageflow request: " + u);
    if (/nwps\/v1\/gauges\?/.test(u) && !/bbox\.xmin=/.test(u)) bad.push("unbounded NWPS gauges: " + u);
    if (/MapServer\/28\/query/.test(u)) {
      const sp = new URL(u).searchParams;
      if (sp.get("outFields") !== ZONE_FIELDS) bad.push("layer 28 outFields not the allowlist: " + u);
      if (sp.get("geometryPrecision") !== "5" || sp.get("maxAllowableOffset") !== "0.00005")
        bad.push("layer 28 request without geometry simplification: " + u);
    }
    if (/MapServer\/(3|1)\/query/.test(u) && new URL(u).searchParams.get("returnGeometry") !== "false")
      bad.push("panel/LOMR request with geometry: " + u);
  }
  return bad;
}

export const STANDARD = {
  zone: () => zoneFC([{ props: { FLD_ZONE: "AE", SFHA_TF: "T", STATIC_BFE: 8, V_DATUM: "NAVD88", LEN_UNIT: "Feet" } }]),
  panel: PANELS, lomr: LOMRS, avail: { count: 3 },
  alerts: ALERTS_MIXED, gauges: gaugesNearUrl, census: CENSUS_ONE
};
