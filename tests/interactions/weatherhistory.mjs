/* tests/interactions/weatherhistory.mjs — Weather Time Machine (v4, cors-open)

   Fully offline-deterministic: page.clock fixed to 2026-07-30 (so the ERA5-lag max
   date is exactly 2026-07-25), and BOTH manifest hosts route-fulfilled with
   deterministic fixtures before anything loads. Exercised end to end:
   - boot on the seeded suite.location, default date = max date, unit params in URLs
   - chosen-day card values against the day fixture (temps, precip, snow, wind,
     WMO code text, sunrise/sunset)
   - 10-year context: ONE request spanning D−10y…D (~3,653 rows) filtered
     client-side to the same month-day -> exactly 11 SVG bars, chosen year
     highlighted, warmest/coldest/wettest sentences match the fixture years
   - place search (geocoding stub) -> picked place drives the archive URLs while
     suite.location stays untouched; "use my saved location" returns via cache
   - date-bounds validation (1940 floor, 5-day ERA5 lag ceiling) with no fetches
   - error path (routes aborted — a fulfilled 500 would log a non-net::ERR console
     error the harness hard-fails on, so the network-failure branch is exercised
     with abort; see report) and the stale-cache offline path with visible stamps
   - cache keys weatherhistory.day/ctx.<lat>x<lon>.<date>, a11y bits, mobile 390px */

export const selectors = [
  "body", ".topbar", ".back", ".theme-btn", "header h1", "header .tag",
  ".card", "#placeName", "#q", "#dateIn", "#dayCard", "#ctxCard", "footer"
];

export const screenshotAfterInteract = true;

/* ---- deterministic fixtures (real archive-api/geocoding-api response shapes,
   captured via live probe 2026-07-30) ---- */
const YEAR_HIGH = {
  2001: 80.0, 2009: 82.1, 2010: 91.3, 2011: 88.0, 2012: 86.2, 2013: 84.5,
  2014: 76.4, 2015: 85.0, 2016: 87.7, 2017: 83.9, 2018: 89.9, 2019: 86.5,
  2020: 83.0, 2021: 87.0, 2022: 88.5, 2023: 84.0, 2024: 90.1, 2025: 79.2, 2026: 86.5
};
const YEAR_PR = { 2013: 1.42, 2016: 0.31 };

function* isoRange(startISO, endISO) {
  const p = s => s.split("-").map(Number);
  const [y1, m1, d1] = p(startISO), [y2, m2, d2] = p(endISO);
  const end = Date.UTC(y2, m2 - 1, d2);
  for (let t = Date.UTC(y1, m1 - 1, d1); t <= end; t += 86400000)
    yield new Date(t).toISOString().slice(0, 10);
}

function dayFixture(p) {
  const d = p.get("start_date");
  return {
    latitude: +p.get("latitude"), longitude: +p.get("longitude"),
    generationtime_ms: 1.0, utc_offset_seconds: -14400, timezone: "America/New_York",
    timezone_abbreviation: "GMT-4", elevation: 51.0,
    daily_units: { time: "iso8601", weather_code: "wmo code", temperature_2m_max: "°F",
      temperature_2m_min: "°F", precipitation_sum: "inch", snowfall_sum: "inch",
      wind_speed_10m_max: "mp/h", sunrise: "iso8601", sunset: "iso8601" },
    daily: { time: [d], weather_code: [3], temperature_2m_max: [86.5],
      temperature_2m_min: [65.9], precipitation_sum: [0.12], snowfall_sum: [0.0],
      wind_speed_10m_max: [8.7], sunrise: [d + "T05:37"], sunset: [d + "T20:26"] }
  };
}

function ctxFixture(p) {
  const start = p.get("start_date"), end = p.get("end_date");
  const mmdd = end.slice(5);
  const time = [], hi = [], lo = [], pr = [];
  for (const d of isoRange(start, end)) {
    time.push(d);
    if (d.slice(5) === mmdd) {
      const y = +d.slice(0, 4);
      hi.push(YEAR_HIGH[y] ?? 75.0);
      lo.push((YEAR_HIGH[y] ?? 75.0) - 15);
      pr.push(YEAR_PR[y] ?? 0.0);
    } else { hi.push(75.0); lo.push(60.0); pr.push(0.0); }
  }
  return {
    latitude: +p.get("latitude"), longitude: +p.get("longitude"),
    generationtime_ms: 9.8, utc_offset_seconds: -14400, timezone: "America/New_York",
    timezone_abbreviation: "GMT-4", elevation: 51.0,
    daily_units: { time: "iso8601", temperature_2m_max: "°F", temperature_2m_min: "°F",
      precipitation_sum: "inch" },
    daily: { time, temperature_2m_max: hi, temperature_2m_min: lo, precipitation_sum: pr }
  };
}

const GEO_RESULTS = {
  results: [
    { id: 2267057, name: "Lisbon", latitude: 38.72509, longitude: -9.1498, elevation: 68.0,
      feature_code: "PPLC", country_code: "PT", timezone: "Europe/Lisbon", population: 517802,
      country: "Portugal", admin1: "Lisbon District" },
    { id: 5160951, name: "Lisbon", latitude: 40.772, longitude: -80.76813, elevation: 294.0,
      feature_code: "PPLA2", country_code: "US", timezone: "America/New_York", population: 2727,
      country: "United States", admin1: "Ohio" }
  ],
  generationtime_ms: 0.7
};

const norm = s => String(s).replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
function expect(cond, msg) { if (!cond) throw new Error("EXPECTATION FAILED: " + msg); }

export async function interact({ page, log, evidenceDir }) {
  /* ---- fixed clock FIRST (setFixedTime keeps timers real — fetch retries/aborts
     still work), then deterministic routes for every endpoint, then reload ---- */
  await page.clock.setFixedTime(new Date(2026, 6, 30, 12, 0, 0));

  const archiveCalls = [], geoCalls = [];
  const isHttp = /^https?:/;
  const isArchive = u => u.href.startsWith("https://archive-api.open-meteo.com/");
  const isGeo = u => u.href.startsWith("https://geocoding-api.open-meteo.com/");
  await page.route(isHttp, r => r.abort());          // catch-all: nothing else may leave
  await page.route(isArchive, r => {                 // later registrations take precedence
    const u = new URL(r.request().url());
    archiveCalls.push(u.search);
    const p = u.searchParams;
    const body = p.get("start_date") === p.get("end_date") ? dayFixture(p) : ctxFixture(p);
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route(isGeo, r => {
    const u = new URL(r.request().url());
    geoCalls.push(u.search);
    const body = (u.searchParams.get("name") || "").toLowerCase() === "lisbon"
      ? GEO_RESULTS : { generationtime_ms: 0.5 };
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.evaluate(() => localStorage.setItem("suite.location",
    JSON.stringify({ lat: 40.7889, lon: -73.9669, label: "Test Ridge, NY" })));
  await page.reload();
  await page.waitForSelector("#dayCard .stats", { timeout: 15000 });

  /* ---- boot: saved location + ERA5-lag date bounds ---- */
  const dv = await page.inputValue("#dateIn");
  const dmin = await page.getAttribute("#dateIn", "min");
  const dmax = await page.getAttribute("#dateIn", "max");
  expect(dmin === "1940-01-01", `date min is ${dmin}, wanted 1940-01-01`);
  expect(dmax === "2026-07-25", `date max is ${dmax}, wanted 2026-07-25 (fixed today 2026-07-30 − 5-day ERA5 lag)`);
  expect(dv === "2026-07-25", `default date is ${dv}, wanted the max date`);
  log(`boot: date bounds min=${dmin} max=${dmax} (fixed clock 2026-07-30 − 5-day ERA5 lag), default=${dv}`);
  log(`boot: place "${await page.textContent("#placeName")}" chip="${await page.textContent("#placeChip")}"`);
  const bootDay = archiveCalls.find(q => q.includes("start_date=2026-07-25&end_date=2026-07-25"));
  expect(bootDay, "boot fired a single-day archive request for the default date");

  /* ---- chosen date 2019-07-15: day card values + unit params in the URLs ---- */
  await page.fill("#dateIn", "2019-07-15");
  await page.waitForFunction(() => {
    const t = document.querySelector("#dayCard .daytitle");
    return t && t.textContent.includes("July 15, 2019");
  }, undefined, { timeout: 15000 });
  await page.waitForSelector("#ctxChart rect.bar", { timeout: 15000 });

  const dayQ = archiveCalls.find(q => q.includes("start_date=2019-07-15&end_date=2019-07-15"));
  expect(dayQ, "day request for 2019-07-15 was made");
  for (const param of ["temperature_unit=fahrenheit", "precipitation_unit=inch",
    "wind_speed_unit=mph", "timezone=auto", "latitude=40.7889", "longitude=-73.9669"])
    expect(dayQ.includes(param), `day URL carries ${param} — got ${dayQ}`);
  log(`day URL params verified: ${dayQ}`);
  const ctxQ = archiveCalls.find(q => q.includes("start_date=2009-07-15&end_date=2019-07-15"));
  expect(ctxQ, "ONE context request spanning 2009-07-15..2019-07-15 was made");
  expect(ctxQ.includes("daily=temperature_2m_max,temperature_2m_min,precipitation_sum"),
    `ctx URL requests the three context variables — got ${ctxQ}`);
  log(`ctx URL (one request, 10-year span) verified: ${ctxQ}`);

  const stats = await page.$$eval("#dayCard .stat", els =>
    els.map(e => ({ l: e.querySelector(".sl").textContent, v: e.querySelector(".sv").textContent })));
  const statMap = Object.fromEntries(stats.map(s => [s.l, norm(s.v)]));
  expect(statMap["High"] === "86.5°", `High tile "${statMap["High"]}", wanted 86.5°`);
  expect(statMap["Low"] === "65.9°", `Low tile "${statMap["Low"]}", wanted 65.9°`);
  expect(statMap["Precip"] === "0.12", `Precip tile "${statMap["Precip"]}", wanted 0.12`);
  expect(statMap["Snowfall"] === "0.0", `Snowfall tile "${statMap["Snowfall"]}", wanted 0.0`);
  expect(statMap["Max wind"] === "9", `Max wind tile "${statMap["Max wind"]}", wanted 9 (8.7 mph rounded)`);
  expect(/5:37/.test(statMap["Sunrise"]), `Sunrise tile "${statMap["Sunrise"]}", wanted 5:37 AM`);
  expect(/8:26/.test(statMap["Sunset"]), `Sunset tile "${statMap["Sunset"]}", wanted 8:26 PM`);
  const sky = norm(await page.textContent("#skyLine"));
  expect(sky.includes("Overcast"), `sky line "${sky}" maps WMO code 3 -> Overcast`);
  log(`day card 2019-07-15: ${stats.map(s => `${s.l}=${norm(s.v)}`).join(" · ")} · sky="${sky}"`);
  log(`day stamp: "${norm(await page.textContent("#dayStamp"))}"`);

  /* ---- context: same-month-day filter -> 11 bars from ~3,653 rows ---- */
  const ctxRows = [...isoRange("2009-07-15", "2019-07-15")].length;
  const bars = await page.$$eval("#ctxChart rect.bar", els =>
    els.map(e => ({ year: e.dataset.year, chosen: e.classList.contains("chosen") })));
  expect(bars.length === 11, `SVG bars: ${bars.length}, wanted 11 (10 prior years + chosen)`);
  const chosen = bars.filter(b => b.chosen);
  expect(chosen.length === 1 && chosen[0].year === "2019", "exactly one highlighted bar and it is 2019");
  expect(bars.map(b => b.year).join(",") === "2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019",
    "bars cover every year 2009..2019 in order");
  log(`context chart: ${ctxRows} fixture rows filtered to ${bars.length} same-month-day bars (${bars.map(b => b.year).join(", ")}), chosen=2019 highlighted`);

  const sentences = norm(await page.textContent("#ctxSentences"));
  expect(sentences.includes("Warmest of the ten: 2010 (91.3°)"), `warmest sentence — got "${sentences}"`);
  expect(sentences.includes("coldest: 2014 (76.4°)"), `coldest sentence — got "${sentences}"`);
  expect(sentences.includes("Wettest of the ten: 2013 (1.42 in)"), `wettest sentence — got "${sentences}"`);
  expect(sentences.includes("Ten-year average high: 85.5°") && sentences.includes("86.5° (+1.0°)"),
    `10-yr average sentence (mean of 2009–2018 fixture highs = 85.5) — got "${sentences}"`);
  log(`context sentences: "${sentences}"`);

  /* ---- cache keys ---- */
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter(k => k.startsWith("suite.cache.weatherhistory.")).sort());
  for (const k of ["suite.cache.weatherhistory.day.40.7889x-73.9669.2019-07-15",
    "suite.cache.weatherhistory.ctx.40.7889x-73.9669.2019-07-15"])
    expect(keys.includes(k), `cache key ${k} written — have ${keys.join(", ")}`);
  log(`cache keys (24 h TTL envelopes): ${keys.join(", ")}`);

  /* ---- place search: empty result, then Lisbon; suite.location must not move ---- */
  await page.fill("#q", "Nowhereville");
  await page.press("#q", "Enter");
  await page.waitForFunction(() => (document.querySelector("#qRes") || {}).textContent.includes("No places matched"),
    undefined, { timeout: 15000 });
  log(`empty search: "${norm(await page.textContent("#qRes"))}"`);

  await page.fill("#q", "Lisbon");
  await page.press("#q", "Enter");
  await page.waitForSelector("#qRes .place-opt", { timeout: 15000 });
  const opts = await page.$$eval("#qRes .place-opt", els => els.map(e => e.textContent));
  expect(opts.length === 2, `search rendered ${opts.length} options, wanted 2`);
  expect(geoCalls.some(q => q.includes("name=Lisbon") && q.includes("count=5")),
    `geocoding URL carries name=Lisbon&count=5 — got ${geoCalls.join(" | ")}`);
  log(`place search "Lisbon": ${opts.length} options via ${geoCalls[geoCalls.length - 1]}`);

  const callsBeforePick = archiveCalls.length;
  await page.click("#qRes .place-opt");   // first result: Lisbon, Portugal
  await page.waitForFunction(() => {
    const s = document.querySelector("#dayCard .daysub");
    return s && s.textContent.includes("Lisbon");
  }, undefined, { timeout: 15000 });
  const lisbonDay = archiveCalls.slice(callsBeforePick).find(q =>
    q.includes("latitude=38.72509") && q.includes("longitude=-9.1498") &&
    q.includes("start_date=2019-07-15&end_date=2019-07-15"));
  expect(lisbonDay, "archive request after the pick uses the searched coordinates");
  const savedAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("suite.location")));
  expect(savedAfter.lat === 40.7889 && savedAfter.lon === -73.9669 && savedAfter.label === "Test Ridge, NY",
    `suite.location unchanged by the search — got ${JSON.stringify(savedAfter)}`);
  const chip = norm(await page.textContent("#placeChip"));
  expect(chip.includes("saved location unchanged"), `chip says the saved location is untouched — got "${chip}"`);
  expect(await page.isVisible("#useSavedBtn"), '"use my saved location" button is visible for a searched place');
  log(`picked "Lisbon, Portugal": archive URL now ${lisbonDay}`);
  log(`  suite.location untouched: ${JSON.stringify(savedAfter)} · chip="${chip}"`);
  expect((await page.evaluate(() => Object.keys(localStorage)))
    .includes("suite.cache.weatherhistory.day.38.72509x-9.1498.2019-07-15"),
    "searched place got its own coordinate-scoped cache key");

  /* ---- back to the saved location — served from cache, no new request ---- */
  const callsBeforeReturn = archiveCalls.length;
  await page.click("#useSavedBtn");
  await page.waitForFunction(() => {
    const s = document.querySelector("#dayCard .daysub");
    return s && s.textContent.includes("Test Ridge");
  }, undefined, { timeout: 15000 });
  expect(archiveCalls.length === callsBeforeReturn,
    `return to saved location made ${archiveCalls.length - callsBeforeReturn} requests, wanted 0 (fresh cache)`);
  log(`"use my saved location": back to Test Ridge with 0 new requests — stamp "${norm(await page.textContent("#dayStamp"))}"`);

  /* ---- date-bounds validation: no fetch on out-of-range dates ---- */
  const callsBeforeBounds = archiveCalls.length;
  await page.fill("#dateIn", "1939-12-31");
  let err = norm(await page.textContent("#dateErr"));
  expect(err.includes("1940"), `pre-1940 error shown — got "${err}"`);
  log(`date 1939-12-31 -> "${err}"`);
  await page.fill("#dateIn", "2026-07-28");
  err = norm(await page.textContent("#dateErr"));
  expect(err.includes("2026-07-25"), `ERA5-lag error names the latest available day — got "${err}"`);
  log(`date 2026-07-28 (inside the 5-day lag) -> "${err}"`);
  expect(archiveCalls.length === callsBeforeBounds, "out-of-range dates fired no requests");
  log(`date-bounds validation fired 0 requests (still ${archiveCalls.length} archive calls)`);

  /* ---- error path: both requests fail, nothing cached for that date ----
     (abort, not a fulfilled 500: Chromium logs a non-net::ERR console error for
     HTTP error statuses, which the harness treats as a hard failure) ---- */
  await page.route(isArchive, r => r.abort(), { times: 2 });
  await page.fill("#dateIn", "2001-03-09");
  await page.waitForFunction(() => {
    const c = document.querySelector("#dayCard .msg");
    return c && c.textContent.includes("Couldn't load");
  }, undefined, { timeout: 20000 });
  const dayErr = norm(await page.textContent("#dayCard .msg"));
  const ctxErr = norm(await page.textContent("#ctxCard"));
  expect(dayErr.includes("Couldn't reach Open-Meteo") && dayErr.includes("Nothing is cached"),
    `designed day error card — got "${dayErr}"`);
  expect(ctxErr.includes("Couldn't reach Open-Meteo"), `designed ctx error card — got "${ctxErr}"`);
  log(`error path (routes aborted, no cache): day="${dayErr}"`);
  log(`  ctx="${ctxErr}"`);
  await page.screenshot({ path: `${evidenceDir}/error-path.png`, fullPage: true });

  /* ---- a11y: labels + live regions + native controls ---- */
  const a11y = await page.evaluate(() => ({
    live: ["dayCard", "ctxCard", "qRes", "dateErr"].map(id =>
      id + "=" + (document.getElementById(id) || {}).getAttribute?.("aria-live")),
    qLabel: !!document.querySelector('label[for="q"]'),
    dateLabel: !!document.querySelector('label[for="dateIn"]'),
    themeLabel: document.getElementById("themeBtn").getAttribute("aria-label"),
    nativeButtons: [...document.querySelectorAll("#qGo, #useSavedBtn, .place-opt")]
      .every(b => b.tagName === "BUTTON")
  }));
  expect(a11y.live.every(s => s.endsWith("=polite")), `live regions: ${a11y.live.join(", ")}`);
  expect(a11y.qLabel && a11y.dateLabel, "search and date inputs have <label for>");
  expect(a11y.nativeButtons, "all interactive controls are native buttons");
  log(`a11y: live regions [${a11y.live.join(", ")}], labeled inputs=${a11y.qLabel && a11y.dateLabel}, theme aria-label="${a11y.themeLabel}", native buttons=${a11y.nativeButtons}`);

  /* ---- stale-cache offline path: back-date envelopes past the 24 h TTL,
     abort ALL http(s), reload -> boot renders the cached default date with
     visible "Offline — cached from" stamps ---- */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("suite.cache.")) {
        const e = JSON.parse(localStorage.getItem(k));
        e.t = Date.now() - 25 * 60 * 60 * 1000;   // 25 h > the 24 h TTL
        localStorage.setItem(k, JSON.stringify(e));
      }
  });
  const offline = r => r.abort();
  await page.route(isHttp, offline);              // registered last -> outranks the fixtures
  await page.reload();
  await page.waitForSelector("#dayCard .stats", { timeout: 20000 });
  const staleStamp = norm(await page.textContent("#dayStamp"));
  expect(staleStamp.startsWith("Offline — cached from"), `stale day stamp — got "${staleStamp}"`);
  const ctxStale = norm(await page.textContent("#ctxCard"));
  expect(ctxStale.includes("Offline — cached from"), `stale ctx stamp — got "${ctxStale.slice(0, 160)}"`);
  expect((await page.$$("#ctxChart rect.bar")).length === 11, "stale context still draws its 11 bars");
  log(`offline + stale cache (25 h old, all routes aborted): day stamp "${staleStamp}"`);
  log(`  ctx renders 11 bars from stale cache with its own offline stamp`);
  await page.screenshot({ path: `${evidenceDir}/offline-stale.png`, fullPage: true });
  await page.unroute(isHttp, offline);

  /* ---- restore a fresh-cache view (no refetch), then the mobile check ---- */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("suite.cache.")) {
        const e = JSON.parse(localStorage.getItem(k));
        e.t = Date.now();
        localStorage.setItem(k, JSON.stringify(e));
      }
  });
  await page.reload();
  await page.waitForSelector("#dayCard .stats", { timeout: 15000 });
  log(`restored from fresh cache without refetch: stamp "${norm(await page.textContent("#dayStamp"))}"`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth
  }));
  expect(overflow.doc <= 0 && overflow.body <= 0,
    `no horizontal overflow at 390 px — got ${JSON.stringify(overflow)}`);
  log(`mobile 390×844: horizontal overflow doc=${overflow.doc}px body=${overflow.body}px (none)`);
  await page.screenshot({ path: `${evidenceDir}/mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(250);
}

/* New-in-v4 tool — no v1 original, so no v1Interact. Keys written: suite.theme
   (harness toggle), suite.location (seeded), suite.cache.weatherhistory.* (manifest),
   plus the suite-wide chrome key suite.hub.recents from core theme.init(). */
