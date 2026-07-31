/* Built Flood Risk & Conditions deterministic gate. Run from tests/: node flood-built.mjs
   Exercises dist/flood.html from file:// against routed fixtures only (zero live requests):
   two-step Census confirmation, request shapes/allowlists, zone matrix, races, caches,
   escaping, a11y/mobile, and the prohibited-request assertions from FLOOD-TOOL-PLAN.md. */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import * as F from "./interactions/flood-fixtures.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = pathToFileURL(join(ROOT, "dist", "flood.html")).href;
const EV = join(ROOT, "tests", "evidence", "flood");
mkdirSync(EV, { recursive: true });

let browser;
try { browser = await chromium.launch({ channel: "chrome" }); }
catch (e) {
  if (!String(e).includes("distribution 'chrome' is not found")) throw e;
  browser = await chromium.launch();
}

const lines = [];
const say = s => { lines.push(s); console.log(s); };
let failures = 0;
const NETWORK_NOISE = /net::ERR|blocked by CORS policy|Failed to load resource/;

function ok(cond, msg) { if (!cond) throw new Error("ASSERT: " + msg); }

const TGT = { lat: F.PT.lat, lon: F.PT.lon, label: "Test point", source: "coordinates",
  accuracy: null, checkedAt: 1753900000000 };

async function scenario(name, cfg, fn, opts = {}) {
  const ctx = await browser.newContext(Object.assign(
    { viewport: opts.viewport || { width: 1280, height: 950 } }, opts.context || {}));
  const reqs = [], errors = [];
  await F.installRouter(ctx, cfg, reqs);
  const page = await ctx.newPage();
  page.on("console", m => { if (m.type() === "error" && !NETWORK_NOISE.test(m.text())) errors.push("console: " + m.text().slice(0, 160)); });
  page.on("pageerror", e => errors.push("pageerror: " + String(e).slice(0, 160)));
  await page.addInitScript(([seed, theme]) => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", e =>
      window.__csp.push(e.violatedDirective + " blocked " + (e.blockedURI || "inline")));
    if (theme) localStorage.setItem("suite.theme", theme);
    for (const [k, v] of Object.entries(seed || {})) localStorage.setItem(k, JSON.stringify(v));
  }, [opts.seed || null, opts.theme || null]);
  /* opts.init runs in the page before load for seeds that must be relative to a real
     Date.now() (cache staleness), which a JSON literal cannot express */
  if (opts.init) await page.addInitScript(opts.init);
  try {
    await page.goto(DIST);
    await fn({ page, ctx, reqs, errors });
    const banned = F.forbiddenRequests(reqs);
    ok(!banned.length, "forbidden request emitted:\n  " + banned.join("\n  "));
    const csp = await page.evaluate(() => window.__csp).catch(() => []);
    ok(!csp.length, "CSP violations: " + csp.join("; "));
    ok(!errors.length, "page/console errors: " + errors.join("; "));
    say("ok   " + name);
  } catch (e) {
    failures++;
    say("FAIL " + name + "\n  " + String(e && e.message || e).split("\n").join("\n  "));
  } finally { await ctx.close(); }
}

const bodyText = page => page.evaluate(() => document.body.innerText);
const waitText = (page, sel, re, t = 10000) =>
  page.waitForFunction(([s, r]) => new RegExp(r, "i").test(document.querySelector(s)?.textContent || ""),
    [sel, re.source || re], { timeout: t });

/* ---------------------------------------------------------------- 1. full happy path via
   two-step Census confirmation, with exact request-shape assertions */
await scenario("census two-step confirm + request shapes + AE/SFHA render", F.STANDARD, async ({ page, reqs }) => {
  await page.fill("#q", F.ADDRESS);
  ok(await page.textContent("#goBtn") === "Find address", "button should read Find address for an address");
  await page.click("#goBtn");
  await page.waitForSelector("#candBox .cand");
  ok((await page.locator("#candBox .cand").count()) === 1, "one candidate card");
  ok(/interpolated street point/.test(await page.textContent("#candBox")), "candidate carries the approximate-point wording");
  /* focus lands on the confirm button; no hazard request before confirmation */
  ok(await page.evaluate(() => document.activeElement?.classList.contains("check-point")), "focus moved to Check this point");
  const pre = reqs.map(F.classify).filter(k => k !== "census" && k !== "other");
  ok(pre.length === 0, "hazard requests before confirmation: " + pre.join(","));
  const censusUrl = new URL(reqs.find(u => F.classify(u) === "census"));
  ok(censusUrl.searchParams.get("benchmark") === "Public_AR_Current" && censusUrl.searchParams.get("format") === "jsonp",
    "census request uses the documented JSONP form");

  await page.click("#candBox .check-point");
  await waitText(page, "#femaBox", /Zone AE/);
  await waitText(page, "#alertBox", /Flood Warning/);
  await waitText(page, "#gaugeBox", /Big River/);
  /* focus returned to the checked-target summary */
  ok(await page.evaluate(() => document.activeElement?.id === "targetBar"), "focus returned to the target bar");

  const lat = F.ADDRESS_PT.lat, lon = F.ADDRESS_PT.lon;
  const zu = new URL(reqs.find(u => F.classify(u) === "zone"));
  const sp = zu.searchParams;
  ok(sp.get("geometry") === lon.toFixed(6) + "," + lat.toFixed(6), "layer 28 geometry is the confirmed point");
  for (const [k, v] of [["geometryType", "esriGeometryPoint"], ["inSR", "4326"], ["outSR", "4326"],
    ["spatialRel", "esriSpatialRelIntersects"], ["returnGeometry", "true"], ["f", "geojson"],
    ["geometryPrecision", "5"], ["maxAllowableOffset", "0.00005"], ["outFields", F.ZONE_FIELDS]])
    ok(sp.get(k) === v, "layer 28 param " + k + " = " + sp.get(k));
  const pu = new URL(reqs.find(u => F.classify(u) === "panel"));
  ok(pu.searchParams.get("outFields") === F.PANEL_FIELDS && pu.searchParams.get("f") === "json", "layer 3 field allowlist");
  const lu = new URL(reqs.find(u => F.classify(u) === "lomr"));
  ok(lu.searchParams.get("outFields") === F.LOMR_FIELDS, "layer 1 field allowlist");
  ok(!reqs.some(u => F.classify(u) === "avail"), "no layer 0 call when zone data exists");
  const au = new URL(reqs.find(u => F.classify(u) === "alerts"));
  ok(au.searchParams.get("point") === lat.toFixed(4) + "," + lon.toFixed(4), "alerts point param");
  const gu = new URL(reqs.find(u => F.classify(u) === "gauges"));
  const dLat = 20 / 111.2, dLon = dLat / Math.max(0.3, Math.cos(lat * Math.PI / 180));
  ok(gu.searchParams.get("bbox.ymin") === (lat - dLat).toFixed(4) &&
     gu.searchParams.get("bbox.ymax") === (lat + dLat).toFixed(4) &&
     gu.searchParams.get("bbox.xmin") === (lon - dLon).toFixed(4) &&
     gu.searchParams.get("bbox.xmax") === (lon + dLon).toFixed(4), "NWPS bbox spans the advertised 20 km radius");
  ok(gu.searchParams.get("srid") === "EPSG_4326" && gu.searchParams.get("catfim") === "false", "NWPS srid/catfim params");

  const body = await bodyText(page);
  ok(/Inside a mapped Special Flood Hazard Area/.test(body), "SFHA wording rendered");
  ok(/Base flood elevation[\s\S]{0,4}8 feet/.test(body), "BFE rendered in FEMA's own normalized unit");
  ok(/Vertical datum[\s\S]{0,4}NAVD88/.test(body), "vertical datum preserved as its own field");
  ok(/2207100115F/.test(body) && /Primary \(study matches the zone record\)/.test(await page.textContent("#femaBox")), "DFIRM-matched panel ranked primary");
  ok(/22-06-1234P/.test(body) && /not a legal determination/.test(body), "LOMR case with non-determination wording");
  ok(!/-9999/.test(body), "no sentinel leaked into the zone card");
  ok(!/Not re-verified in this check/.test(body), "freshly fetched sub-results carry no stale note");
  const t = await page.textContent("#targetBar");
  ok(t.includes(lat.toFixed(6) + ", " + lon.toFixed(6)), "target bar shows the six-decimal queried point");
});

/* ---------------------------------------------------------------- 2. multiple candidates */
await scenario("census multiple candidates are selectable", Object.assign({}, F.STANDARD, { census: F.CENSUS_TWO }),
  async ({ page, reqs }) => {
    await page.fill("#q", "100 Main St Springfield");
    await page.click("#goBtn");
    await page.waitForSelector("#candBox .cand");
    ok((await page.locator("#candBox .cand").count()) === 2, "two candidate cards listed");
    ok(/returned 2 candidate points/.test(await page.textContent("#candBox")), "multi-candidate prompt");
    ok(!reqs.some(u => ["zone", "alerts", "gauges"].includes(F.classify(u))), "nothing checked before selection");
    await page.locator("#candBox .check-point").nth(1).click();
    await waitText(page, "#targetBar", /100 MAIN ST N/);
    const zu = new URL(reqs.find(u => F.classify(u) === "zone"));
    ok(zu.searchParams.get("geometry") === F.PT.lon.toFixed(6) + "," + F.PT.lat.toFixed(6),
      "the SECOND candidate's coordinates were checked");
  });

/* ---------------------------------------------------------------- 3. no match + JSONP failure cleanup */
await scenario("census no-match and JSONP failure cleanup", Object.assign({}, F.STANDARD, { census: F.CENSUS_NONE }),
  async ({ page, ctx, reqs }) => {
    await page.fill("#q", "nowhere at all");
    await page.click("#goBtn");
    await waitText(page, "#candBox", /No match for that address/);
    ok(/No flood-hazard claim/.test(await page.textContent("#candBox")), "no-match makes no hazard claim");
    ok(!reqs.some(u => ["zone", "alerts", "gauges"].includes(F.classify(u))), "no hazard request after no-match");
    /* now make the JSONP script fail to load: error path must clean up and report */
    await ctx.unroute(/^https?:/);
    await F.installRouter(ctx, Object.assign({}, F.STANDARD, { census: "abort" }), reqs);
    await page.fill("#q", "another failing query");
    await page.click("#goBtn");
    await waitText(page, "#candBox", /Address lookup failed/);
    const clean = await page.evaluate(() => ({
      scripts: [...document.querySelectorAll("script[src*='census']")].length,
      cbs: Object.keys(window).filter(k => k.startsWith("__flood_cb_") && window[k] !== undefined).length
    }));
    ok(clean.scripts === 0 && clean.cbs === 0, "JSONP script tag and window callback cleaned up: " + JSON.stringify(clean));
  });

/* ---------------------------------------------------------------- 4. direct coordinates + device position */
await scenario("direct coordinates need one explicit Check", F.STANDARD, async ({ page, reqs }) => {
  await page.fill("#q", F.PT.lat + ", " + F.PT.lon);
  await page.waitForFunction(() => document.getElementById("goBtn").textContent === "Check this point");
  ok(!reqs.some(u => F.classify(u) !== "other"), "typing coordinates makes no request at all");
  await page.click("#goBtn");
  await waitText(page, "#femaBox", /Zone AE/);
  ok(!reqs.some(u => F.classify(u) === "census"), "coordinates never touch the Census geocoder");
});

await scenario("device position is a candidate needing an explicit Check", F.STANDARD, async ({ page, reqs }) => {
  await page.click("#deviceBtn");
  await page.waitForSelector("#candBox .cand");
  ok(/Reported accuracy ±42 m/.test(await page.textContent("#candBox")), "±42 m accuracy shown on the candidate");
  ok(/not a surveyed property corner/.test(await page.textContent("#candBox")), "device-fix caveat shown");
  const pre = reqs.map(F.classify).filter(k => k !== "other");
  ok(pre.length === 0, "a device fix alone contacts nobody: " + pre.join(","));
  ok(await page.locator("#results").isHidden(), "no results section before the explicit Check");
  await page.click("#candBox .check-point");
  await waitText(page, "#targetBar", /Device position/);
  await waitText(page, "#femaBox", /Zone AE/);
  ok(/reported accuracy ±42 m/.test(await page.textContent("#targetBar")), "±42 m accuracy carried into the target");
}, { context: { geolocation: { latitude: F.PT.lat, longitude: F.PT.lon, accuracy: 42 }, permissions: ["geolocation"] } });

/* ---------------------------------------------------------------- 5. suite-location shortcut + cross-tab watch */
await scenario("suite shortcut is explicit; cross-tab change updates only the candidate", F.STANDARD,
  async ({ page, ctx, reqs }) => {
    await waitText(page, "#suiteCand", /Los Angeles/);
    ok(/may be approximate/.test(await page.textContent("#suiteCand")), "approximation warning on the shortcut");
    ok(!reqs.some(u => F.classify(u) !== "other"), "shortcut display makes no request");
    await page.click("#suiteBtn");
    await waitText(page, "#targetBar", /suite location, may be approximate/);
    await waitText(page, "#femaBox", /Zone AE/);
    const before = await page.textContent("#targetBar");
    /* cross-tab suite-location change (storage events only fire across documents) */
    const p2 = await ctx.newPage();
    await p2.goto(DIST);
    await p2.evaluate(() => localStorage.setItem("suite.location", JSON.stringify({ lat: 40.7, lon: -74.0, label: "New York" })));
    await waitText(page, "#suiteCand", /New York/);
    ok(await page.textContent("#targetBar") === before, "checked flood target untouched by the cross-tab change");
    ok(/Zone AE/.test(await page.textContent("#femaBox")), "rendered result untouched");
    await p2.close();
  }, { seed: { "suite.location": { lat: 34.0522, lon: -118.2437, label: "Los Angeles" } } });

/* ---------------------------------------------------------------- 6. cross-tab abort during a request:
   still-current target retries exactly once; superseded target never renders */
await scenario("suite-location abort mid-flight → single retry for the current target", (() => {
  let calls = 0;
  return Object.assign({}, F.STANDARD, {
    zone: () => { calls++; return new Promise(res => setTimeout(() =>
      res(F.zoneFC([{ props: { FLD_ZONE: "AE", SFHA_TF: "T" } }])), calls === 1 ? 600 : 10)); }
  });
})(), async ({ page, reqs }) => {
  await page.fill("#q", F.PT.lat + ", " + F.PT.lon);
  await page.click("#goBtn");
  /* wait until the zone request is actually in flight, then flip the shared location */
  for (let i = 0; i < 50 && !reqs.some(u => F.classify(u) === "zone"); i++) await page.waitForTimeout(50);
  ok(reqs.some(u => F.classify(u) === "zone"), "zone request in flight");
  await page.evaluate(() => localStorage.setItem("suite.location", JSON.stringify({ lat: 1, lon: 2, label: "Elsewhere" })));
  await waitText(page, "#femaBox", /Zone AE/, 15000);
  const zoneCalls = reqs.filter(u => F.classify(u) === "zone").length;
  ok(zoneCalls === 2, "layer 28 called exactly twice (abort + one retry); got " + zoneCalls);
}, { seed: { "suite.location": { lat: 34.05, lon: -118.24, label: "LA" } } });

{
  let releaseA = null;
  const cfg = Object.assign({}, F.STANDARD, {
    zone: url => {
      const g = new URL(url).searchParams.get("geometry");
      if (g.startsWith(F.PT.lon.toFixed(6))) /* target A: hangs until released */
        return new Promise(res => { releaseA = () => res(F.zoneFC([{ props: { FLD_ZONE: "VE", SFHA_TF: "T" } }])); });
      return F.zoneFC([{ props: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F" } }],
        { lat: 40.0, lon: -100.0 });
    }
  });
  await scenario("superseded target: old response neither renders nor retries", cfg, async ({ page, reqs }) => {
    await page.fill("#q", F.PT.lat + ", " + F.PT.lon);          // target A (its zone request hangs)
    await page.click("#goBtn");
    await page.waitForFunction(() => true);
    for (let i = 0; i < 50 && !releaseA; i++) await page.waitForTimeout(100);
    ok(releaseA, "target A's zone request reached the router");
    await page.fill("#q", "40.0, -100.0");                       // target B supersedes A
    await page.click("#goBtn");
    await waitText(page, "#femaBox", /Zone X/);
    /* change suite.location so A's late response also hits the locationChanged path —
       a superseded generation must not retry either way */
    await page.evaluate(() => localStorage.setItem("suite.location", JSON.stringify({ lat: 5, lon: 6, label: "Moved" })));
    const before = reqs.filter(u => F.classify(u) === "zone").length;
    releaseA();                                                  // A's response finally arrives
    await page.waitForTimeout(600);
    const fema = await page.textContent("#femaBox");
    ok(/Zone X/.test(fema) && !/Zone VE/.test(fema), "superseded target A never rendered");
    const after = reqs.filter(u => F.classify(u) === "zone").length;
    ok(after === before, "superseded target did not retry (zone calls " + before + " -> " + after + ")");
    ok(/40\.000000, -100\.000000/.test(await page.textContent("#targetBar")), "target bar shows B");
  });
}

/* ---------------------------------------------------------------- 7. zone matrix via saved-target boot */
const matrix = [
  ["X 0.2% band", { FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", SFHA_TF: "F" },
    [/Outside the mapped Special Flood Hazard Area/, /0\.2% annual-chance/, /Flooding can still occur/]],
  ["X minimal", { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F" },
    [/minimal mapped flood hazard/, /Flooding can still occur here/]],
  ["D undetermined", { FLD_ZONE: "D", SFHA_TF: "F" }, [/Undetermined/, /no flood hazard analysis/i]],
  ["VE coastal", { FLD_ZONE: "VE", SFHA_TF: "T", STATIC_BFE: 13, V_DATUM: "NAVD88", LEN_UNIT: "FEET" },
    [/Coastal high-hazard/, /wave hazards/, /Base flood elevation[\s\S]{0,4}13 feet/, /Vertical datum[\s\S]{0,4}NAVD88/]],
  ["AO depth", { FLD_ZONE: "AO", SFHA_TF: "T", DEPTH: 2, LEN_UNIT: "FEET" },
    [/sheet-flow/, /Mapped flood depth[\s\S]{0,4}2 feet/]],
  ["sentinel -9999 suppressed", { FLD_ZONE: "AE", SFHA_TF: "T", STATIC_BFE: -9999, V_DATUM: "NAVD88", VELOCITY: -9999, VEL_UNIT: "FPS" },
    [/Zone AE/], [/Base flood elevation/, /Mapped velocity/, /-9999/]]
];
for (const [name, props, want, forbid] of matrix) {
  await scenario("zone: " + name, Object.assign({}, F.STANDARD, { zone: F.zoneFC([{ props }]) }),
    async ({ page }) => {
      await waitText(page, "#femaBox", /Zone/);
      await waitText(page, "#femaBox", /panel|Panel/i);
      const txt = await page.textContent("#femaBox");
      for (const re of want) ok(re.test(txt), name + " must render " + re);
      for (const re of (forbid || [])) ok(!re.test(txt), name + " must NOT render " + re);
    }, { seed: { "suite.flood.target": TGT } });
}

await scenario("dual overlapping zones: any SFHA_TF=T wins the summary; all listed", Object.assign({}, F.STANDARD, {
  zone: F.zoneFC([
    { props: { FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", SFHA_TF: "F" } },
    { props: { FLD_ZONE: "AE", SFHA_TF: "T", DUAL_ZONE: "X" } }
  ])
}), async ({ page }) => {
  await waitText(page, "#femaBox", /overlapping zone records/);
  const txt = await page.textContent("#femaBox");
  ok(/Inside a mapped Special Flood Hazard Area/.test(txt), "summary is SFHA because one record says T");
  ok(/Zone X \+ AE/.test(txt), "both zones named");
  ok((await page.locator("#femaBox .zone-block").count()) === 2, "both zone records listed");
  ok(/Dual zone/.test(txt), "DUAL_ZONE value surfaced");
  ok(/Inside a mapped SFHA/.test(await page.textContent("#glanceFema")), "glance tile agrees");
}, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 8. empty-zone states */
await scenario("no zone + NFHL availability present", Object.assign({}, F.STANDARD, { zone: F.EMPTY_FC, avail: { count: 2 } }),
  async ({ page, reqs }) => {
    await waitText(page, "#femaBox", /coverage exists here, but no flood-zone feature/i);
    ok(reqs.some(u => F.classify(u) === "avail"), "layer 0 availability was queried");
    const av = new URL(reqs.find(u => F.classify(u) === "avail"));
    ok(av.searchParams.get("returnCountOnly") === "true", "availability is a count-only request");
    ok(!reqs.some(u => ["panel", "lomr"].includes(F.classify(u))), "panel/LOMR skipped on an empty zone answer");
    ok(!/not in a flood zone|no flood risk\b(?! result)/i.test(await page.textContent("#femaBox")), "never claims not-in-a-flood-zone");
  }, { seed: { "suite.flood.target": TGT } });

await scenario("no zone + no NFHL coverage", Object.assign({}, F.STANDARD, { zone: F.EMPTY_FC, avail: { count: 0 } }),
  async ({ page }) => {
    await waitText(page, "#femaBox", /coverage is not available for this point/i);
  }, { seed: { "suite.flood.target": TGT } });

await scenario("FEMA unreachable is not 'no flood zone'", Object.assign({}, F.STANDARD, { zone: "abort" }),
  async ({ page }) => {
    await waitText(page, "#femaBox", /could not be reached/i, 25000);
    ok(/No flood-zone conclusion can be drawn/.test(await page.textContent("#femaBox")), "explicitly refuses a conclusion");
    /* the other sections still rendered independently */
    await waitText(page, "#alertBox", /Flood Warning/);
    await waitText(page, "#gaugeBox", /Big River/);
  }, { seed: { "suite.flood.target": TGT } });

await scenario("GeoJSON dialect rejected → one Esri JSON fallback, same allowlist", Object.assign({}, F.STANDARD, {
  zone: url => new URL(url).searchParams.get("f") === "geojson"
    ? { error: { code: 400, message: "Invalid or missing input parameters.",
        details: ["The provided output spatial reference is not supported with geoJSON format."] } }
    : { features: [{ attributes: { DFIRM_ID: "22071C", FLD_ZONE: "AE", ZONE_SUBTY: null, SFHA_TF: "T",
          STATIC_BFE: 8, V_DATUM: "NAVD88", DEPTH: -9999, LEN_UNIT: null, VELOCITY: -9999, VEL_UNIT: null,
          DUAL_ZONE: null, SOURCE_CIT: "STUDY_CIT_22071C" },
        geometry: { rings: F.squareAround(F.PT.lat, F.PT.lon).coordinates } }] }
}), async ({ page, reqs }) => {
  await waitText(page, "#femaBox", /Zone AE/);
  await waitText(page, "#mapText", /Text equivalent/);
  const zones = reqs.filter(u => F.classify(u) === "zone").map(u => new URL(u).searchParams.get("f"));
  ok(JSON.stringify(zones) === JSON.stringify(["geojson", "json"]), "exactly one fallback request: " + JSON.stringify(zones));
  const fb = new URL(reqs.filter(u => F.classify(u) === "zone")[1]).searchParams;
  ok(fb.get("outFields") === F.ZONE_FIELDS && fb.get("geometryPrecision") === "5" &&
     fb.get("maxAllowableOffset") === "0.00005" && fb.get("outSR") === "4326",
    "fallback keeps the allowlist + simplification");
  ok(/Inside a mapped Special Flood Hazard Area/.test(await page.textContent("#femaBox")), "normalized Esri JSON renders fully");
  const m = (await page.textContent("#mapText")).match(/zone edge: (\d+) m/);
  ok(m && Math.abs(+m[1] - 482) < 15, "edge distance works on Esri rings (got " + (m && m[1]) + ")");
}, { seed: { "suite.flood.target": TGT } });

await scenario("zone ok + panel failure keeps the zone", Object.assign({}, F.STANDARD, { panel: { status: 500, contentType: "application/json", body: "{}" } }),
  async ({ page }) => {
    await waitText(page, "#femaBox", /Zone AE/);
    await waitText(page, "#femaBox", /panel details are unavailable/i, 25000);
    ok(/Zone AE/.test(await page.textContent("#femaBox")), "zone survives the panel failure");
    ok(/zone result above is unaffected/.test(await page.textContent("#femaBox")), "honest partial-state wording");
  }, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 9. footprint: Polygon, MultiPolygon, edge distance */
await scenario("footprint SVG + approximate edge distance (Polygon)", F.STANDARD, async ({ page }) => {
  await waitText(page, "#mapText", /Text equivalent/);
  const svg = await page.evaluate(() => {
    const s = document.getElementById("footprint");
    return { role: s?.getAttribute("role"), label: s?.getAttribute("aria-label"), paths: s?.querySelectorAll("path").length };
  });
  ok(svg.role === "img" && svg.paths >= 1, "SVG is an accessible image with the zone path");
  ok(/zone AE/i.test(svg.label) && /distance/i.test(svg.label), "aria-label describes zone + distance");
  const m = (await page.textContent("#mapText")).match(/Approximate distance to this mapped zone edge: (\d+) m/);
  ok(m, "edge distance rendered in metres");
  const expected = 0.005 * 111320 * Math.cos(F.PT.lat * Math.PI / 180);
  ok(Math.abs(+m[1] - expected) < 12, "edge distance ≈ " + Math.round(expected) + " m (got " + m[1] + ")");
  ok(/Only the FEMA polygon/.test(await page.textContent("#mapSec")), "containing-polygon-only caption");
}, { seed: { "suite.flood.target": TGT } });

await scenario("footprint renders MultiPolygon without errors", Object.assign({}, F.STANDARD, {
  zone: F.zoneFC([{ props: { FLD_ZONE: "AE", SFHA_TF: "T" }, geometry: F.multiAround(F.PT.lat, F.PT.lon) }])
}), async ({ page }) => {
  await waitText(page, "#mapText", /Text equivalent/);
  const d = await page.evaluate(() => document.querySelector("#footprint path")?.getAttribute("d") || "");
  ok((d.match(/M/g) || []).length >= 3, "all MultiPolygon rings drawn (" + (d.match(/M/g) || []).length + " subpaths)");
}, { seed: { "suite.flood.target": TGT } });

await scenario("poor device accuracy suppresses the edge distance", F.STANDARD, async ({ page }) => {
  await waitText(page, "#mapText", /Text equivalent/);
  ok(/suppressed[^]*±700 m/.test(await page.textContent("#mapText")), "±700 m accuracy suppresses the number");
  ok(!/Approximate distance to this mapped zone edge: \d/.test(await page.textContent("#mapText")), "no numeric distance shown");
}, { seed: { "suite.flood.target": Object.assign({}, TGT, { source: "device", accuracy: 700 }) } });

/* ---------------------------------------------------------------- 10. alerts filtering + gauges ranking */
await scenario("NWS filtering, ordering, unrelated-only wording", F.STANDARD, async ({ page }) => {
  await waitText(page, "#alertBox", /Flood Warning/);
  const events = await page.evaluate(() => [...document.querySelectorAll("#alertBox .a-event")].map(e => e.textContent));
  ok(JSON.stringify(events) === JSON.stringify(["Flood Warning", "Flood Advisory", "Hydrologic Outlook"]),
    "flood alerts only, severity-sorted: " + JSON.stringify(events));
  const txt = await page.textContent("#alertBox");
  ok(!/Tornado|Heat Advisory/.test(txt), "unrelated alerts excluded");
  ok(/Move to higher ground\./.test(txt), "NWS instructions verbatim");
  ok(/3 active flood alerts/.test(await page.textContent("#glanceAlert")), "glance counts flood alerts only");
}, { seed: { "suite.flood.target": TGT } });

await scenario("unrelated-only alerts say 'no flood-related', not 'no alerts'", Object.assign({}, F.STANDARD, { alerts: F.ALERTS_UNRELATED_ONLY }),
  async ({ page }) => {
    await waitText(page, "#alertBox", /No active flood-related NWS alert/);
    const txt = await page.textContent("#alertBox");
    ok(/1 unrelated alert is active/.test(txt), "unrelated count acknowledged");
    ok(!/No active alerts\b/.test(txt), "never claims zero alerts overall");
  }, { seed: { "suite.flood.target": TGT } });

await scenario("gauges: flood stage outranks nearest; sentinels; 20 km bound", F.STANDARD, async ({ page }) => {
  await waitText(page, "#gaugeBox", /Big River/);
  const names = await page.evaluate(() => [...document.querySelectorAll("#gaugeBox .gauge h3")].map(e => e.textContent.trim()));
  ok(names[0] === "Big River at Town", "flood-stage gauge ranked first despite being farther: " + JSON.stringify(names));
  ok(!names.includes("Too Far River"), "44 km gauge filtered out of the 20 km search");
  const txt = await page.textContent("#gaugeBox");
  ok(/13(\.\d)? km/.test(txt), "distance shown on the top card");
  ok(/reading unavailable \/ out of service/.test(txt), "-999 sentinel renders as out of service, never a number");
  ok(!/0001|Jan 1, 1\b/.test(txt), "no sentinel date leaks into a gauge card");
  ok(!/-999/.test(txt), "no raw sentinel value");
  ok(/Forecast major flooding — Big River at Town/.test(await page.textContent("#glanceGauge")), "glance shows the worst category");
  ok(/drainage path/.test(txt), "nearest-gauge caveat present");
}, { seed: { "suite.flood.target": TGT } });

await scenario("no gauges → explicit 50 km expansion + rivers link", Object.assign({}, F.STANDARD, { gauges: F.GAUGES_NONE }),
  async ({ page, reqs }) => {
    await waitText(page, "#gaugeBox", /No NOAA forecast gauge within 20 km/);
    ok(await page.locator("#gaugeBox a[href='rivers.html']").count() === 1, "rivers.html link offered");
    ok(reqs.filter(u => F.classify(u) === "gauges").length === 1, "exactly one automatic gauge request");
    await page.click("#expandBtn");
    await waitText(page, "#gaugeBox", /within 50 km/);
    const g2 = reqs.filter(u => F.classify(u) === "gauges");
    ok(g2.length === 2, "expansion is one additional request");
    const sp = new URL(g2[1]).searchParams;
    ok(sp.get("bbox.ymin") === (F.PT.lat - 50 / 111.2).toFixed(4), "expanded request still bounded (50 km)");
  }, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 11. remote-data escaping */
await scenario("remote strings cannot inject markup", Object.assign({}, F.STANDARD, {
  zone: F.zoneFC([{ props: { FLD_ZONE: "AE", SFHA_TF: "T", SOURCE_CIT: "<img src=x onerror=\"window.__xss=1\">" } }]),
  alerts: F.alertsFC([{ event: "Flood Warning", severity: "Severe", urgency: "Immediate",
    headline: "<script>window.__xss=2<\/script>", areaDesc: "<b id='evil'>X</b>", description: "d", effective: "2026-07-31T09:00:00-05:00" }]),
  gauges: F.gauges([{ lid: "G1", name: "<img src=x onerror=\"window.__xss=3\">", latitude: F.PT.lat, longitude: F.PT.lon,
    status: { observed: { primary: 1, primaryUnit: "ft", floodCategory: "action", validTime: "2026-07-31T12:00:00Z" } } }])
}), async ({ page }) => {
  await waitText(page, "#femaBox", /Zone AE/);
  await waitText(page, "#gaugeBox", /onerror/);
  const probe = await page.evaluate(() => ({
    xss: window.__xss, imgs: document.querySelectorAll("#femaBox img, #gaugeBox img").length,
    evil: !!document.getElementById("evil"),
    literal: document.body.innerText.includes('<img src=x onerror="window.__xss=1">')
  }));
  ok(probe.xss === undefined && probe.imgs === 0 && !probe.evil && probe.literal,
    "injected markup rendered as inert text: " + JSON.stringify(probe));
}, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 12. caches: fresh boot, stale offline, partial */
await scenario("caches: warm boot renders before network; stale + partial offline honest", F.STANDARD,
  async ({ page, ctx, reqs }) => {
    await waitText(page, "#femaBox", /Zone AE/);
    await waitText(page, "#gaugeBox", /Big River/);
    const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("suite.cache.flood.")).sort());
    ok(keys.some(k => k.includes(".fema.")) && keys.some(k => k.includes(".alerts.")) && keys.some(k => k.includes(".gauges.")),
      "independent per-source cache envelopes: " + JSON.stringify(keys));
    /* age every flood cache past its TTL and go fully offline */
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith("suite.cache.flood.")) {
        const e = JSON.parse(localStorage.getItem(k));
        const back = 8 * 24 * 3600e3;
        if (e.t) e.t -= back;
        for (const part of ["zone", "panel", "lomr", "avail"]) if (e[part] && e[part].t) e[part].t -= back;
        localStorage.setItem(k, JSON.stringify(e));
      }
    });
    await ctx.unroute(/^https?:/);
    await F.installRouter(ctx, {}, reqs);   // every source aborts
    await page.reload();
    await waitText(page, "#femaBox", /Zone AE/);
    await waitText(page, "#femaStamp", /offline — cached from/i, 30000);
    await waitText(page, "#alertStamp", /offline — cached from/i, 30000);
    await waitText(page, "#gaugeStamp", /offline — cached from/i, 30000);
    ok(/Flood Warning/.test(await page.textContent("#alertBox")), "stale alerts still render");
    /* partial: only the FEMA cache remains */
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage))
        if (k.startsWith("suite.cache.flood.alerts.") || k.startsWith("suite.cache.flood.gauges.")) localStorage.removeItem(k);
    });
    await page.reload();
    await waitText(page, "#femaBox", /Zone AE/);
    await waitText(page, "#alertBox", /unavailable/i, 30000);
    await waitText(page, "#gaugeBox", /unavailable/i, 30000);
    ok(/no cached alert data/.test(await page.textContent("#alertBox")), "uncached section explains what is missing");
  }, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 13. bounded cache pruning */
await scenario("flood caches are bounded and never touch other keys", F.STANDARD, async ({ page }) => {
  await page.evaluate(() => {
    for (let i = 0; i < 12; i++)
      localStorage.setItem("suite.cache.flood.fema.seed" + String(i).padStart(2, "0"),
        JSON.stringify({ t: 1700000000000 + i * 1000, zone: { t: 1700000000000 + i * 1000, v: { features: [] } } }));
    for (let i = 0; i < 25; i++)
      localStorage.setItem("suite.cache.flood.geocode.seed" + String(i).padStart(2, "0"),
        JSON.stringify({ t: 1700000000000 + i * 1000, v: {} }));
    localStorage.setItem("suite.cache.other.keepme", JSON.stringify({ t: 1, v: "survive" }));
  });
  await page.fill("#q", F.PT.lat + ", " + F.PT.lon);
  await page.click("#goBtn");
  await waitText(page, "#femaBox", /Zone AE/);
  await page.fill("#q", F.ADDRESS);
  await page.click("#goBtn");
  await page.waitForSelector("#candBox .cand");
  const st = await page.evaluate(() => ({
    fema: Object.keys(localStorage).filter(k => k.startsWith("suite.cache.flood.fema.")).length,
    geo: Object.keys(localStorage).filter(k => k.startsWith("suite.cache.flood.geocode.")).length,
    oldestFemaGone: !localStorage.getItem("suite.cache.flood.fema.seed00"),
    oldestGeoGone: !localStorage.getItem("suite.cache.flood.geocode.seed00"),
    other: localStorage.getItem("suite.cache.other.keepme")
  }));
  ok(st.fema <= 10 && st.geo <= 20, "bounds enforced: " + JSON.stringify(st));
  ok(st.oldestFemaGone && st.oldestGeoGone, "oldest envelopes evicted first");
  ok(st.other === JSON.stringify({ t: 1, v: "survive" }), "non-flood cache key untouched");
});

/* ---------------------------------------------------------------- 13b. explicit refresh really
   goes to the network even inside the alert/gauge TTL, and still falls back to the cache */
await scenario("Refresh forces a network attempt inside the TTL; failure keeps the cached copy", (() => {
  let alertCalls = 0, gaugeCalls = 0;
  return Object.assign({}, F.STANDARD, {
    alerts: () => {
      alertCalls++;
      if (alertCalls === 2) return F.alertsFC([{ event: "Flash Flood Warning", severity: "Extreme",
        urgency: "Immediate", areaDesc: "Orleans Parish", headline: "Flash Flood Warning",
        description: "Refreshed.", effective: "2026-07-31T13:00:00-05:00" }]);
      if (alertCalls >= 3) return "abort";
      return F.ALERTS_MIXED;
    },
    gauges: url => { gaugeCalls++; return gaugeCalls >= 3 ? "abort" : F.gaugesNearUrl(url); }
  });
})(), async ({ page, reqs }) => {
  await waitText(page, "#alertBox", /Flood Warning/);
  await waitText(page, "#gaugeBox", /Big River/);
  const n = k => reqs.filter(u => F.classify(u) === k).length;
  ok(n("alerts") === 1 && n("gauges") === 1, "one automatic request per current-condition source");

  /* caches are seconds old and well inside TTL_ALERTS/TTL_GAUGES — the click must still fetch */
  await page.click("#refreshBtn");
  await waitText(page, "#alertBox", /Flash Flood Warning/, 15000);
  for (let i = 0; i < 60 && n("gauges") < 2; i++) await page.waitForTimeout(50);
  ok(n("alerts") === 2 && n("gauges") === 2, "refresh issued a real request for both sources: alerts=" + n("alerts") + " gauges=" + n("gauges"));
  ok(!/offline — cached from/i.test(await page.textContent("#alertStamp")), "a successful refresh is stamped as fetched");

  /* second refresh: both sources fail — the cached copy survives, honestly stamped */
  await page.click("#refreshBtn");
  await waitText(page, "#alertStamp", /offline — cached from/i, 20000);
  await waitText(page, "#gaugeStamp", /offline — cached from/i, 20000);
  ok(/Flash Flood Warning/.test(await page.textContent("#alertBox")), "cached alerts still rendered after a failed refresh");
  ok(/Big River/.test(await page.textContent("#gaugeBox")), "cached gauges still rendered after a failed refresh");
}, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 13c. a failed/stale FEMA
   enrichment refresh may never look freshly verified */
await scenario("stale panel/LOMR whose refresh fails are labelled, not presented as current",
  Object.assign({}, F.STANDARD, { panel: "abort", lomr: "abort" }), async ({ page, reqs }) => {
    await waitText(page, "#femaBox", /Zone AE/);
    await waitText(page, "#femaBox", /Not re-verified in this check/, 25000);
    const txt = await page.textContent("#femaBox");
    ok(/2207100115F/.test(txt), "the cached panel record is still shown (partial preservation)");
    ok(/22-06-1234P/.test(txt), "the cached LOMR record is still shown");
    const notes = await page.locator("#femaBox .subnote").count();
    ok(notes === 2, "both the panel and the LOMR sub-results are labelled (got " + notes + ")");
    ok(!reqs.some(u => F.classify(u) === "zone"), "a fresh cached zone was not re-fetched");
  }, {
    seed: { "suite.flood.target": TGT },
    init: () => {
      const now = Date.now(), day = 24 * 3600e3;
      localStorage.setItem("suite.cache.flood.fema.29.95110_-90.07150", JSON.stringify({
        t: now,
        zone: { t: now, v: { type: "FeatureCollection", features: [{ type: "Feature",
          properties: { DFIRM_ID: "22071C", FLD_ZONE: "AE", SFHA_TF: "T" }, geometry: null }] } },
        panel: { t: now - 8 * day, v: { features: [{ attributes: { DFIRM_ID: "22071C",
          FIRM_PAN: "2207100115F", PANEL_TYP: "PRINTED", EFF_DATE: 1475193600000, SCALE: "24000" } }] } },
        lomr: { t: now - 2 * day, v: { features: [{ attributes: { DFIRM_ID: "22071C",
          CASE_NO: "22-06-1234P", STATUS: "EFFECTIVE", EFF_DATE: 1678838400000 } }] } }
      }));
    }
  });

/* ---------------------------------------------------------------- 13d. malformed-but-HTTP-200
   payloads must never become "no zone / no alert / no gauge" */
await scenario("unreadable 200 payloads produce unknown states, never a negative claim",
  Object.assign({}, F.STANDARD, {
    zone: { type: "FeatureCollection", features: "not-an-array" },
    alerts: { title: "Service Unavailable", detail: "the alert index is rebuilding" },
    gauges: { gauges: null, message: "backend down" }
  }), async ({ page, reqs }) => {
    await waitText(page, "#femaBox", /could not be reached/i, 25000);
    await waitText(page, "#alertBox", /could not read/i, 25000);
    await waitText(page, "#gaugeBox", /could not read/i, 25000);
    const fema = await page.textContent("#femaBox");
    ok(/No flood-zone conclusion can be drawn/.test(fema), "unreadable zone payload refuses a conclusion");
    ok(!/coverage exists|coverage is not available|No flood-zone record was returned/i.test(fema),
      "an unreadable zone payload is never reported as an empty zone answer");
    ok(!reqs.some(u => F.classify(u) === "avail"), "no availability query off the back of unreadable data");
    const al = await page.textContent("#alertBox");
    ok(/this is not "no flood alert"/.test(al) && !/No active flood-related NWS alert/.test(al),
      "unreadable alert payload never claims there is no flood alert");
    const gg = await page.textContent("#gaugeBox");
    ok(/this is not "no gauge nearby"/.test(gg) && !/No NOAA forecast gauge within/.test(gg),
      "unreadable gauge payload never claims there is no gauge");
    ok(/Alert status unknown/.test(await page.textContent("#glanceAlert")) &&
       /Gauge status unknown/.test(await page.textContent("#glanceGauge")), "glance tiles say unknown");
  }, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 13e. a target switch during the
   FEMA zone fallback must query and cache the ORIGINAL point, not the new one */
{
  const A = F.PT, B = { lat: 40.0, lon: -100.0 };
  const geom = p => p.lon.toFixed(6) + "," + p.lat.toFixed(6);
  let releaseA = null;
  const cfg = Object.assign({}, F.STANDARD, {
    zone: url => {
      const sp = new URL(url).searchParams;
      const isA = sp.get("geometry") === geom(A);
      if (sp.get("f") === "geojson") {
        /* A's primary is held open so the target can change before its fallback is built */
        if (isA) return new Promise(res => { releaseA = () => res({ error: { code: 400,
          message: "Invalid or missing input parameters.",
          details: ["The provided output spatial reference is not supported with geoJSON format."] } }); });
        return F.zoneFC([{ props: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F" } }], B);
      }
      /* Esri fallback answers according to whichever point was actually asked for */
      return { features: [{ attributes: { DFIRM_ID: "22071C", FLD_ZONE: isA ? "VE" : "X",
        SFHA_TF: isA ? "T" : "F", ZONE_SUBTY: null, STATIC_BFE: -9999, V_DATUM: null, DEPTH: -9999,
        LEN_UNIT: null, VELOCITY: -9999, VEL_UNIT: null, DUAL_ZONE: null, SOURCE_CIT: "CIT" },
        geometry: null }] };
    }
  });
  await scenario("zone fallback after a target switch keeps the original point's identity", cfg,
    async ({ page, reqs }) => {
      await page.fill("#q", A.lat + ", " + A.lon);
      await page.click("#goBtn");                       // target A: primary geojson hangs
      for (let i = 0; i < 50 && !releaseA; i++) await page.waitForTimeout(100);
      ok(releaseA, "target A's primary zone request reached the router");
      await page.fill("#q", B.lat + ", " + B.lon);
      await page.click("#goBtn");                       // target B supersedes A
      await waitText(page, "#femaBox", /Zone X/);
      releaseA();                                       // A's rejection lands; its fallback fires now
      await page.waitForFunction(() => true);
      for (let i = 0; i < 60; i++) {
        const done = await page.evaluate(() => !!localStorage.getItem("suite.cache.flood.fema." +
          (29.9511).toFixed(5) + "_" + (-90.0715).toFixed(5)));
        if (done) break;
        await page.waitForTimeout(50);
      }
      const fallbacks = reqs.filter(u => F.classify(u) === "zone")
        .filter(u => new URL(u).searchParams.get("f") === "json");
      ok(fallbacks.length === 1, "exactly one Esri fallback was issued (" + fallbacks.length + ")");
      ok(new URL(fallbacks[0]).searchParams.get("geometry") === geom(A),
        "the fallback queried A's coordinate, not the new target's: " + new URL(fallbacks[0]).searchParams.get("geometry"));
      const cachedA = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("suite.cache.flood.fema.29.95110_-90.07150") || "null"));
      ok(cachedA && cachedA.zone && cachedA.zone.v.features[0].properties.FLD_ZONE === "VE",
        "A's cache holds A's own zone, not B's: " + JSON.stringify(cachedA && cachedA.zone && cachedA.zone.v.features[0].properties.FLD_ZONE));
      const fema = await page.textContent("#femaBox");
      ok(/Zone X/.test(fema) && !/Zone VE/.test(fema), "the superseded target still never renders");
    });
}

/* ---------------------------------------------------------------- 14b. cross-tab location change
   during a FAILED network call must still surrender the expired cached copy, not claim
   that no cache exists (core/suite.js stale-cache rejection carries locationChanged) */
{
  let releaseAlerts = null, hits = 0;
  const cfg = Object.assign({}, F.STANDARD, {
    alerts: () => { hits++; return hits === 1
      ? new Promise(res => { releaseAlerts = () => res("abort"); }) : "abort"; }
  });
  await scenario("expired cache + failed network + cross-tab location change still renders the cache", cfg,
    async ({ page, ctx, reqs }) => {
      for (let i = 0; i < 60 && !releaseAlerts; i++) await page.waitForTimeout(50);
      ok(releaseAlerts, "the alert request reached the router");
      /* another tab moves the shared suite location while the request is open */
      const p2 = await ctx.newPage();
      await p2.goto(pathToFileURL(join(ROOT, "dist", "index.html")).href);  // hub: same storage, no flood requests
      await p2.evaluate(() => localStorage.setItem("suite.location",
        JSON.stringify({ lat: 40.7, lon: -74.0, label: "New York" })));
      await p2.close();
      releaseAlerts();                                  // the network attempt now fails
      await waitText(page, "#alertBox", /Flood Warning/, 20000);
      await waitText(page, "#alertStamp", /offline — cached from/i, 20000);
      const txt = await page.textContent("#alertBox");
      ok(!/no cached alert data exists/.test(txt), "never claims the cache is absent when it is not");
      ok(reqs.filter(u => F.classify(u) === "alerts").length === 2,
        "exactly one narrowly scoped retry after the location-change rejection");
    }, {
      seed: { "suite.location": { lat: 34.0522, lon: -118.2437, label: "Los Angeles" },
        "suite.flood.target": TGT },
      init: () => {
        localStorage.setItem("suite.cache.flood.alerts.29.9511_-90.0715", JSON.stringify({
          t: Date.now() - 10 * 60e3,                    // past the 5-minute alert TTL
          v: { features: [{ properties: { event: "Flood Warning", severity: "Severe",
            urgency: "Immediate", areaDesc: "Orleans Parish", headline: "Flood Warning in effect",
            description: "Cached copy.", effective: "2026-07-31T09:00:00-05:00" } }] }
        }));
      }
    });
}

/* ---------------------------------------------------------------- 15. three-state SFHA:
   a missing or malformed flag is never an outside-SFHA claim */
const SFHA_CASES = [
  ["null flag", { FLD_ZONE: "AE", SFHA_TF: null }],
  ['string "Null"', { FLD_ZONE: "AE", SFHA_TF: "Null" }],
  ["unknown code", { FLD_ZONE: "AE", SFHA_TF: "Y" }],
  ["non-string flag", { FLD_ZONE: "AE", SFHA_TF: { v: true } }]
];
for (const [name, props] of SFHA_CASES) {
  await scenario("SFHA unknown, not outside: " + name,
    Object.assign({}, F.STANDARD, { zone: F.zoneFC([{ props }]) }), async ({ page }) => {
      await waitText(page, "#femaBox", /Zone AE/);
      const txt = await page.textContent("#femaBox");
      ok(/whether this coordinate is inside the SFHA is unknown/.test(txt), name + " must read as unknown");
      ok(!/Outside the mapped Special Flood Hazard Area/.test(txt), name + " must not claim outside-SFHA");
      ok(!/Inside a mapped Special Flood Hazard Area/.test(txt), name + " must not claim inside-SFHA");
      ok(/Not stated — FEMA returned no readable SFHA flag/.test(txt), "per-record SFHA row says not stated");
      ok(/SFHA status unknown — zone AE/.test(await page.textContent("#glanceFema")), "glance tile agrees");
    }, { seed: { "suite.flood.target": TGT } });
}

await scenario("explicit F on every record is the only route to an outside-SFHA claim",
  Object.assign({}, F.STANDARD, { zone: F.zoneFC([{ props: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: " f " } }]) }),
  async ({ page }) => {
    await waitText(page, "#femaBox", /Zone X/);
    const txt = await page.textContent("#femaBox");
    ok(/Outside the mapped Special Flood Hazard Area/.test(txt), "a whitespace/case variant of F still normalizes to outside");
    ok(/No — this record is explicitly outside the SFHA/.test(txt), "per-record row states the explicit F");
  }, { seed: { "suite.flood.target": TGT } });

await scenario("one unknown record among explicit F records blocks the outside claim",
  Object.assign({}, F.STANDARD, { zone: F.zoneFC([
    { props: { FLD_ZONE: "X", SFHA_TF: "F" } }, { props: { FLD_ZONE: "AE", SFHA_TF: null } }]) }),
  async ({ page }) => {
    await waitText(page, "#femaBox", /Zone X \+ AE/);
    const txt = await page.textContent("#femaBox");
    ok(/whether this coordinate is inside the SFHA is unknown/.test(txt), "mixed F + unknown is unknown overall");
    ok(!/Outside the mapped Special Flood Hazard Area/.test(txt), "must not claim outside");
  }, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 16. malformed RECORDS inside
   well-formed arrays must not become negative conclusions */
await scenario("all-unreadable FEMA zone records read as unknown, not as an empty answer",
  Object.assign({}, F.STANDARD, { zone: { type: "FeatureCollection", features: [{}, { properties: null }] } }),
  async ({ page, reqs }) => {
    await waitText(page, "#femaBox", /could not read/i, 20000);
    const txt = await page.textContent("#femaBox");
    ok(/flood-zone status of this point is unknown/.test(txt), "states the status is unknown");
    ok(/This is not "no flood zone"/.test(txt), "explicitly refuses the negative reading");
    ok(!/coverage exists|coverage is not available|No flood-zone record was returned/i.test(txt),
      "never falls through to an availability verdict");
    ok(!reqs.some(u => F.classify(u) === "avail"), "no availability query on unreadable records");
    ok(!reqs.some(u => ["panel", "lomr"].includes(F.classify(u))), "no enrichment on unreadable records");
    ok(/Zone records unreadable/.test(await page.textContent("#glanceFema")), "glance tile says unreadable");
  }, { seed: { "suite.flood.target": TGT } });

await scenario("partly unreadable FEMA records render the readable ones and say so",
  Object.assign({}, F.STANDARD, { zone: { type: "FeatureCollection", features: [
    { type: "Feature", properties: { FLD_ZONE: "AE", SFHA_TF: "T", DFIRM_ID: "22071C" }, geometry: null },
    { type: "Feature", properties: { SFHA_TF: "F" }, geometry: null }] } }),
  async ({ page }) => {
    await waitText(page, "#femaBox", /Zone AE/);
    const txt = await page.textContent("#femaBox");
    ok(/1 of the 2 returned zone records could not be read/.test(txt), "partial state is stated");
    ok(/The summary above is therefore partial/.test(txt), "summary is flagged partial");
    ok(/Inside a mapped Special Flood Hazard Area/.test(txt), "the readable T record still drives the inside claim");
  }, { seed: { "suite.flood.target": TGT } });

await scenario("all-unreadable NWS records read as unknown, never 'no flood alert'",
  Object.assign({}, F.STANDARD, { alerts: { features: [{}, { properties: { severity: "Severe" } }] } }),
  async ({ page }) => {
    await waitText(page, "#alertBox", /could not read/i, 20000);
    const txt = await page.textContent("#alertBox");
    ok(/this is not "no flood alert"/.test(txt), "refuses the negative reading");
    ok(!/No active flood-related NWS alert/.test(txt), "never claims no flood alert");
    ok(/Alert status unknown/.test(await page.textContent("#glanceAlert")), "glance tile says unknown");
  }, { seed: { "suite.flood.target": TGT } });

await scenario("all-unreadable NWPS records read as unknown, never 'no gauge within 20 km'",
  Object.assign({}, F.STANDARD, { gauges: { gauges: [{}, { latitude: "x", longitude: null }] } }),
  async ({ page }) => {
    await waitText(page, "#gaugeBox", /could not read/i, 20000);
    const txt = await page.textContent("#gaugeBox");
    ok(/this is not "no gauge nearby"/.test(txt), "refuses the negative reading");
    ok(!/No NOAA forecast gauge within/.test(txt), "never claims no gauge nearby");
    ok(/Gauge status unknown/.test(await page.textContent("#glanceGauge")), "glance tile says unknown");
  }, { seed: { "suite.flood.target": TGT } });

await scenario("non-string NWS text fields render safely instead of throwing",
  Object.assign({}, F.STANDARD, { alerts: F.alertsFC([
    { event: "Flood Warning", severity: "Severe", urgency: "Immediate",
      areaDesc: { county: "Orleans" }, headline: 42, description: { text: "obj" },
      instruction: ["a", "b"], effective: "not-a-date", ends: null }]) }),
  async ({ page }) => {
    await waitText(page, "#alertBox", /Flood Warning/, 20000);
    const txt = await page.textContent("#alertBox");
    ok(/No further detail provided/.test(txt), "non-string description falls back to the honest placeholder");
    ok(!/\[object Object\]|Invalid Date/.test(txt), "no object/date debris rendered: " + txt.slice(0, 200));
    ok(/1 active flood alert/.test(await page.textContent("#glanceAlert")), "the alert still counts");
  }, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 17. acquisition generation:
   a slow lookup never repaints or checks over newer user action */
{
  let releaseSlow = null;
  const cfg = Object.assign({}, F.STANDARD, {
    census: url => new URL(url).searchParams.get("address").includes("SLOW")
      ? new Promise(res => { releaseSlow = () => res(F.CENSUS_TWO); })
      : F.CENSUS_ONE
  });
  await scenario("a slow address lookup cannot repaint over a newer checked target", cfg,
    async ({ page, reqs }) => {
      await page.fill("#q", "SLOW ADDRESS");
      await page.click("#goBtn");
      for (let i = 0; i < 50 && !releaseSlow; i++) await page.waitForTimeout(100);
      ok(releaseSlow, "the slow census lookup reached the router");
      /* the user gives up and checks a coordinate directly */
      await page.fill("#q", F.PT.lat + ", " + F.PT.lon);
      await page.click("#goBtn");
      await waitText(page, "#femaBox", /Zone AE/);
      const bar = await page.textContent("#targetBar");
      releaseSlow();
      await page.waitForTimeout(500);
      ok((await page.locator("#candBox .cand").count()) === 0,
        "the superseded lookup painted no candidates");
      ok(await page.textContent("#targetBar") === bar, "the checked target is untouched");
      ok(/Zone AE/.test(await page.textContent("#femaBox")), "the rendered result is untouched");
      const zones = reqs.filter(u => F.classify(u) === "zone").length;
      ok(zones === 1, "the superseded lookup started no second classification (" + zones + ")");
    });
}

/* ---------------------------------------------------------------- 18. BFE unit handling */
const BFE_CASES = [
  ["feet", { FLD_ZONE: "AE", SFHA_TF: "T", STATIC_BFE: 8, V_DATUM: "NAVD88", LEN_UNIT: "FT" },
    [/Base flood elevation[\s\S]{0,4}8 feet/, /Vertical datum[\s\S]{0,4}NAVD88/], [/8 meters/]],
  ["meters", { FLD_ZONE: "AE", SFHA_TF: "T", STATIC_BFE: 3, V_DATUM: "NAVD88", LEN_UNIT: "Meters" },
    [/Base flood elevation[\s\S]{0,4}3 meters/, /Vertical datum[\s\S]{0,4}NAVD88/], [/3 feet|3 ft\b/]],
  ["missing unit", { FLD_ZONE: "AE", SFHA_TF: "T", STATIC_BFE: 8, V_DATUM: "NAVD88", LEN_UNIT: null },
    [/returned a value with no length unit, so it is not shown/], [/8 feet|8 ft\b|8 meters/]]
];
for (const [name, props, want, forbid] of BFE_CASES) {
  await scenario("BFE unit: " + name, Object.assign({}, F.STANDARD, { zone: F.zoneFC([{ props }]) }),
    async ({ page }) => {
      await waitText(page, "#femaBox", /Zone AE/);
      const txt = await page.textContent("#femaBox");
      for (const re of want) ok(re.test(txt), name + " must render " + re);
      for (const re of forbid) ok(!re.test(txt), name + " must NOT render " + re);
    }, { seed: { "suite.flood.target": TGT } });
}

/* ---------------------------------------------------------------- 19. panel identity + ties */
await scenario("panel identity is normalized and a tie is shown as ambiguous, not guessed",
  Object.assign({}, F.STANDARD, { panel: F.arcgisTable([
    { DFIRM_ID: " 22071c ", FIRM_PAN: "TIED-A", PANEL_TYP: "PRINTED", EFF_DATE: Date.UTC(2016, 8, 30), SCALE: "24000" },
    { DFIRM_ID: "22071C", FIRM_PAN: "TIED-B", PANEL_TYP: "PRINTED", EFF_DATE: Date.UTC(2016, 8, 30), SCALE: "24000" }]) }),
  async ({ page }) => {
    await waitText(page, "#femaBox", /FIRM panel/);
    const txt = await page.textContent("#femaBox");
    ok(!/None of the returned panels matches/.test(txt), "the untrimmed lowercase id still matches the zone study");
    ok(/2 returned panels tie on study match, print status and effective date/.test(txt), "ambiguity is stated");
    ok(!/Primary \(study matches the zone record\)/.test(txt), "no primary is claimed on a tie");
    ok((await page.locator("#femaBox .msg").allInnerTexts()).filter(t => /Tied candidate:/.test(t)).length === 2,
      "both tied candidates are marked");
  }, { seed: { "suite.flood.target": TGT } });

await scenario("an explicitly printed panel outranks one with no stated print status",
  Object.assign({}, F.STANDARD, { panel: F.arcgisTable([
    { DFIRM_ID: "22071C", FIRM_PAN: "UNKNOWN-TYP", PANEL_TYP: null, EFF_DATE: Date.UTC(2016, 8, 30), SCALE: "24000" },
    { DFIRM_ID: "22071C", FIRM_PAN: "PRINTED-ONE", PANEL_TYP: "PRINTED", EFF_DATE: Date.UTC(2016, 8, 30), SCALE: "24000" }]) }),
  async ({ page }) => {
    await waitText(page, "#femaBox", /FIRM panel/);
    const txt = await page.textContent("#femaBox");
    ok(/Primary \(study matches the zone record\):[\s\S]{0,60}PRINTED-ONE/.test(txt),
      "the explicitly printed panel is primary");
    ok(/print status not stated/.test(txt), "the unknown print status is labelled, not assumed printed");
  }, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 20. NWPS bbox really covers
   the advertised radius (a gauge 18 km due north/south is inside the old ±0.15° blind spot) */
await scenario("a gauge 18 km due north or south is inside the advertised 20 km search",
  Object.assign({}, F.STANDARD, { gauges: F.gaugesInBbox(F.GAUGES_NS_18KM) }),
  async ({ page }) => {
    await waitText(page, "#gaugeBox", /North Fork at Eighteen/, 20000);
    const names = await page.evaluate(() => [...document.querySelectorAll("#gaugeBox .gauge h3")].map(e => e.textContent.trim()));
    ok(names.includes("North Fork at Eighteen") && names.includes("South Fork at Eighteen"),
      "both cardinal-direction gauges downloaded and shown: " + JSON.stringify(names));
    ok(!/No NOAA forecast gauge within 20 km/.test(await page.textContent("#gaugeBox")),
      "never falsely reports an empty 20 km search");
  }, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 21. NWPS currency */
await scenario("not-current readings are unavailable, undated, and lose forecast ranking",
  Object.assign({}, F.STANDARD, { gauges: F.GAUGES_NOT_CURRENT }), async ({ page }) => {
    await waitText(page, "#gaugeBox", /Stale Bayou/, 20000);
    const txt = await page.textContent("#gaugeBox");
    ok(/not current — NWPS reports this reading is out of date/.test(txt), "not-current wording shown");
    ok(!/12\.5|13\.1/.test(txt), "the not-current numbers are never displayed: " + txt.slice(0, 300));
    ok(!/0001|Jan 1, 1\b/.test(txt), "the 0001-01-01 sentinel time is suppressed");
    ok(!/obs_not_current|fcst_not_current/.test(txt), "the raw not-current category is not shown as a flood category");
    const names = await page.evaluate(() => [...document.querySelectorAll("#gaugeBox .gauge h3")].map(e => e.textContent.trim()));
    ok(names[0] === "Live Creek at Now",
      "the gauge with a genuinely current forecast outranks the nearer stale one: " + JSON.stringify(names));
    ok(/No gauge at flood stage nearby/.test(await page.textContent("#glanceGauge")),
      "a not-current category never contributes a flood rank");
  }, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 22. ring validation */
await scenario("a malformed ring is discarded whole, never stitched across missing vertices",
  Object.assign({}, F.STANDARD, { zone: F.zoneFC([{ props: { FLD_ZONE: "AE", SFHA_TF: "T" },
    geometry: { type: "MultiPolygon", coordinates: [
      /* ring 1: one broken vertex — the whole ring must go, not just the vertex */
      [[[F.PT.lon - 0.005, F.PT.lat - 0.005], [null, 3], [F.PT.lon + 0.005, F.PT.lat + 0.005],
        [F.PT.lon - 0.005, F.PT.lat + 0.005], [F.PT.lon - 0.005, F.PT.lat - 0.005]]],
      /* ring 2: complete and closed — the only geometry that may be drawn */
      F.squareAround(F.PT.lat, F.PT.lon, 0.004).coordinates] } }]) }),
  async ({ page }) => {
    await waitText(page, "#mapText", /Text equivalent/, 20000);
    const subpaths = await page.evaluate(() =>
      ((document.querySelector("#footprint path")?.getAttribute("d") || "").match(/M/g) || []).length);
    ok(subpaths === 1, "only the one complete ring was drawn (" + subpaths + " subpaths)");
    const m = (await page.textContent("#mapText")).match(/zone edge: (\d+) m/);
    const expected = 0.004 * 111320 * Math.cos(F.PT.lat * Math.PI / 180);
    ok(m && Math.abs(+m[1] - expected) < 12,
      "edge distance comes from the valid ring only (got " + (m && m[1]) + ", expected ≈" + Math.round(expected) + ")");
  }, { seed: { "suite.flood.target": TGT } });

await scenario("no usable ring: no footprint, no edge distance, no inside-the-polygon claim",
  Object.assign({}, F.STANDARD, { zone: F.zoneFC([{ props: { FLD_ZONE: "AE", SFHA_TF: "T" },
    geometry: { type: "Polygon", coordinates: [
      [[F.PT.lon, F.PT.lat], [F.PT.lon + 0.005, F.PT.lat], [F.PT.lon + 0.005, F.PT.lat + 0.005]] ] } }]) }),
  async ({ page }) => {
    await waitText(page, "#mapSec", /could not read as a complete boundary/, 20000);
    const sec = await page.textContent("#mapSec");
    ok(!/the checked point sits inside the simplified FEMA polygon/.test(sec), "no inside-the-polygon claim");
    ok(!/Approximate distance to this mapped zone edge/.test(sec), "no edge distance claimed");
    ok((await page.locator("#footprint").count()) === 0, "no SVG drawn from unusable geometry");
    ok(/Zone AE/.test(await page.textContent("#femaBox")), "the classification itself is unaffected");
  }, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 23. per-section announcements */
await scenario("per-section status nodes announce classification, enrichment and conditions", F.STANDARD,
  async ({ page }) => {
    await waitText(page, "#femaStatus", /FEMA classification/, 20000);
    await waitText(page, "#femaStatus", /FIRM panel and map-revision details loaded/, 20000);
    const s = await page.evaluate(() => ({
      fema: document.getElementById("femaStatus").textContent,
      alert: document.getElementById("alertStatus").textContent,
      gauge: document.getElementById("gaugeStatus").textContent,
      busy: ["femaSec", "alertSec", "gaugeSec"].map(id => document.getElementById(id).getAttribute("aria-busy"))
    }));
    ok(/zone AE, inside a mapped Special Flood Hazard Area/.test(s.fema), "FEMA status is concise and specific: " + s.fema);
    ok(/3 active flood-related NWS alerts, most severe Flood Warning/.test(s.alert), "alert status: " + s.alert);
    ok(/gauges? within 20 km/.test(s.gauge), "gauge status: " + s.gauge);
    ok(s.busy.every(v => v === "false"), "every section settles to aria-busy=false: " + JSON.stringify(s.busy));
  }, { seed: { "suite.flood.target": TGT } });

await scenario("a failed enrichment announces the failure without retracting the zone",
  Object.assign({}, F.STANDARD, { panel: "abort", lomr: "abort" }), async ({ page }) => {
    await waitText(page, "#femaStatus", /details are unavailable; the zone result stands/, 25000);
    const s = await page.textContent("#femaStatus");
    ok(/zone AE, inside a mapped Special Flood Hazard Area/.test(s), "the classification is still announced: " + s);
    ok(await page.getAttribute("#femaSec", "aria-busy") === "false", "the FEMA section is no longer busy");
  }, { seed: { "suite.flood.target": TGT } });

{
  let releaseZone = null;
  const cfg = Object.assign({}, F.STANDARD, {
    zone: () => new Promise(res => { releaseZone = () => res(F.STANDARD.zone()); })
  });
  await scenario("aria-busy is true while a section is in flight", cfg, async ({ page }) => {
    await page.waitForFunction(() => document.getElementById("femaSec").getAttribute("aria-busy") === "true",
      null, { timeout: 15000 });
    ok(await page.textContent("#femaStatus") === "", "nothing is announced while the section is still busy");
    for (let i = 0; i < 50 && !releaseZone; i++) await page.waitForTimeout(50);
    releaseZone();
    await waitText(page, "#femaStatus", /FEMA classification/, 25000);
    /* enrichment may settle in the same tick as the fixture resolves, so only the final
       settled state is asserted here; the busy-during-enrichment path is covered by the
       "failed enrichment" scenario above */
    await waitText(page, "#femaStatus", /FIRM panel and map-revision details loaded/, 25000);
    ok(await page.getAttribute("#femaSec", "aria-busy") === "false", "and settles to false once fully resolved");
  }, { seed: { "suite.flood.target": TGT } });
}

/* ---------------------------------------------------------------- 24. bounded automatic request
   ceiling, including the GeoJSON→Esri fallback (six, per API-AND-RELAY.md) */
await scenario("the fallback pipeline stays inside the documented six-request ceiling",
  Object.assign({}, F.STANDARD, {
    zone: url => new URL(url).searchParams.get("f") === "geojson"
      ? { error: { code: 400, message: "Invalid or missing input parameters." } }
      : { features: [{ attributes: { DFIRM_ID: "22071C", FLD_ZONE: "AE", SFHA_TF: "T" },
          geometry: { rings: F.squareAround(F.PT.lat, F.PT.lon).coordinates } }] }
  }), async ({ page, reqs }) => {
    await waitText(page, "#femaBox", /Zone AE/, 20000);
    await waitText(page, "#gaugeBox", /Big River/, 20000);
    await waitText(page, "#femaStatus", /FIRM panel and map-revision details loaded/, 20000);
    await page.waitForTimeout(400);
    const auto = reqs.filter(u => F.classify(u) !== "other");
    const byKind = auto.map(F.classify).sort();
    ok(auto.length === 6, "exactly six automatic requests with the fallback: " + JSON.stringify(byKind));
    ok(byKind.filter(k => k === "zone").length === 2, "two of them are the zone primary + single fallback");
    ok(!byKind.includes("avail"), "no availability query when the fallback produced a zone");
  }, { seed: { "suite.flood.target": TGT } });

/* ---------------------------------------------------------------- 14. a11y, live regions, themes, mobile */
await scenario("live regions, disclosure keyboard path, no horizontal overflow (375px), dark theme", F.STANDARD,
  async ({ page }) => {
    await waitText(page, "#femaBox", /Zone AE/);
    await waitText(page, "#gaugeBox", /Big River/);
    const a11y = await page.evaluate(() => ({
      live: ["femaStatus", "alertStatus", "gaugeStatus", "candBox"]
        .map(id => document.getElementById(id)?.getAttribute("aria-live")),
      groupNotLive: !document.getElementById("glance")?.hasAttribute("aria-live"),
      label: !!document.querySelector("label[for='q']"),
      svgRole: document.getElementById("footprint")?.getAttribute("role")
    }));
    ok(a11y.live.every(v => v === "polite"), "polite live regions: " + JSON.stringify(a11y.live));
    ok(a11y.groupNotLive, "the three-tile glance group is not itself a live region");
    ok(a11y.label && a11y.svgRole === "img", "form label + accessible SVG");
    /* keyboard: open the first alert disclosure with Enter */
    await page.focus("#alertBox details:first-child summary");
    await page.keyboard.press("Enter");
    ok(await page.evaluate(() => document.querySelector("#alertBox details").open), "alert disclosure opens from the keyboard");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 1, "no horizontal overflow at 375px (overflow " + overflow + "px)");
    await page.screenshot({ path: join(EV, "built-mobile-dark.png"), fullPage: true });
  }, { viewport: { width: 375, height: 800 }, theme: "dark", seed: { "suite.flood.target": TGT } });

await scenario("desktop screenshots, both themes", F.STANDARD, async ({ page }) => {
  await waitText(page, "#femaBox", /Zone AE/);
  await waitText(page, "#gaugeBox", /Big River/);
  await page.screenshot({ path: join(EV, "built-desktop-light.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(EV, "built-desktop-dark.png"), fullPage: true });
}, { theme: "light", seed: { "suite.flood.target": TGT } });

await browser.close();
writeFileSync(join(EV, "flood-built.txt"), lines.join("\n") + "\n");
console.log("\nflood-built: " + (failures ? failures + " scenario(s) FAILED" : "all scenarios green"));
process.exit(failures ? 1 : 0);
