/* Strict live RELEASE ACCEPTANCE for Flood Risk & Conditions. Run from tests/:
     node flood-live-accept.mjs
   This is a gate, not a diagnostic. It opens the built file://dist/flood.html against the
   real FEMA / NWS / NOAA services, checks one stable public coordinate, and requires the
   recorded correct answer. It EXITS NONZERO whenever FEMA cannot classify the point —
   an "FEMA unavailable" card is a failure here by design.

   Outage capture lives in flood-live-run.mjs, which records whatever the services do
   without asserting. Keep the two separate: a captured outage must never read as a pass.

   Expected result for 29.9511, -90.0715 (public New Orleans city coordinate), recorded
   live on 2026-07-31 in tests/evidence/flood-feasibility/live-probe.md:
     zone X · ZONE_SUBTY "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" · SFHA_TF F · DFIRM_ID 22071C */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const EV = join(ROOT, "tests", "evidence", "flood");
mkdirSync(EV, { recursive: true });

const POINT = { lat: 29.9511, lon: -90.0715, name: "New Orleans city coordinate (public)" };
const lines = [];
const say = s => { lines.push(s); console.log(s); };
const fails = [];
function must(cond, msg) { if (!cond) fails.push(msg); say((cond ? "PASS  " : "FAIL  ") + msg); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
page.on("pageerror", e => consoleErrors.push("pageerror: " + String(e).slice(0, 200)));
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation",
    e => window.__csp.push(e.violatedDirective + " blocked " + (e.blockedURI || "inline")));
});

say("strict live acceptance — " + POINT.name + " " + POINT.lat + ", " + POINT.lon);
say("built page: dist/flood.html opened over file://");
say("");

await page.goto(pathToFileURL(join(ROOT, "dist", "flood.html")).href);
await page.fill("#q", POINT.lat + ", " + POINT.lon);
await page.click("#goBtn");

/* wait for the FEMA section to settle either way, then judge it */
await page.waitForFunction(
  () => document.getElementById("femaSec")?.getAttribute("aria-busy") === "false" &&
        !/Checking the FEMA/.test(document.getElementById("femaBox")?.textContent || ""),
  null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1500);

const fema = (await page.textContent("#femaBox")).replace(/\s+/g, " ").trim();
const glance = (await page.textContent("#glanceFema")).trim();
const status = (await page.textContent("#femaStatus")).trim();
say('FEMA glance tile: "' + glance + '"');
say('FEMA status announcement: "' + status + '"');
say("FEMA card: " + fema.slice(0, 400));
say("");

/* --- the core classification must actually have happened ---
   Supplementary panel/LOMR requests may fail independently after a valid zone answer, so do not
   reject the whole card merely because those details honestly say "unavailable". */
const coreUnavailable = /The FEMA NFHL service could not be reached|zone records?[^.]*could not read/i.test(fema) ||
  /FEMA unavailable|Zone records unreadable/i.test(glance);
must(!coreUnavailable,
  "FEMA returned a real classification (no service-error or unreadable card)");
must(/Zone X\b/.test(fema), 'FEMA zone is X at this coordinate (recorded expected result)');
must(/Outside the mapped Special Flood Hazard Area/.test(fema),
  "SFHA is the explicit outside state (SFHA_TF=F), not unknown");
must(/Outside the mapped SFHA — zone X/.test(glance), "glance tile states the same outside/zone-X result");
must(/0\.2% annual-chance/.test(fema) || /0\.2 PCT/i.test(fema),
  "the 0.2% annual-chance subtype is surfaced");
must(/22071C/.test(fema), "the recorded flood-study identity 22071C is present");

/* --- the containing-zone footprint must have been drawn from real geometry --- */
const map = await page.evaluate(() => {
  const sec = document.getElementById("mapSec");
  const svg = document.getElementById("footprint");
  return { hidden: !sec || sec.hidden, paths: svg ? svg.querySelectorAll("path").length : 0,
    label: svg ? svg.getAttribute("aria-label") : "", text: document.getElementById("mapText")?.textContent || "" };
});
must(!map.hidden, "the containing-zone footprint section is shown");
must(map.paths >= 1, "the footprint SVG contains at least one drawn zone path (" + map.paths + ")");
must(/Approximate distance to this mapped zone edge: [\d.]+ (m|km)/.test(map.text),
  "an approximate zone-edge distance was computed from the returned geometry");
must(!/could not read as a complete boundary/.test(map.text), "the returned rings validated as complete");

/* --- the page must be clean under its generated CSP --- */
const csp = await page.evaluate(() => window.__csp);
must(csp.length === 0, "zero CSP violations (" + JSON.stringify(csp) + ")");
must(consoleErrors.length === 0, "zero console/page errors (" + JSON.stringify(consoleErrors.slice(0, 3)) + ")");

await page.screenshot({ path: join(EV, "live-accept.png"), fullPage: true });
await browser.close();

say("");
say(fails.length
  ? "RESULT: FAIL — " + fails.length + " acceptance check(s) failed:\n  - " + fails.join("\n  - ")
  : "RESULT: PASS — live FEMA classification matches the recorded expected result");
writeFileSync(join(EV, "live-accept.txt"), lines.join("\n") + "\n");
process.exit(fails.length ? 1 : 0);
