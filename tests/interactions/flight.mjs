/* tests/interactions/flight.mjs — deterministic individual Flight Tracker coverage.
   No provider allowance is consumed: every Aviationstack request is route-fulfilled. */

export const selectors = [
  "body", ".back", ".theme-btn", "h1", ".sub", ".searchcard", "#flightIn", "#dateIn",
  "#trackBtn", "#status", ".flight-card", ".metrics", ".mapcard", "svg", "footer"
];
export const screenshotAfterInteract = true;

const API_RE = /api\.aviationstack\.com\/v1\/flights/;

export function fixture(date) {
  const now = Date.now();
  return {
    pagination: { limit: 100, offset: 0, count: 1, total: 1 },
    data: [{
      flight_date: date,
      flight_status: "active",
      departure: {
        airport: "John F Kennedy International", timezone: "America/New_York", iata: "JFK", icao: "KJFK",
        terminal: "8", gate: "42", scheduled: new Date(now - 3 * 3600000).toISOString(),
        estimated: new Date(now - 2.5 * 3600000).toISOString(), actual: new Date(now - 2.4 * 3600000).toISOString()
      },
      arrival: {
        airport: "Los Angeles International", timezone: "America/Los_Angeles", iata: "LAX", icao: "KLAX",
        terminal: "4", gate: "45A", scheduled: new Date(now + 2.25 * 3600000).toISOString(),
        estimated: new Date(now + 2.5 * 3600000).toISOString(), actual: null
      },
      airline: { name: "American Airlines", iata: "AA", icao: "AAL" },
      flight: { number: "100", iata: "AA100", icao: "AAL100" },
      aircraft: { registration: "N123AA", iata: "B738", icao: "B738", icao24: "abc123" },
      live: {
        updated: new Date(now - 45000).toISOString(), latitude: 39.125, longitude: -103.55,
        altitude: 10668, direction: 252, speed_horizontal: 861, speed_vertical: 0, is_ground: false
      }
    }]
  };
}

/* v4 weather-layer fixtures — every NWS / Open-Meteo request is route-fulfilled
   so the deterministic run stays fully offline. */
export function obsFixture() {
  return { properties: {
    timestamp: new Date(Date.now() - 12 * 60000).toISOString(), textDescription: "Light Rain",
    rawMessage: "KJFK 301651Z 18012G20KT 6SM -RA BKN020 22/18 A2992",
    temperature: { value: 22 }, windSpeed: { value: 22.2, unitCode: "wmoUnit:m_s" }, windDirection: { value: 180 },
    windGust: { value: 37, unitCode: "wmoUnit:m_s" }, visibility: { value: 9656 },
    cloudLayers: [{ amount: "BKN", base: { value: 610 } }]
  } };
}
export function sigmetFixture() {
  /* ring uses the NWS aviation [lat, lon] order on purpose — the page must correct it */
  return { type: "FeatureCollection", features: [{ type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[40.5, -104.5], [40.5, -102.5], [38.0, -102.5], [38.0, -104.5], [40.5, -104.5]]] },
    properties: { hazard: "CONVECTIVE" } }] };
}
export function routeWeather(page, counters = {}) {
  counters.grid = 0; counters.metar = 0; counters.sigmet = 0; counters.outlook = 0; counters.station = 0;
  return Promise.all([
    page.route(/api\.weather\.gov\/stations\/[A-Z0-9]+\/observations\/latest/, route => {
      counters.metar++;
      return route.fulfill({ status: 200, contentType: "application/geo+json", body: JSON.stringify(obsFixture()) });
    }),
    page.route(/api\.weather\.gov\/stations\/[A-Z0-9]+$/, route => {
      counters.station++;
      return route.fulfill({ status: 200, contentType: "application/geo+json",
        body: JSON.stringify({ geometry: { type: "Point", coordinates: [-118.408, 33.9425] }, properties: { stationIdentifier: "KLAX" } }) });
    }),
    page.route(/api\.weather\.gov\/aviation\/sigmets/, route => {
      counters.sigmet++;
      return route.fulfill({ status: 200, contentType: "application/geo+json", body: JSON.stringify(sigmetFixture()) });
    }),
    page.route(/api\.open-meteo\.com\/v1\/forecast/, route => {
      const u = new URL(route.request().url());
      if (u.searchParams.get("current")) {
        counters.grid++;
        const n = (u.searchParams.get("latitude") || "").split(",").length;
        const rows = Array.from({ length: n }, (_, i) => ({ current: { precipitation: i % 5 === 0 ? 1.2 : 0, weather_code: i % 5 === 0 ? 61 : 2 } }));
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
      }
      counters.outlook++;
      const t0 = new Date(); t0.setUTCMinutes(0, 0, 0);
      const time = Array.from({ length: 72 }, (_, i) => new Date(t0.getTime() + i * 3600000).toISOString().slice(0, 16));
      const fill = v => time.map(() => v);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        hourly: { time, temperature_2m: fill(24), precipitation_probability: fill(40),
          wind_speed_10m: fill(19), wind_gusts_10m: fill(32), weather_code: fill(61) } }) });
    }),
  ]);
}

export async function interact({ page, log, evidenceDir }) {
  let mode = "active", calls = 0, positionCalls = 0, leakedKey = false, serviceDate = "";
  const wxCalls = {};
  await routeWeather(page, wxCalls);
  await page.route(API_RE, async route => {
    calls++;
    const u = new URL(route.request().url());
    if (u.searchParams.get("access_key") !== "test-key") throw new Error("request omitted saved API key");
    if (!u.searchParams.get("flight_iata") || u.searchParams.get("limit") !== "100" || u.searchParams.has("flight_date")) throw new Error("request contract mismatch");
    if (mode === "throttle") return route.fulfill({ status: 200, contentType: "application/json", body: '{"error":{"code":"usage_limit_reached","message":"rate limit"}}' });
    if (mode === "keyerror") return route.fulfill({ status: 200, contentType: "application/json", body: '{"error":{"code":"invalid_access_key","message":"Invalid API access key"}}' });
    if (mode === "empty") return route.fulfill({ status: 200, contentType: "application/json", body: '{"pagination":{"count":0},"data":[]}' });
    if (mode === "wrongdate") {
      const body = fixture("1999-01-01");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    if (mode === "noliv") {
      const body = fixture(serviceDate); body.data[0].flight_status = "scheduled"; body.data[0].live = null;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    if (mode === "fallback") { const body=fixture(serviceDate); body.data[0].live=null; return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)}); }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture(serviceDate)) });
  });
  await page.route(/api\.airplanes\.live\/v2\/hex\//, route => { positionCalls++; return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ac:[{hex:"abc123",lat:41.25,lon:-92.5,alt_baro:35000,track:265,gs:470,seen:.8}]})}); });

  log(`initial no-key card visible=${await page.locator("#keyCard").isVisible()}, status=${JSON.stringify((await page.locator("#status").innerText()).trim())}`);
  await page.fill("#flightIn", "bad");
  await page.click("#trackBtn");
  log(`invalid flight rejected before fetch: calls=${calls}, status=${JSON.stringify((await page.locator("#status").innerText()).trim())}`);

  await page.evaluate(() => localStorage.setItem("suite.key.aviationstack", "test-key"));
  await page.reload();
  serviceDate = await page.inputValue("#dateIn");
  await page.fill("#flightIn", "ZZ999");
  mode = "empty";
  await page.click("#trackBtn");
  await page.waitForFunction(() => /No matching/.test(document.getElementById("status").textContent));
  log(`no-match path: ${JSON.stringify((await page.locator("#status").innerText()).trim())}`);

  await page.fill("#flightIn", "AA100");
  mode = "wrongdate";
  await page.click("#trackBtn");
  await page.waitForFunction(() => /No matching/.test(document.getElementById("status").textContent));
  log(`wrong-date provider row rejected rather than misidentified: ${JSON.stringify((await page.locator("#status").innerText()).trim())}`);

  mode = "keyerror";
  await page.evaluate(() => document.getElementById("refreshBtn").click());
  await page.waitForFunction(() => /key was rejected/.test(document.getElementById("status").textContent));
  log(`provider key rejection is specific: ${JSON.stringify((await page.locator("#status").innerText()).trim())}`);

  mode = "throttle";
  await page.evaluate(() => { const e=document.getElementById("refreshEvery"); e.value="900000"; e.dispatchEvent(new Event("change")); });
  await page.click("#trackBtn");
  await page.waitForFunction(() => /request limit/.test(document.getElementById("status").textContent));
  if (await page.inputValue("#refreshEvery") !== "0") throw new Error("rate limit did not disable automatic refresh");
  log(`429 path is specific: ${JSON.stringify((await page.locator("#status").innerText()).trim())}`);

  mode = "noliv";
  await page.press("#flightIn", "Enter");
  await page.waitForSelector("#result:not([hidden])");
  const noLive = await page.evaluate(() => ({ mapHidden: document.getElementById("mapCard").hidden,
    status: document.getElementById("status").textContent, altitude: document.querySelector("#metrics .metric:nth-child(2) b").textContent }));
  if (!noLive.mapHidden || !/no live position/.test(noLive.status) || noLive.altitude !== "Not reported") throw new Error("no-live state failed: " + JSON.stringify(noLive));
  log(`scheduled/no-position state is explicit: ${JSON.stringify(noLive)}`);

  mode = "fallback";
  await page.click("#refreshBtn");
  await page.waitForFunction(() => /Airplanes\.live ADS-B/.test(document.getElementById("positionAge").textContent));
  const fallback = await page.evaluate(() => ({mapHidden:document.getElementById("mapCard").hidden,position:document.getElementById("positionAge").textContent,coords:document.getElementById("coords").textContent,altitude:document.querySelector("#metrics .metric:nth-child(2) b").textContent}));
  if(fallback.mapHidden||fallback.altitude!=="35,000 ft"||positionCalls!==1) throw new Error("ADS-B fallback failed: "+JSON.stringify({fallback,positionCalls}));
  log(`keyed flight identity resolved through ADS-B fallback: ${JSON.stringify(fallback)}`);

  mode = "active";
  await page.click("#refreshBtn");
  await page.waitForFunction(() => document.getElementById("statePill").textContent === "active" && !document.getElementById("mapCard").hidden);
  const active = await page.evaluate(() => ({
    title: document.getElementById("flightTitle").textContent,
    airline: document.getElementById("airline").textContent,
    state: document.getElementById("statePill").textContent,
    route: [document.getElementById("depCode").textContent, document.getElementById("arrCode").textContent],
    arrival: document.getElementById("arrTime").textContent,
    metrics: [...document.querySelectorAll("#metrics .metric")].map(x => x.innerText.replace(/\s+/g, " ").trim()),
    mapHidden: document.getElementById("mapCard").hidden,
    planeMarkers: document.querySelectorAll("#map g").length,
    coords: document.getElementById("coords").textContent,
    cacheKeys: Object.keys(localStorage).filter(k => k.startsWith("suite.cache.flight.")),
    bodyContainsKey: document.body.innerText.includes("test-key"),
    usage: JSON.parse(localStorage.getItem("suite.flight.usage")),
    controls: (() => { const e=document.querySelector(".tracker-controls"),r=e.getBoundingClientRect(),cs=getComputedStyle(e); return {height:r.height,display:cs.display,align:cs.alignItems,justify:cs.justifyContent,gap:cs.gap,children:[...e.children].map(x=>({tag:x.tagName,top:Math.round(x.getBoundingClientRect().top-r.top),height:Math.round(x.getBoundingClientRect().height)}))}; })()
  }));
  if (active.title !== "AA100" || active.route.join("-") !== "JFK-LAX" || active.mapHidden ||
      active.planeMarkers !== 1 || active.bodyContainsKey || leakedKey) throw new Error("active render failed: " + JSON.stringify(active));
  log(`active flight rendered without exposing key: ${JSON.stringify(active)}`);

  /* v4 weather map: precip cells + SIGMET outline share the map with the plane;
     METAR panels decode; the world view stays one keypress away. */
  await page.waitForFunction(() => /Weather layer/.test(document.getElementById("wxStamp").textContent));
  await page.waitForFunction(() => /Outlook near arrival/.test(document.getElementById("arrWx").textContent));
  const weather = await page.evaluate(() => ({
    stamp: document.getElementById("wxStamp").textContent,
    precipCells: document.querySelectorAll("#map rect").length,
    sigmetPaths: [...document.querySelectorAll("#map path")].filter(p => p.querySelector("title")).length,
    plane: document.querySelectorAll("#map g").length,
    legendVisible: !document.getElementById("wxLegend").hidden,
    wxPressed: document.getElementById("viewWx").getAttribute("aria-pressed"),
      panelsVisible: !document.getElementById("wxPanels").hidden,
      depConditions: document.getElementById("depWx").innerText,
      arrOutlook: document.getElementById("arrWx").innerText,
  }));
  if (!weather.precipCells || weather.sigmetPaths !== 1 || weather.plane !== 1 || !weather.legendVisible ||
      weather.wxPressed !== "true" || !weather.panelsVisible ||
      !/Light Rain/.test(weather.depConditions) || !/Observed 12 minutes ago/.test(weather.depConditions) ||
      !/Wind 50 mph from 180°, gusting 83/.test(weather.depConditions) ||
      !/Outlook near arrival/.test(weather.arrOutlook) || !/40% chance/.test(weather.arrOutlook))
    throw new Error("weather map failed: " + JSON.stringify(weather));
  log(`weather map: ${weather.precipCells} precip cells, 1 SIGMET (order-corrected), NWS 22.2 m/s → 50 mph and 37 m/s gust → 83 mph: ${JSON.stringify(weather.stamp)}`);
  await page.click("#viewWorld");
  const world = await page.evaluate(() => ({
    pressed: document.getElementById("viewWorld").getAttribute("aria-pressed"),
    legendHidden: document.getElementById("wxLegend").hidden,
    landPaths: document.querySelectorAll("#map path").length,
  }));
  if (world.pressed !== "true" || !world.legendHidden || world.landPaths < 5) throw new Error("world view failed: " + JSON.stringify(world));
  log(`world view toggle: ${JSON.stringify(world)}`);
  await page.click("#viewWx");
  log(`deterministic weather requests: ${JSON.stringify(wxCalls)}`);

  // Weather freshness is recomputed per refresh: stale fallback must not stick
  // after the next successful grid + SIGMET response.
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("suite.cache.flight.wx.")) {
      const e = JSON.parse(localStorage.getItem(k)); e.t = Date.now() - 3600000;
      localStorage.setItem(k, JSON.stringify(e));
    }
  });
  const abortWeather = route => route.abort();
  await page.route(/api\.weather\.gov\//, abortWeather);
  await page.route(/api\.open-meteo\.com\//, abortWeather);
  await page.click("#refreshBtn");
  await page.waitForFunction(() => /Weather layer cached/.test(document.getElementById("wxStamp").textContent));
  const staleStamp = (await page.locator("#wxStamp").innerText()).trim();
  await page.unroute(/api\.weather\.gov\//, abortWeather);
  await page.unroute(/api\.open-meteo\.com\//, abortWeather);
  await page.click("#refreshBtn");
  await page.waitForFunction(() => {
    const s = document.getElementById("wxStamp").textContent;
    return /Weather layer/.test(s) && !/cached/.test(s);
  });
  const freshStamp = (await page.locator("#wxStamp").innerText()).trim();
  log(`weather stale→fresh refresh resets cache label: ${JSON.stringify(staleStamp)} → ${JSON.stringify(freshStamp)}`);

  // Flight-data stale fallback: age the envelope, abort the forced refresh, and retain visibly labeled data.
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find(x => x.startsWith("suite.cache.flight.") && !x.startsWith("suite.cache.flight.wx."));
    const e = JSON.parse(localStorage.getItem(k)); e.t = Date.now() - 3600000; localStorage.setItem(k, JSON.stringify(e));
  });
  await page.evaluate(() => { window.__flightNativeFetch = window.fetch; window.fetch = () => Promise.reject(new Error("offline")); });
  await page.click("#refreshBtn");
  await page.waitForFunction(() => /Showing cached data/.test(document.getElementById("status").textContent));
  await page.evaluate(() => { window.fetch = window.__flightNativeFetch; delete window.__flightNativeFetch; });
  log(`offline stale fallback: ${JSON.stringify((await page.locator("#status").innerText()).trim())}`);
  log(`total deterministic provider requests: aviationstack=${calls}, airplanes.live=${positionCalls}`);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    routeColumns: getComputedStyle(document.querySelector(".route")).gridTemplateColumns }));
  if (mobile.scrollWidth > mobile.width) throw new Error("mobile horizontal overflow: " + JSON.stringify(mobile));
  await page.screenshot({ path: evidenceDir + "/mobile.png", fullPage: true });
  log(`mobile layout has no horizontal overflow: ${JSON.stringify(mobile)}`);
  await page.setViewportSize({ width: 1280, height: 900 });
}
