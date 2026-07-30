/* tests/interactions/discussion.mjs — Forecast Discussion Reader (v4, cors-open)
   Fully offline-deterministic: every api.weather.gov and api.zippopotam.us request is
   route-fulfilled with fixtures copied from the real response shapes (points → cwa,
   /products/types/AFD/locations/{cwa} → @graph, /products/{id} → productText).
   Covers: section splitting + open/closed defaults, paragraph unwrapping vs the
   preformatted temps/PoPs table, office + relative issuance time, the earlier-
   discussions select, the ZIP path, the designed 500 and 429 error cards (in a
   separate context — a fulfilled 5xx on the harness page would log a non-net::ERR
   console error and trip the console-clean gate), the stale-cache offline path,
   cache keys, a11y bits, and 390-px no-overflow. */

export const selectors = [
  "body", ".topbar", ".back", ".theme-btn", "header h1", "header .tag",
  "#metaCard", "#officeChip", "#prodSel", "#state", "#afd", "footer"
];

export const screenshotAfterInteract = true;

function expect(cond, msg){ if (!cond) throw new Error("EXPECT FAILED: " + msg); }

const LOC = { lat: 40.7128, lon: -74.006, label: "New York, NY" };
const NOW = Date.now();
const HOUR = 3600 * 1000;
const iso = t => new Date(t).toISOString().replace(/\.\d{3}Z$/, "+00:00");

/* six list entries prove the "last 5" cap; ids are realistic product UUIDs */
const IDS = [0, 1, 2, 3, 4, 5].map(i => `4f6a8f3e-8e0f-4c9d-9a01-00000000000${i + 1}`);
const TIMES = [NOW - 2 * HOUR, NOW - 8 * HOUR, NOW - 14 * HOUR, NOW - 20 * HOUR, NOW - 26 * HOUR, NOW - 32 * HOUR];

const POINTS = {
  properties: {
    "@id": `https://api.weather.gov/points/${LOC.lat},${LOC.lon}`,
    cwa: "OKX", gridId: "OKX", gridX: 33, gridY: 35,
    forecastOffice: "https://api.weather.gov/offices/OKX",
    relativeLocation: {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-74.0, 40.71] },
      properties: { city: "New York", state: "NY" }
    }
  }
};

const LIST = {
  "@context": { "@vocab": "https://api.weather.gov/ontology#" },
  "@graph": IDS.map((id, i) => ({
    "@id": `https://api.weather.gov/products/${id}`,
    id,
    wmoCollectiveId: "FXUS61",
    issuingOffice: "KOKX",
    issuanceTime: iso(TIMES[i]),
    productCode: "AFD",
    productName: "Area Forecast Discussion"
  }))
};

const AFD1 = `000
FXUS61 KOKX 301142
AFDOKX

Area Forecast Discussion
National Weather Service New York NY
742 AM EDT Wed Jul 30 2026

.SYNOPSIS...
High pressure gradually builds
across the region through Thursday while a warm front lifts north
of the area tonight.

A cold front approaches from the Great Lakes on Friday and crosses
the area Friday night, followed by drier air for the weekend.

&&

.NEAR TERM /THROUGH TONIGHT/...
Mostly sunny and seasonably warm today as the ridge noses in from
the west. Dewpoints hold in the lower 60s with light southwest
flow.

Tonight, clouds increase after midnight as the warm front lifts
north. Patchy fog is possible toward dawn in the usual interior
valleys.

&&

.SHORT TERM /6 AM THURSDAY THROUGH 6 PM THURSDAY/...
Warm and more humid Thursday with heights building aloft. A stray
afternoon shower over the interior cannot be ruled out.

&&

.LONG TERM /THURSDAY NIGHT THROUGH TUESDAY/...
The pattern amplifies into the weekend as the front clears the
waters, with Canadian high pressure returning Sunday into Monday.

&&

.AVIATION /12Z WEDNESDAY THROUGH SUNDAY/...
VFR through tonight. MVFR possible in fog toward 09Z at interior
terminals.

&&

.MARINE...
Sub-SCA conditions on all waters through Thursday night.

&&

.PRELIMINARY POINT TEMPS/POPS...
NYC       84  71  88  73 /  10  10  20  30
LGA       85  73  89  74 /  10  10  20  30
JFK       82  72  86  73 /  10  10  20  30

&&

.OKX WATCHES/WARNINGS/ADVISORIES...
NY...None.
NJ...None.
CT...None.

&&

$$

SYNOPSIS...STAFF
NEAR TERM...DS
`;

const AFD2 = `000
FXUS61 KOKX 300542
AFDOKX

Area Forecast Discussion
National Weather Service New York NY
142 AM EDT Wed Jul 30 2026

.SYNOPSIS...
Weak troughing lingers offshore
early today before high pressure builds in from the west tonight.

&&

.NEAR TERM /THROUGH TONIGHT/...
Patchy overnight fog burns off by mid morning, then mostly sunny.

&&

.PRELIMINARY POINT TEMPS/POPS...
NYC       83  70  87  72 /  10  10  20  30

&&

$$
`;

const product = (i, text) => ({
  "@context": { "@vocab": "https://api.weather.gov/ontology#" },
  "@id": `https://api.weather.gov/products/${IDS[i]}`,
  id: IDS[i],
  wmoCollectiveId: "FXUS61",
  issuingOffice: "KOKX",
  issuanceTime: iso(TIMES[i]),
  productCode: "AFD",
  productName: "Area Forecast Discussion",
  productText: text
});
const PRODUCTS = { [IDS[0]]: product(0, AFD1), [IDS[1]]: product(1, AFD2) };

const ZIPPO = {
  "post code": "10001", country: "United States", "country abbreviation": "US",
  places: [{ "place name": "New York", longitude: "-74.0060",
             state: "New York", "state abbreviation": "NY", latitude: "40.7128" }]
};

const CORS = { "access-control-allow-origin": "*" };
const json = (r, body, status = 200) =>
  r.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });

const href = u => (typeof u === "string" ? u : u.href);
const isPoints = u => href(u).includes("api.weather.gov/points/");
const isList = u => href(u).includes("/products/types/AFD/locations/");
const isProd = u => href(u).includes("api.weather.gov/products/") && !href(u).includes("/types/");
const isZip = u => href(u).includes("api.zippopotam.us");

const rendered = page => page.waitForFunction(() =>
  document.querySelectorAll("#afd details").length >= 4 &&
  document.getElementById("stamp").textContent.trim().length > 0, { timeout: 25000 });

export async function interact({ page, log, evidenceDir }) {
  /* ---- 0. designed initial (no-location) state, then route-stub EVERYTHING ---- */
  await page.waitForSelector("#state .nl h2");
  log(`no-location boot: designed card "${(await page.textContent("#state .nl h2")).trim()}" with ZIP form (label: "${(await page.textContent('#state label[for="zip"]')).trim()}")`);
  await page.route(isPoints, r => json(r, POINTS));
  await page.route(isList, r => json(r, LIST));
  await page.route(isProd, r => {
    const id = href(r.request().url()).split("/").pop();
    return PRODUCTS[id] ? json(r, PRODUCTS[id]) : json(r, { detail: "Not Found" }, 404);
  });
  await page.route(isZip, r => json(r, ZIPPO));

  /* ---- 1. seed suite.location → full points→office→list→product chain ---- */
  await page.evaluate(l => localStorage.setItem("suite.location", JSON.stringify(l)), LOC);
  await page.reload();
  await rendered(page);
  log(`office chip: "${(await page.textContent("#officeChip")).trim()}" (from points properties.cwa)`);
  const oLine = (await page.textContent("#officeLine")).trim();
  expect(oLine.includes("National Weather Service New York NY") && oLine.includes("New York, NY"),
    "office line shows product office name + relativeLocation label: " + oLine);
  log(`office line: "${oLine}"`);
  const issued = (await page.textContent("#issuedLine")).trim();
  expect(/^Issued 2 h ago · /.test(issued), "relative + absolute issuance time: " + issued);
  log(`issuance: "${issued}" (fixture issued exactly 2 h before the run)`);
  log(`freshness stamp: "${(await page.textContent("#stamp")).trim()}"`);

  /* ---- 2. section splitting, open/closed defaults, unwrap vs preformatted ---- */
  const secs = await page.evaluate(() =>
    [...document.querySelectorAll("#afd details")].map(d => ({
      title: d.querySelector(".sec-name").textContent,
      time: (d.querySelector(".sec-time") || {}).textContent || "",
      open: d.open,
      pre: !!d.querySelector("pre"),
      paras: d.querySelectorAll("p").length
    })));
  expect(secs.length === 8, "8 sections parsed, got " + secs.length);
  log(`sections (${secs.length}): ${secs.map(s => `${s.title}${s.open ? " [open]" : ""}`).join(" · ")}`);
  expect(secs[0].title === "SYNOPSIS" && secs[0].open, "SYNOPSIS open by default");
  expect(secs[1].title === "NEAR TERM" && secs[1].open && secs[1].time === "THROUGH TONIGHT",
    "first forecast section open, timeframe split out: " + JSON.stringify(secs[1]));
  expect(secs.slice(2).every(s => !s.open), "all later sections closed by default");
  log(`open/closed defaults: SYNOPSIS + NEAR TERM (timeframe "THROUGH TONIGHT") open, ${secs.filter(s => !s.open).length} closed`);

  const synP = await page.textContent("#afd details:nth-of-type(1) .sec-body p");
  expect(synP.includes("High pressure gradually builds across the region through Thursday while a warm front lifts north of the area tonight."),
    "hard-wrapped synopsis lines unwrapped into one flowing paragraph: " + synP);
  expect(secs[0].paras === 2, "blank lines preserved as paragraph breaks (SYNOPSIS has 2 <p>)");
  log(`unwrapping: 3 hard-wrapped fixture lines render as one paragraph ("${synP.slice(0, 72)}…"); SYNOPSIS keeps its 2 paragraphs`);

  const tempsIdx = secs.findIndex(s => s.title.includes("TEMPS/POPS"));
  expect(tempsIdx >= 0 && secs[tempsIdx].pre && secs[tempsIdx].paras === 0, "temps/PoPs section is preformatted");
  const preTxt = await page.textContent("#afd pre");
  expect(/NYC {2,}84 {2}71 {2}88 {2}73 \/ {2}10/.test(preTxt), "column spacing preserved in <pre>: " + JSON.stringify(preTxt.split("\n")[0]));
  expect(preTxt.split("\n").length === 3, "3 table rows kept on their own lines");
  log(`temps/PoPs table: <pre> with 3 rows, columns intact ("${preTxt.split("\n")[0]}")`);
  expect(!(await page.textContent("#afd")).includes("&&"), "&& separators stripped from the rendered text");
  log(`"&&" separators and the $$ signature block are stripped from the rendered discussion`);

  /* ---- 3. earlier discussions: 5-entry select loads a second fixture ---- */
  const opts = await page.evaluate(() => [...document.querySelectorAll("#prodSel option")].map(o => o.textContent));
  expect(opts.length === 5, "select capped at the last 5 products (fixture offered 6), got " + opts.length);
  expect(/· latest$/.test(opts[0]), "newest option flagged latest: " + opts[0]);
  log(`earlier-discussions select: ${opts.length} options (fixture list had 6) — [${opts.join(" | ")}]`);
  await page.selectOption("#prodSel", IDS[1]);
  await page.waitForFunction(() => document.getElementById("afd").textContent.includes("Weak troughing lingers offshore"), { timeout: 25000 });
  const issued2 = (await page.textContent("#issuedLine")).trim();
  expect(/^Issued 8 h ago · /.test(issued2), "earlier product issuance shown: " + issued2);
  log(`selected the 8-h-old discussion → second fixture rendered ("Weak troughing lingers offshore…"), issuance now "${issued2}"`);

  /* ---- 4. cache keys ---- */
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("suite.cache.discussion.")).sort());
  expect(keys.includes("suite.cache.discussion.point.40.713x-74.006"), "point cache key present");
  expect(keys.includes("suite.cache.discussion.list.OKX"), "list cache key present");
  expect(keys.includes("suite.cache.discussion.prod." + IDS[0]) && keys.includes("suite.cache.discussion.prod." + IDS[1]),
    "both viewed products cached");
  log(`cache keys: ${keys.join(", ")}`);

  /* ---- 5. a11y: labels, live regions, toggles ---- */
  const a11y = await page.evaluate(() => ({
    stateLive: document.getElementById("state").getAttribute("aria-live"),
    afdLive: document.getElementById("afd").getAttribute("aria-live"),
    stampLive: document.getElementById("stamp").getAttribute("aria-live"),
    selLabel: (document.querySelector('label[for="prodSel"]') || {}).textContent || null,
    themePressed: document.getElementById("themeBtn").getAttribute("aria-pressed"),
    changeExpanded: document.getElementById("changeBtn").getAttribute("aria-expanded")
  }));
  expect(a11y.stateLive === "polite" && a11y.afdLive === "polite" && a11y.stampLive === "polite", "async containers are live regions");
  expect(a11y.selLabel === "Earlier discussions", "select has a visible label");
  log(`a11y: aria-live=polite on #state/#afd/#stamp; select labeled "${a11y.selLabel}"; themeBtn aria-pressed=${a11y.themePressed}; changeBtn aria-expanded=${a11y.changeExpanded}`);
  await page.click("#changeBtn");
  expect(await page.getAttribute("#changeBtn", "aria-expanded") === "true" && !!(await page.$("#state .nl")),
    "change-location discloses the ZIP card");
  await page.click("#changeBtn");
  expect(await page.getAttribute("#changeBtn", "aria-expanded") === "false", "and collapses it again");
  log(`change-location button toggles the ZIP card with aria-expanded true→false`);

  /* ---- 6. ZIP fallback path with stubbed zippopotam ---- */
  await page.evaluate(() => localStorage.removeItem("suite.location"));
  await page.reload();
  await page.waitForSelector("#state .nl h2");
  await page.fill("#zip", "10001");
  await page.press("#zip", "Enter");
  await rendered(page);
  const savedLoc = await page.evaluate(() => JSON.parse(localStorage.getItem("suite.location")));
  expect(savedLoc.lat === 40.7128 && savedLoc.lon === -74.006 && savedLoc.label === "New York, NY",
    "zippopotam result written via Suite.location.set: " + JSON.stringify(savedLoc));
  log(`ZIP path: entered 10001 (Enter submits) → stubbed zippopotam → suite.location=${JSON.stringify(savedLoc)} → discussion loaded`);

  /* ---- 7. error paths in a fresh context (fulfilled 5xx would trip the harness console gate) ---- */
  {
    const ctx2 = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.addInitScript(l => localStorage.setItem("suite.location", JSON.stringify(l)), LOC);
    const wg = u => href(u).includes("api.weather.gov");
    await p2.route(wg, r => json(r, { detail: "internal server error" }, 500));
    await p2.goto(page.url());
    await p2.waitForSelector("#state .err h2", { timeout: 25000 });
    const h500 = (await p2.textContent("#state .err h2")).trim();
    const d500 = (await p2.textContent("#state .err .detail")).trim();
    expect(h500 === "Couldn't reach the forecast office" && d500.includes("HTTP 500"),
      `points 500 → designed error card ("${h500}" / "${d500}")`);
    expect(!!(await p2.$("#retryBtn")), "error card offers a retry button");
    expect(await p2.evaluate(() => document.getElementById("metaCard").hidden),
      "placeholder meta card hidden on cold failure");
    log(`error path: points route fulfilled HTTP 500 (no cache) → designed card "${h500}", detail "${d500}", retry button present`);
    await p2.screenshot({ path: `${evidenceDir}/error-500.png`, fullPage: true });
    await p2.unroute(wg);
    await p2.route(wg, r => json(r, { detail: "too many requests" }, 429));
    await p2.reload();
    await p2.waitForSelector("#state .err h2", { timeout: 25000 });
    const h429 = (await p2.textContent("#state .err h2")).trim();
    expect(h429 === "Rate-limited by the weather service", "429 gets its own designed state: " + h429);
    log(`rate-limit path: HTTP 429 → distinct card "${h429}" (detail "${(await p2.textContent("#state .err .detail")).trim()}")`);
    await p2.screenshot({ path: `${evidenceDir}/error-429.png`, fullPage: true });
    await ctx2.close();
  }

  /* ---- 8. stale-cache offline path: back-date past every TTL, block the network ---- */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("suite.cache.")) {
        const e = JSON.parse(localStorage.getItem(k));
        e.t = Date.now() - 8 * 24 * 60 * 60 * 1000;   // 8 d > the 7 d point TTL
        localStorage.setItem(k, JSON.stringify(e));
      }
  });
  for (const p of [isPoints, isList, isProd, isZip]) await page.unroute(p);
  await page.context().route(/^https?:/, r => r.abort());
  await page.reload();
  await rendered(page);
  const stamp = await page.evaluate(() => ({
    text: document.getElementById("stamp").textContent.trim(),
    cls: document.getElementById("stamp").className,
    sections: document.querySelectorAll("#afd details").length,
    options: document.querySelectorAll("#prodSel option").length
  }));
  expect(/^Offline — cached from /.test(stamp.text) && stamp.cls.includes("stale"),
    "visible stale stamp: " + JSON.stringify(stamp));
  expect(stamp.sections === 8 && stamp.options === 5, "full discussion + select still render from stale cache");
  log(`stale path: caches back-dated 8 d, all http(s) aborted → renders from cache with stamp "${stamp.text}" (${stamp.sections} sections, ${stamp.options} options)`);
  await page.screenshot({ path: `${evidenceDir}/offline-stale.png`, fullPage: true });
  await page.context().unroute(/^https?:/);

  /* ---- 9. restore fresh-cache view (no refetch), then the 390-px check ---- */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("suite.cache.")) {
        const e = JSON.parse(localStorage.getItem(k));
        e.t = Date.now();
        localStorage.setItem(k, JSON.stringify(e));
      }
  });
  await page.reload();
  await rendered(page);
  log(`restored (fresh cache, served without refetch): stamp "${(await page.textContent("#stamp")).trim()}"`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const ov = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    preScrollable: (() => { const p = document.querySelector("#afd pre"); return p ? p.scrollWidth >= p.clientWidth : null; })()
  }));
  expect(ov.sw <= ov.cw, `no horizontal overflow at 390 px (scrollWidth ${ov.sw} vs clientWidth ${ov.cw})`);
  log(`mobile 390×844: page scrollWidth ${ov.sw} <= clientWidth ${ov.cw} (unwrapped paragraphs reflow; the temps table scrolls inside its own <pre>)`);
  await page.screenshot({ path: `${evidenceDir}/mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
}
