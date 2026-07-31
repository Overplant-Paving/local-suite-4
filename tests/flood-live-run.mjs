/* Live DIAGNOSTIC capture for Flood Risk & Conditions — records whatever the real FEMA /
   NWS / NOAA services do at one public coordinate (rendered text, per-request status and
   sizes, CSP and console output) and always exits zero.

   This is NOT release acceptance and must never be read as one: it passes while FEMA is
   down. The strict gate is flood-live-accept.mjs, which requires the recorded correct
   classification and exits nonzero otherwise. */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const ROOT = resolve(import.meta.dirname);
const EV = join(ROOT, "evidence", "flood");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 950 } });
const page = await ctx.newPage();
const lines = [], errors = [], nets = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0,160)); });
page.on("pageerror", e => errors.push("pageerror: " + String(e).slice(0,160)));
page.on("requestfinished", async req => {
  try { const r = await req.response(); const body = await r.body().catch(() => null);
    nets.push({ url: req.url().split("?")[0] + (req.url().includes("?") ? "?…" : ""), status: r.status(),
      bytes: body ? body.length : null, ms: Math.round(req.timing().responseEnd) });
  } catch (e) {}
});
await page.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation",
  e => window.__csp.push(e.violatedDirective + " blocked " + (e.blockedURI || "inline"))); });
await page.goto(pathToFileURL(join(ROOT, "..", "dist", "flood.html")).href);
const t0 = Date.now();
await page.fill("#q", "29.9511, -90.0715");
await page.click("#goBtn");
await page.waitForFunction(() => ["glanceFema", "glanceAlert", "glanceGauge"]
  .every(id => (document.getElementById(id)?.textContent || "—").trim() !== "—"), null, { timeout: 90000 });
lines.push("live check of public coordinate 29.9511, -90.0715 (New Orleans city point) from built file://flood.html");
lines.push("all three glance tiles resolved " + (Date.now() - t0) + " ms after Check");
await page.waitForFunction(() => !/Loading|Checking for map revisions/.test(document.querySelector("#femaBox")?.textContent || ""), null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
lines.push("glance FEMA: " + await page.textContent("#glanceFema"));
lines.push("glance alerts: " + await page.textContent("#glanceAlert"));
lines.push("glance gauges: " + await page.textContent("#glanceGauge"));
lines.push("FEMA stamp: " + await page.textContent("#femaStamp"));
const fema = (await page.textContent("#femaBox")).replace(/\s+/g, " ").trim();
lines.push("FEMA card (truncated): " + fema.slice(0, 480));
lines.push("map text: " + (await page.textContent("#mapText").catch(() => "(no footprint)")).replace(/\s+/g, " ").trim().slice(0, 240));
lines.push("");
lines.push("requests (url, status, bytes, ms):");
for (const n of nets) lines.push(`  ${n.status} ${String(n.bytes).padStart(8)} B ${String(n.ms).padStart(6)} ms  ${n.url}`);
lines.push("total automatic bytes: " + nets.reduce((s, n) => s + (n.bytes || 0), 0));
lines.push("CSP violations: " + JSON.stringify(await page.evaluate(() => window.__csp)));
lines.push("console errors: " + JSON.stringify(errors));
await page.screenshot({ path: join(EV, "live-desktop-light.png"), fullPage: true });
writeFileSync(join(EV, "live-run.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
await b.close();
