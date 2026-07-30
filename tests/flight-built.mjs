/* Built Flight Tracker deep-link/CSP integration. Run from tests/: node flight-built.mjs */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { fixture, routeWeather } from "./interactions/flight.mjs";

const ROOT = resolve(import.meta.dirname, "..");
let browser;
try { browser = await chromium.launch({ channel: "chrome" }); }
catch (e) {
  if (!String(e).includes("distribution 'chrome' is not found")) throw e;
  browser = await chromium.launch();
}
const ctx = await browser.newContext();
const page = await ctx.newPage();
const issues = [];
page.on("console", m => { if (m.type() === "error") issues.push(m.text()); });
page.on("pageerror", e => issues.push(String(e)));
await page.addInitScript(() => localStorage.setItem("suite.key.aviationstack", "test-key"));
await page.route(/api\.aviationstack\.com\/v1\/flights/, route => {
  const u = new URL(route.request().url());
  if (u.searchParams.get("access_key") !== "test-key" || u.searchParams.get("flight_iata") !== "AA100" ||
      u.searchParams.get("limit") !== "100" || u.searchParams.has("flight_date")) {
    return route.fulfill({ status: 400, contentType: "application/json", body: '{"error":{"message":"bad test request"}}' });
  }
  const body=fixture(date); body.data[0].live=null;
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
});
await page.route(/api\.airplanes\.live\/v2\/hex\//, route => route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ac:[{hex:"abc123",lat:39.125,lon:-103.55,alt_baro:35000,track:252,gs:465,seen:1}]})}));
await routeWeather(page);
const date = new Date().toISOString().slice(0, 10);
const url = pathToFileURL(join(ROOT, "dist", "flight.html")).href + "?flight=AA100&date=" + date;
await page.goto(url);
await page.waitForSelector("#result:not([hidden])");
await page.waitForFunction(() => /Weather layer/.test(document.getElementById("wxStamp").textContent));
const result = await page.evaluate(() => ({
  title: document.getElementById("flightTitle").textContent,
  route: [document.getElementById("depCode").textContent, document.getElementById("arrCode").textContent],
  mapVisible: !document.getElementById("mapCard").hidden,
  keyExposed: document.body.innerText.includes("test-key"),
  cspAllowsProvider: ["https://api.aviationstack.com","https://api.airplanes.live","https://api.weather.gov","https://api.open-meteo.com"].every(h => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content.includes(h)),
  positionSource: document.getElementById("positionAge").textContent,
  cached: Object.keys(localStorage).some(k => k.startsWith("suite.cache.flight.aa100.")),
  precipCells: document.querySelectorAll("#map rect").length,
  wxPanels: !document.getElementById("wxPanels").hidden,
  metarDecoded: /Light Rain/.test(document.getElementById("depWx").innerText)
}));
if (result.title !== "AA100" || result.route.join("-") !== "JFK-LAX" || !result.mapVisible ||
    result.keyExposed || !result.cspAllowsProvider || !/Airplanes\.live ADS-B/.test(result.positionSource) || !result.cached ||
    !result.precipCells || !result.wxPanels || !result.metarDecoded || issues.length) {
  throw new Error("built Flight Tracker failed: " + JSON.stringify({ result, issues }));
}
await ctx.close();
await browser.close();
console.log("built flight tracker: PASS " + JSON.stringify(result));
