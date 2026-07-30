/* Cross-tab active-location synchronization probe. Run from tests/: node location-cross-tab.mjs */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
} catch (e) {
  if (!String(e).includes("distribution 'chrome' is not found")) throw e;
  browser = await chromium.launch();
}
const ctx = await browser.newContext();
const settings = await ctx.newPage();
const weather = await ctx.newPage();
const errors = [];
weather.on("pageerror", e => errors.push(String(e)));
await weather.addInitScript(() => {
  const n = Number(sessionStorage.getItem("locationReloadProbe") || 0);
  sessionStorage.setItem("locationReloadProbe", String(n + 1));
});
await weather.route(/^https?:/, route => route.abort());
await settings.goto(pathToFileURL(join(ROOT, "tools", "settings.html")).href);
await settings.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith("suite.")) localStorage.removeItem(k);
  Suite.locations.add({ lat: 40.7128, lon: -74.006, label: "A" });
  Suite.locations.add({ lat: 34.0522, lon: -118.2437, label: "B" });
});
await weather.goto(pathToFileURL(join(ROOT, "tools", "weather.html")).href);
if (await weather.evaluate(() => sessionStorage.getItem("locationReloadProbe")) !== "1") {
  throw new Error("weather initial-load probe failed");
}
await settings.evaluate(() => Suite.locations.activate("b"));
await weather.waitForFunction(() => sessionStorage.getItem("locationReloadProbe") === "2", null, { timeout: 15000 });
const result = await weather.evaluate(() => ({
  reloads: Number(sessionStorage.getItem("locationReloadProbe")),
  active: Suite.location.get()
}));
if (result.active?.label !== "B" || errors.length) {
  throw new Error("cross-tab refresh failed: " + JSON.stringify({ result, errors }));
}
await ctx.close();
await browser.close();
console.log("location cross-tab: PASS " + JSON.stringify(result));
