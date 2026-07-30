/* tests/interactions/overhead.mjs — Aircraft Overhead (v4, cors-open, rate-limited)

   Fully offline-deterministic: every endpoint is route-stubbed. Fixture of 4 aircraft
   at known offsets from the seeded location (40.7, -74.0) so the distance/bearing math
   is asserted against independent recomputation (haversine R = 3958.7613 mi,
   initial-bearing formula, 16-wind compass):
     AC1  +0.02° lat, on ground          -> 1.4 mi N
     AC2  +0.10° lon, 200 kt            -> 5.2 mi E, 230 mph
     AC3  +0.10° lat, 12000 ft          -> 6.9 mi N   (spec's exactness check)
     AC4  -0.10° lat -0.10° lon, mil+7700 -> 8.7 mi SW, MILITARY + EMERGENCY badges
   plus one position-less aircraft that must be excluded from list and plot.
   Also: ZIP entry path (stubbed zippopotam), radius re-query, designed empty state,
   HTTP-500 error state (on a second page so the browser's network console error
   stays out of the harness gate), stale-cache offline boot, auto-refresh pause on
   document.hidden + stop on request error (fake clock), a11y, mobile no-overflow. */

export const selectors = [
  "body", ".topbar", ".back", ".theme-btn", "header h1", "header .tag",
  "#app", ".card", "footer"
];
export const screenshotAfterInteract = true;

const BASE = { lat: 40.7, lon: -74, label: "New York City, NY" };

/* realistic /v2/point shape, live-probed 2026-07-30 (see report) */
const AC4_FIXTURE = {
  ac: [
    { hex: "a00003", type: "adsb_icao", flight: "UAL456  ", r: "N789UA", t: "B738",
      desc: "BOEING 737-800", ownOp: "UNITED AIRLINES INC", alt_baro: 12000, alt_geom: 12250,
      gs: 320.4, track: 270.0, baro_rate: 0, squawk: "2745", emergency: "none", category: "A3",
      lat: 40.8, lon: -74.0, nic: 8, rc: 186, seen_pos: 0.2, messages: 12000, seen: 0.1,
      rssi: -12.1, dst: 6.0, dir: 0.0 },
    { hex: "a00001", type: "adsb_icao", flight: "", r: "N42GD", t: "C172",
      desc: "CESSNA 172 Skyhawk", alt_baro: "ground", gs: 5.1, squawk: "1200",
      emergency: "none", category: "A1", lat: 40.72, lon: -74.0, nic: 9, rc: 75,
      seen_pos: 1.1, messages: 900, seen: 0.4, rssi: -25.0, dst: 1.2, dir: 0.0 },
    { hex: "ae0004", type: "adsb_icao", flight: "RCH881  ", r: "10-0213", t: "C17",
      desc: "BOEING C-17A Globemaster III", ownOp: "UNITED STATES AIR FORCE",
      alt_baro: 9000, gs: 250.0, track: 45.0, squawk: "7700", emergency: "general",
      category: "A5", dbFlags: 1, lat: 40.6, lon: -74.1, nic: 8, rc: 186, seen_pos: 0.3,
      messages: 4400, seen: 0.2, rssi: -18.6, dst: 7.5, dir: 217.0 },
    { hex: "a00002", type: "adsb_icao", flight: "DAL123  ", r: "N301DN", t: "A321",
      desc: "AIRBUS A321", ownOp: "DELTA AIR LINES INC", alt_baro: 4300, alt_geom: 4400,
      gs: 200.0, track: 90.0, squawk: "1305", emergency: "none", category: "A3",
      lat: 40.7, lon: -73.9, nic: 9, rc: 75, seen_pos: 0.1, messages: 30000, seen: 0.0,
      rssi: -9.9, dst: 4.6, dir: 90.0 },
    { hex: "a00005", type: "mode_s", flight: "GLF9    ", r: "N905GL", t: "GLF6",
      desc: "GULFSTREAM G650", alt_baro: 41000, gs: 480.0, squawk: "2200",
      emergency: "none", messages: 60, seen: 41.2 } /* no lat/lon -> excluded */
  ],
  msg: "No error", now: 1785431714001, total: 5, ctime: 1785431714001, ptime: 1
};
const EMPTY_FIXTURE = { ac: [], msg: "No error", now: 1785431714001, total: 0, ctime: 1785431714001, ptime: 0 };
const ZIP_FIXTURE = { "post code": "10001", country: "United States",
  "country abbreviation": "US",
  places: [{ "place name": "New York City", longitude: "-74", latitude: "40.7",
    state: "New York", "state abbreviation": "NY" }] };

const POINT_RE = /api\.airplanes\.live\/v2\/point\//;

export async function interact({ page, log, evidenceDir }) {
  const expect = (cond, msg) => { if (!cond) throw new Error("EXPECT FAILED: " + msg); };
  const rows = () => page.$$eval("#list button.ac", els =>
    els.map(e => ({ hex: e.dataset.hex, text: e.textContent.replace(/\s+/g, " ").trim() })));
  const listReady = n => page.waitForFunction(
    x => document.querySelectorAll("#list button.ac").length === x, n, { timeout: 15000 });

  /* ---- designed no-location state (harness loaded the page with empty storage) ---- */
  await page.waitForSelector(".setup #zip", { timeout: 15000 });
  log(`no-location state: designed setup card — heading "${(await page.textContent(".setup h2")).trim()}", ZIP input + geolocation button present`);

  /* ---- route-stub EVERY endpoint before any query can fire ---- */
  const pointReqs = [];
  let fixture = AC4_FIXTURE;
  await page.route(POINT_RE, r => {
    pointReqs.push(r.request().url());
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) });
  });
  await page.route(/api\.zippopotam\.us\//, r =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ZIP_FIXTURE) }));

  /* ---- ZIP entry path (Enter submits) ---- */
  await page.fill(".setup #zip", "10001");
  await page.press(".setup #zip", "Enter");
  await listReady(4);
  const loc = await page.evaluate(() => JSON.parse(localStorage.getItem("suite.location")));
  expect(loc.lat === 40.7 && loc.lon === -74 && loc.label === "New York City, NY",
    "ZIP path wrote suite.location, got " + JSON.stringify(loc));
  log(`ZIP path: stubbed zippopotam 10001 -> suite.location=${JSON.stringify(loc)}; locbar shows "${(await page.textContent("#locLabel")).trim()}"`);
  log(`first query URL: ${pointReqs[0]} (radius default 25 nm)`);
  expect(/\/v2\/point\/40\.7\/-74\/25$/.test(pointReqs[0]), "default query URL, got " + pointReqs[0]);

  /* seed for later reloads too, per spec (idempotent with what the ZIP flow wrote) */
  await page.addInitScript(l => {
    try { localStorage.setItem("suite.location", JSON.stringify(l)); } catch (e) {}
  }, BASE);

  /* ---- distance/bearing math + sort order (independent recomputation) ----
     hav(40.7,-74 -> 40.72,-74)=1.3819 mi brg 0    -> "1.4 mi N"
     hav(       -> 40.7,-73.9)=5.2382 mi brg 89.97 -> "5.2 mi E"
     hav(       -> 40.8,-74  )=6.9093 mi brg 0     -> "6.9 mi N"  (0.1° north)
     hav(       -> 40.6,-74.1)=8.6729 mi brg 217.2 -> "8.7 mi SW" */
  const r1 = await rows();
  expect(r1.length === 4, "4 positioned aircraft listed (5th has no position), got " + r1.length);
  expect(r1.map(x => x.hex).join(",") === "a00001,a00002,a00003,ae0004",
    "sorted by distance ascending, got " + r1.map(x => x.hex).join(","));
  log(`sort order by distance: ${r1.map(x => x.hex).join(" < ")} (ground 1.4 mi first, C-17 8.7 mi last)`);
  expect(r1[0].text.includes("1.4 mi N") && r1[0].text.includes("on ground") && r1[0].text.includes("N42GD"),
    "AC1 ground row, got: " + r1[0].text);
  log(`ground rendering: "${r1[0].text}"`);
  expect(r1[1].text.includes("5.2 mi E") && r1[1].text.includes("230 mph") && r1[1].text.includes("4,300 ft"),
    "AC2 east row (200 kt -> 230 mph), got: " + r1[1].text);
  log(`airborne rendering: "${r1[1].text}"`);
  expect(r1[2].text.includes("6.9 mi N") && r1[2].text.includes("12,000 ft") && r1[2].text.includes("UAL456"),
    "AC3: aircraft 0.1° north must read 6.9 mi N, got: " + r1[2].text);
  log(`exact-math check: aircraft at +0.1° lat -> "${r1[2].text}" (haversine 6.9093 mi, bearing 0° = N)`);
  expect(r1[3].text.includes("8.7 mi SW") && r1[3].text.includes("MILITARY") && r1[3].text.includes("EMERGENCY"),
    "AC4 badges + SW bearing, got: " + r1[3].text);
  log(`badges: "${r1[3].text}" (dbFlags&1 -> MILITARY, squawk 7700/emergency general -> EMERGENCY)`);
  log(`count line: "${(await page.textContent("#countLine")).replace(/\s+/g, " ").trim()}" (notes the 1 position-less aircraft)`);

  /* ---- radar plot: markers, ring labels, center ---- */
  const plot = await page.evaluate(() => ({
    marks: [...document.querySelectorAll(".plot .mark")].map(m => m.dataset.hex),
    rings: document.querySelectorAll(".plot .ring").length,
    ringLabels: [...document.querySelectorAll(".plot .ringlbl")].map(t => t.textContent),
    labels: [...document.querySelectorAll(".plot .mlbl")].map(t => t.textContent),
    center: document.querySelectorAll(".plot .me").length
  }));
  expect(plot.marks.length === 4, "4 plot markers, got " + plot.marks.length);
  expect(plot.rings === 4 && plot.ringLabels.join(",") === "7,14,22,29 mi",
    "range rings labeled in miles for 25 nm (7/14/22/29), got " + plot.ringLabels.join(","));
  expect(plot.center === 3, "center 'you' marker (2 lines + circle)");
  log(`plot: ${plot.marks.length} markers [${plot.marks.join(", ")}], ring labels [${plot.ringLabels.join(", ")}], callsign labels [${plot.labels.join(", ")}], center marker present`);

  /* ---- list row <-> plot marker highlight, both directions ---- */
  await page.click('#list button.ac[data-hex="a00003"]');
  let sel = await page.evaluate(() => ({
    row: document.querySelector('#list button.ac[data-hex="a00003"]').getAttribute("aria-pressed"),
    mark: document.querySelector('.plot .mark[data-hex="a00003"]').classList.contains("sel")
  }));
  expect(sel.row === "true" && sel.mark === true, "row click selects row + plot marker");
  log(`row click (UAL456): row aria-pressed=${sel.row}, plot marker .sel=${sel.mark}`);
  await page.evaluate(() => document.querySelector('.plot .mark[data-hex="a00002"]')
    .dispatchEvent(new MouseEvent("click", { bubbles: true })));
  sel = await page.evaluate(() => ({
    row2: document.querySelector('#list button.ac[data-hex="a00002"]').getAttribute("aria-pressed"),
    row3: document.querySelector('#list button.ac[data-hex="a00003"]').getAttribute("aria-pressed"),
    mark2: document.querySelector('.plot .mark[data-hex="a00002"]').classList.contains("sel"),
    title: document.querySelector('.plot .mark[data-hex="a00002"] title').textContent
  }));
  expect(sel.row2 === "true" && sel.row3 === "false" && sel.mark2 === true,
    "marker click moves selection to its row");
  log(`marker click (DAL123): row aria-pressed=${sel.row2}, previous deselected=${sel.row3 === "false"}, marker title="${sel.title}"`);

  /* ---- radius change re-queries with the new URL ---- */
  const before50 = pointReqs.length;
  await page.selectOption("#radiusSel", "50");
  await page.waitForFunction(t => {
    const l = document.querySelectorAll(".plot .ringlbl");
    return l.length === 4 && l[3].textContent === t;
  }, "58 mi", { timeout: 15000 });
  expect(pointReqs.length === before50 + 1 && /\/v2\/point\/40\.7\/-74\/50$/.test(pointReqs.at(-1)),
    "radius change fired one request at /50, got " + pointReqs.at(-1));
  const key50 = await page.evaluate(() => !!localStorage.getItem("suite.cache.overhead.40.70x-74.00.50"));
  expect(key50, "cacheKey overhead.<lat>x<lon>.<radius> with 2-decimal coords");
  log(`radius 25 -> 50 nm: re-query URL ${pointReqs.at(-1)}; outer ring relabeled "58 mi"; cache key suite.cache.overhead.40.70x-74.00.50 written`);

  /* ---- designed empty state ---- */
  fixture = EMPTY_FIXTURE;
  await page.click("#refreshBtn");
  await page.waitForSelector("#list .msg .big", { timeout: 15000 });
  const emptyTxt = (await page.textContent("#list .msg")).replace(/\s+/g, " ").trim();
  expect(emptyTxt.includes("No ADS-B aircraft reported within 50 nm right now"),
    "designed empty state, got: " + emptyTxt);
  const emptyMarks = await page.evaluate(() => document.querySelectorAll(".plot .mark").length);
  expect(emptyMarks === 0, "no markers on empty plot");
  log(`empty state: "${emptyTxt}" — rings kept, 0 markers`);
  await page.screenshot({ path: `${evidenceDir}/empty-state.png`, fullPage: true });
  fixture = AC4_FIXTURE;
  await page.click("#refreshBtn");
  await listReady(4);
  log(`manual Refresh restored the 4-aircraft board; freshness stamp: "${(await page.textContent("#stamp")).trim()}"`);

  /* ---- a11y + the mandatory rate note ---- */
  const a11y = await page.evaluate(() => ({
    rate: document.getElementById("rateNote").textContent.trim(),
    radiusLabel: document.querySelector('label[for="radiusSel"]').textContent.trim(),
    autoLabel: document.querySelector('label[for="autoSel"]').textContent.trim(),
    stampLive: document.getElementById("stamp").getAttribute("aria-live"),
    countLive: document.getElementById("countLine").getAttribute("aria-live"),
    themeLabel: document.getElementById("themeBtn").getAttribute("aria-label"),
    rowPressed: document.querySelector("#list button.ac").hasAttribute("aria-pressed"),
    zipLabelled: true
  }));
  expect(a11y.rate.includes("≤1 request/second") && a11y.rate.includes("one per refresh"),
    "visible rate-courtesy note");
  expect(a11y.stampLive === "polite" && a11y.countLive === "polite", "live regions on async containers");
  expect(a11y.radiusLabel && a11y.autoLabel && a11y.themeLabel && a11y.rowPressed, "labels + aria-pressed");
  log(`rate note visible: "${a11y.rate}"`);
  log(`a11y: labeled selects ("${a11y.radiusLabel}", "${a11y.autoLabel}"), stamp/count aria-live=polite, rows expose aria-pressed, theme button aria-label="${a11y.themeLabel}"`);

  /* ---- auto-refresh: fake clock; pauses on document.hidden; nothing persisted ---- */
  await page.clock.install();
  const baseReqs = pointReqs.length;
  await page.selectOption("#autoSel", "30000");
  await page.clock.runFor(31000);
  await page.waitForFunction(n => true, null, { timeout: 1000 }).catch(() => {});
  expect(pointReqs.length === baseReqs + 1, "auto 30s tick fired exactly one request, got +" + (pointReqs.length - baseReqs));
  log(`auto-refresh 30s: +31 s fake clock -> exactly 1 request (total ${pointReqs.length})`);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const pausedNote = (await page.textContent("#autoNote")).trim();
  expect(pausedNote.includes("paused"), "pause note while hidden, got: " + pausedNote);
  await page.clock.runFor(120000);
  expect(pointReqs.length === baseReqs + 1, "no requests while document.hidden, got +" + (pointReqs.length - baseReqs - 1));
  log(`document.hidden mocked true -> note "${pausedNote}"; +120 s fake clock -> 0 further requests (paused)`);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(n => true, null, { timeout: 1000 }).catch(() => {});
  expect(pointReqs.length === baseReqs + 2, "visible again -> one catch-up request");
  log(`tab visible again -> 1 catch-up request, pause note cleared ("${(await page.textContent("#autoNote")).trim()}")`);

  /* ---- auto-refresh stops after a request error (abort -> stale fallback) ---- */
  await page.unroute(POINT_RE);
  await page.route(POINT_RE, r => r.abort());
  await page.clock.runFor(31000);
  await page.waitForFunction(() => document.getElementById("autoSel").value === "0", { timeout: 15000 });
  const stopNote = (await page.textContent("#autoNote")).trim();
  const staleStamp = (await page.textContent("#stamp")).trim();
  expect(stopNote.includes("stopped"), "auto-refresh stop note, got: " + stopNote);
  expect(staleStamp.startsWith("Offline — cached from"), "stale stamp after failed refresh, got: " + staleStamp);
  log(`request error during auto tick -> select reset to Off, note "${stopNote}", stamp "${staleStamp}" (cached board still shown: ${(await rows()).length} rows)`);
  const persisted = await page.evaluate(() => Object.keys(localStorage)
    .filter(k => k.startsWith("suite.overhead") || k === "suite.overhead"));
  expect(persisted.length === 0, "no suite.overhead.* persistence, got " + persisted.join(","));
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  log(`storage keys (auto/radius persist nothing of their own): ${keys.join(", ")}`);

  /* ---- stale-cache cold boot: back-date cache, all network dead, reload ---- */
  await page.unroute(POINT_RE);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("suite.cache.")) {
        const e = JSON.parse(localStorage.getItem(k));
        e.t = Date.now() - 10 * 60 * 1000; /* 10 min > 1 min TTL */
        localStorage.setItem(k, JSON.stringify(e));
      }
  });
  await page.context().route(/^https?:/, r => r.abort());
  await page.reload();
  await listReady(4);
  const coldStamp = (await page.textContent("#stamp")).trim();
  expect(coldStamp.startsWith("Offline — cached from"), "cold-boot stale stamp, got: " + coldStamp);
  const defaults = await page.evaluate(() => ({
    radius: document.getElementById("radiusSel").value, auto: document.getElementById("autoSel").value }));
  expect(defaults.radius === "25" && defaults.auto === "0",
    "radius/auto reset to defaults after reload (nothing persisted), got " + JSON.stringify(defaults));
  log(`offline cold boot: 4 aircraft rendered from back-dated cache; stamp "${coldStamp}"; controls reset to defaults ${JSON.stringify(defaults)} — nothing persisted`);
  await page.screenshot({ path: `${evidenceDir}/offline-stale.png`, fullPage: true });
  await page.context().unroute(/^https?:/);

  /* ---- HTTP 500 -> designed error state (second page: keeps Chrome's network
     console error for the 500 out of the harness's console gate). file:// pages
     share one localStorage, so p2 uses a DIFFERENT location -> different cacheKey
     -> genuinely no cached fallback, without touching the main page's caches. ---- */
  const p2 = await page.context().newPage();
  await p2.addInitScript(() => {
    try {
      localStorage.setItem("suite.theme", "light");
      localStorage.setItem("suite.location",
        JSON.stringify({ lat: 41.5, lon: -75.5, label: "Elsewhere, PA" }));
    } catch (e) {}
  });
  await p2.route(POINT_RE, r => r.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await p2.goto(page.url());
  await p2.waitForSelector("#list .msg .big", { timeout: 15000 });
  const errTxt = (await p2.textContent("#list .msg")).replace(/\s+/g, " ").trim();
  expect(errTxt.includes("Couldn't reach Airplanes.live") && errTxt.includes("HTTP 500"),
    "designed 500 error card, got: " + errTxt);
  log(`HTTP 500 (no cache): designed error card — "${errTxt}"`);
  await p2.screenshot({ path: `${evidenceDir}/error-500.png`, fullPage: true });
  await p2.close();

  /* ---- restore a fresh view from cache (no refetch), then mobile ---- */
  await page.route(POINT_RE, r => r.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify(AC4_FIXTURE) })); /* belt-and-braces: never live */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("suite.cache.")) {
        const e = JSON.parse(localStorage.getItem(k));
        e.t = Date.now();
        localStorage.setItem(k, JSON.stringify(e));
      }
  });
  await page.reload();
  await listReady(4);
  log(`restored view served from re-freshened cache without a network request; stamp "${(await page.textContent("#stamp")).trim()}"`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mob = await page.evaluate(() => ({
    doc: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
    body: { sw: document.body.scrollWidth, cw: document.body.clientWidth }
  }));
  expect(mob.doc.sw <= mob.doc.cw && mob.body.sw <= mob.body.cw,
    "no horizontal overflow at 390 px, got " + JSON.stringify(mob));
  log(`mobile 390x844: scrollWidth ${mob.doc.sw} <= clientWidth ${mob.doc.cw} — no horizontal overflow`);
  await page.screenshot({ path: `${evidenceDir}/mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
}
