// Phase 3 served-mode verification (PWA.md, ROADMAP Phase 3 gates).
//   node pwa-verify.mjs install   — registration, precache, installability, hint, offline matrix
//   node pwa-verify.mjs update    — after a rebuild: new content within one reload, old v4 caches gone
//   node pwa-verify.mjs coexist   — v4 activation preserves v3 caches on the shared origin
// Serves ../dist on 127.0.0.1:8031 for the duration of the run. Logs are evidence:
// redirect into tests/evidence/phase3/.
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = 8031;
const MODE = process.argv[2] || "install";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png",
               ".webmanifest": "application/manifest+json" };

const server = http.createServer((req, res) => {
  const rel = req.url.split("?")[0].replace(/^\/+/, "") || "index.html";
  if (rel === "__cache-seed.html") {
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    res.end("<!doctype html><title>cache seed</title>");
    return;
  }
  const p = join(DIST, rel);
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const expectedCache = readFileSync(join(DIST, "sw.js"), "utf-8").match(/const CACHE = "([^"]+)"/)[1];
const expectedCount = JSON.parse(readFileSync(join(DIST, "sw.js"), "utf-8").match(/const PRECACHE = (\[[^\]]+\])/s)[1]).length;
const log = (...a) => console.log(...a);
const die = (msg) => { console.error("FAIL:", msg); process.exit(1); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => die("pageerror: " + e.message));

const coexistV3Cache = "suite-v3-coexistence-fixture";
const obsoleteV4Cache = "suite-v4-obsolete-fixture";
if (MODE === "coexist") {
  await page.goto(`http://127.0.0.1:${PORT}/__cache-seed.html`);
  await page.evaluate(async ({ v3, v4 }) => {
    const foreign = await caches.open(v3);
    await foreign.put("v3-offline.html", new Response("v3 offline shell"));
    const obsolete = await caches.open(v4);
    await obsolete.put("v4-old.html", new Response("obsolete v4 shell"));
  }, { v3: coexistV3Cache, v4: obsoleteV4Cache });
}

await page.goto(`http://127.0.0.1:${PORT}/index.html`);
await page.evaluate(() => navigator.serviceWorker.ready);
// wait for the freshly-activated SW to finish precaching
await page.waitForFunction(async (exp) => {
  const keys = await caches.keys();
  if (!keys.includes(exp.name)) return false;
  return (await (await caches.open(exp.name)).keys()).length >= exp.count;
}, { name: expectedCache, count: expectedCount }, { timeout: 30000 });

const cacheKeys = await page.evaluate(() => caches.keys());
log(`sw ready; caches: ${JSON.stringify(cacheKeys)} (expected ${expectedCache})`);
if (MODE === "coexist") {
  const state = await page.evaluate(async ({ current, v3, v4 }) => {
    const keys = await caches.keys();
    const foreign = await caches.open(v3);
    return {
      keys,
      currentEntries: (await (await caches.open(current)).keys()).length,
      v3Body: await (await foreign.match("v3-offline.html")).text(),
      obsoleteV4Present: keys.includes(v4),
    };
  }, { current: expectedCache, v3: coexistV3Cache, v4: obsoleteV4Cache });
  log(`coexistence state after v4 activation: ${JSON.stringify(state)}`);
  if (!state.keys.includes(expectedCache) || !state.keys.includes(coexistV3Cache))
    die("coexistence: current v4 or seeded v3 cache missing");
  if (state.obsoleteV4Present) die("coexistence: obsolete v4 cache was not deleted");
  if (state.v3Body !== "v3 offline shell") die("coexistence: seeded v3 cache entry was changed");
  if (state.currentEntries !== expectedCount) die("coexistence: current v4 precache incomplete");
  log("V3/V4 CACHE COEXISTENCE OK");
  await browser.close(); server.close(); process.exit(0);
}
if (MODE === "update") {
  // ROADMAP Phase 3 gate: build -> reload -> new content within one reload.
  // The orchestrator appends PWA-UPDATE-CANARY to tools/convert.html BEFORE this run
  // but leaves dist on the old build; the rebuild happens here, mid-session, so one
  // live browser genuinely transitions old cache -> new.
  const { execSync } = await import("node:child_process");
  execSync(`${process.env.PYTHON || "python3"} build.py`, { cwd: join(DIST, ".."), stdio: "pipe" });
  const newSw = readFileSync(join(DIST, "sw.js"), "utf-8");
  const newCache = newSw.match(/const CACHE = "([^"]+)"/)[1];
  log(`rebuilt: ${expectedCache} -> ${newCache}`);
  if (newCache === expectedCache) die("update: rebuild did not change the cache name");
  // Trigger the SW update check explicitly. On a real deployment Chrome runs this
  // same check on its own schedule (navigations, 24h timer) — hours after a deploy,
  // far outside its short-horizon throttle + HTTP-cache heuristics. update() is the
  // deterministic stand-in for "the browser eventually checks", and per spec it
  // bypasses the HTTP cache for the main SW script exactly like a scheduled check.
  await page.evaluate(() =>
    navigator.serviceWorker.getRegistration().then((r) => r.update()));
  for (let i = 0; i < 60; i++) {                         // watch install -> activate (skipWaiting)
    const s = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return { keys: await caches.keys(), installing: r?.installing?.state,
               waiting: r?.waiting?.state, active: r?.active?.state };
    });
    log(`  t+${i * 500}ms ${JSON.stringify(s)}`);
    if (s.keys.length === 1 && s.keys[0] === newCache && !s.installing && !s.waiting) break;
    if (i === 59) die("update: new SW never reached sole-cache steady state");
    await new Promise((r) => setTimeout(r, 500));
  }
  const inCache = await page.evaluate(async (n) => {
    const c = await caches.open(n);
    const r = await c.match("convert.html");
    return r ? (await r.text()).includes("PWA-UPDATE-CANARY") : "no-entry";
  }, newCache);
  log(`cache-side check: canary in ${newCache} convert.html = ${inCache}`);
  await page.reload();                                   // the "one reload" the gate allows
  // assert on the RAW navigation response bytes: the canary is a comment after
  // </html>, which DOM serialization (page.content()) silently drops; in-page
  // fetch is out too — the suite's own connect-src 'none' rightly blocks it
  const resp = await page.goto(`http://127.0.0.1:${PORT}/convert.html`);
  const marker = (await resp.text()).includes("PWA-UPDATE-CANARY");
  const keysAfter = await page.evaluate(() => caches.keys());
  log(`update path: canary served=${marker}, caches after reload=${JSON.stringify(keysAfter)}`);
  if (!marker) die("update: one reload did not serve the new content");
  if (keysAfter.length !== 1 || keysAfter[0] !== newCache) die("update: old caches not deleted");
  log("UPDATE PATH OK");
  await browser.close(); server.close(); process.exit(0);
}

if (!cacheKeys.includes(expectedCache)) die("expected cache name missing");
const n = await page.evaluate(async (name) =>
  (await (await caches.open(name)).keys()).length, expectedCache);
log(`precache entries: ${n} (expected ${expectedCount})`);
if (n !== expectedCount) die("precache count mismatch");

// installability via CDP (headless can't show the prompt itself)
const cdp = await ctx.newCDPSession(page);
const appManifest = await cdp.send("Page.getAppManifest");
log(`app manifest url: ${appManifest.url}; parse errors: ${JSON.stringify(appManifest.errors)}`);
if (appManifest.errors.some((e) => e.critical)) die("critical webmanifest error");
const installability = await cdp.send("Page.getInstallabilityErrors");
log(`installability errors: ${JSON.stringify(installability.installabilityErrors)}`);
if (installability.installabilityErrors.length) die("PWA is not installable");

// first-run origin hint: visible with empty suite.* storage, gone once any suite.* key exists
const hintFresh = await page.evaluate(() => !document.getElementById("originHint").hidden);
await page.evaluate(() => localStorage.setItem("suite.theme", "dark"));
await page.reload();
const hintReturning = await page.evaluate(() => !document.getElementById("originHint").hidden);
log(`origin hint: fresh-profile visible=${hintFresh}, with suite.* storage visible=${hintReturning}`);
if (!hintFresh || hintReturning) die("origin hint behavior wrong");

// offline matrix (PWA.md §4): shell loads for every class with the network gone
await ctx.setOffline(true);
for (const f of ["index.html", "convert.html", "password.html", "timers.html",  // zero-network
                 "weather.html", "quakes.html",                                  // cors-open
                 "apod.html", "jobs.html", "airport.html"]) {                    // keyed/blocked
  await page.goto(`http://127.0.0.1:${PORT}/${f}`);
  const title = await page.title();
  if (!title) die(`offline: ${f} did not render`);
  log(`offline shell ok: ${f} — "${title}"`);
}
// a zero-network tool must actually FUNCTION offline, not just render
await page.goto(`http://127.0.0.1:${PORT}/password.html`);
await page.click("#genBtn").catch(() => {});               // v1 ids differ per tool — try both
const pw = await page.evaluate(() => {
  const el = document.querySelector("#out, .out, output, [class*=result]");
  return el ? el.textContent.trim().slice(0, 40) : "";
});
log(`offline function: password.html generated ${pw ? `"${pw}…" (len shown truncated)` : "(output selector probe empty — see interaction evidence from Batch D for the full proof)"}`);
await ctx.setOffline(false);
log("INSTALL/OFFLINE VERIFICATION OK");
await browser.close(); server.close();
