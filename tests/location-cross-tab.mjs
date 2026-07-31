/* Cross-tab active-location synchronization probe. Run from tests/: node location-cross-tab.mjs */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";

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
const consumer = await ctx.newPage();
const errors = [];
consumer.on("pageerror", e => errors.push(String(e)));
await consumer.addInitScript(() => {
  const n = Number(sessionStorage.getItem("locationReloadProbe") || 0);
  sessionStorage.setItem("locationReloadProbe", String(n + 1));
});
await consumer.route(/^https?:/, route => route.abort());
await settings.goto(pathToFileURL(join(ROOT, "tools", "settings.html")).href);
await settings.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith("suite.")) localStorage.removeItem(k);
  Suite.locations.add({ lat: 40.7128, lon: -74.006, label: "A" });
  Suite.locations.add({ lat: 34.0522, lon: -118.2437, label: "B" });
});
/* Air Quality reads Suite.location but intentionally has no page-specific storage
   listener. Core must propagate changes for every location consumer, not only the
   handful of tools that happen to wire their own reload handler. */
await consumer.goto(pathToFileURL(join(ROOT, "tools", "air.html")).href);
if (await consumer.evaluate(() => sessionStorage.getItem("locationReloadProbe")) !== "1") {
  throw new Error("location consumer initial-load probe failed");
}
await settings.evaluate(() => Suite.locations.activate("b"));
await consumer.waitForFunction(() => sessionStorage.getItem("locationReloadProbe") === "2", null, { timeout: 15000 });
const result = await consumer.evaluate(() => ({
  reloads: Number(sessionStorage.getItem("locationReloadProbe")),
  active: Suite.location.get(),
  paintedLabel: document.getElementById("locLabel")?.textContent
}));
if (result.active?.label !== "B" || result.paintedLabel !== "B" || errors.length) {
  throw new Error("cross-tab refresh failed: " + JSON.stringify({ result, errors }));
}

/* Every manifest-declared location consumer must opt into the shared watcher.
   This turns propagation into a suite contract instead of a per-tool convention
   that future tools can silently forget. */
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest", "tools.json"), "utf8"));
const locationTools = manifest.tools.filter(t => (t.storage || []).includes("suite.location"));
const missingWatch = locationTools.filter(t =>
  !readFileSync(join(ROOT, "tools", t.file), "utf8").includes("Suite.location.watch("));
if (missingWatch.length) {
  throw new Error("location consumers missing Suite.location.watch(): " +
    missingWatch.map(t => t.file).join(", "));
}
result.coveredTools = locationTools.length;
await ctx.close();
await browser.close();
console.log("location cross-tab: PASS " + JSON.stringify(result));
