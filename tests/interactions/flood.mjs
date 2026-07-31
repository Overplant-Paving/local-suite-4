/* tests/interactions/flood.mjs — Flood Risk & Conditions (v4.1, cors-open + Census JSONP).
   Fully routed: no live request leaves this test (flood-built.mjs is the deep deterministic
   gate; a separate archived live run covers real endpoints). Exercises: suite-location
   shortcut display, direct-coordinate check, per-source renders, save-as-suite-location,
   and the stale-cache offline path. */
import * as F from "./flood-fixtures.mjs";

export const selectors = [
  "body", ".topbar", ".back", ".theme-btn", "header h1", "header .tag",
  ".card", ".card h2", "#q", ".btn.primary", ".glance", ".tile", "footer"
];

export const screenshotAfterInteract = true;

export async function beforeGoto({ page }) {
  const reqs = [];
  await F.installRouter(page.context(), F.STANDARD, reqs);
  await page.addInitScript(() => {
    localStorage.setItem("suite.location", JSON.stringify({ lat: 34.0522, lon: -118.2437, label: "Los Angeles, CA" }));
  });
}

export async function interact({ page, log, evidenceDir }) {
  log(`suite shortcut candidate: "${(await page.textContent("#suiteCand")).trim()}"`);
  log(`results hidden before any check: ${await page.locator("#results").isHidden()}`);

  /* direct coordinates -> one explicit Check */
  await page.fill("#q", `${F.PT.lat}, ${F.PT.lon}`);
  log(`button text for coordinates: "${await page.textContent("#goBtn")}"`);
  await page.click("#goBtn");
  await page.waitForFunction(() => /Zone AE/.test(document.querySelector("#femaBox")?.textContent || ""), null, { timeout: 15000 });
  await page.waitForFunction(() => /Big River/.test(document.querySelector("#gaugeBox")?.textContent || ""), null, { timeout: 15000 });
  log(`target bar: "${(await page.textContent("#targetBar")).replace(/\s+/g, " ").trim().slice(0, 140)}"`);
  log(`glance FEMA: "${await page.textContent("#glanceFema")}"`);
  log(`glance alerts: "${await page.textContent("#glanceAlert")}"`);
  log(`glance gauges: "${await page.textContent("#glanceGauge")}"`);
  log(`FEMA stamp: "${await page.textContent("#femaStamp")}"`);
  log(`footprint aria-label: "${(await page.getAttribute("#footprint", "aria-label") || "").slice(0, 160)}"`);
  log(`map text equivalent: "${(await page.textContent("#mapText")).replace(/\s+/g, " ").trim().slice(0, 160)}"`);
  const alerts = await page.evaluate(() => [...document.querySelectorAll("#alertBox .a-event")].map(e => e.textContent));
  log(`flood alerts rendered (severity-sorted, unrelated filtered): ${JSON.stringify(alerts)}`);
  const gauges = await page.evaluate(() => [...document.querySelectorAll("#gaugeBox .gauge h3")].map(e => e.textContent.trim()));
  log(`gauge cards (flood-category-first): ${JSON.stringify(gauges)}`);

  /* explicit save-as-suite-location action */
  await page.click("#saveSuiteBtn");
  log(`after save: suite.location = ${await page.evaluate(() => localStorage.getItem("suite.location"))}`);

  /* cache envelopes */
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("suite.cache.flood.")).sort());
  log(`independent flood cache envelopes: ${JSON.stringify(keys)}`);
  log(`suite.flood.target = ${await page.evaluate(() => localStorage.getItem("suite.flood.target"))}`);

  /* stale-cache offline path: age everything past its TTL, cut the network, reload */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("suite.cache.flood.")) {
      const e = JSON.parse(localStorage.getItem(k));
      const back = 8 * 24 * 3600e3;
      if (e.t) e.t -= back;
      for (const part of ["zone", "panel", "lomr", "avail"]) if (e[part] && e[part].t) e[part].t -= back;
      localStorage.setItem(k, JSON.stringify(e));
    }
  });
  await page.context().unroute(/^https?:/);
  await page.context().route(/^https?:/, r => r.abort());
  await page.reload();
  await page.waitForFunction(() => /Zone AE/.test(document.querySelector("#femaBox")?.textContent || ""), null, { timeout: 20000 });
  await page.waitForFunction(() => /offline — cached from/i.test(document.querySelector("#femaStamp")?.textContent || ""), null, { timeout: 30000 });
  log(`offline stale FEMA stamp: "${await page.textContent("#femaStamp")}"`);
  log(`offline stale alerts stamp: "${await page.textContent("#alertStamp")}"`);
  log(`offline stale gauges stamp: "${await page.textContent("#gaugeStamp")}"`);
  await page.screenshot({ path: `${evidenceDir}/offline-stale.png`, fullPage: true });
  await page.context().unroute(/^https?:/);
  /* restore fixtures so the harness theme-toggle probe ends on a working page */
  await F.installRouter(page.context(), F.STANDARD, []);
}
