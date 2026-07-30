/* tests/interactions/tropical.mjs — Tropical Cyclone Outlook (v4, cors-open, route-stubbed)

   api.weather.gov is fully route-fulfilled with deterministic fixtures whose shapes
   were copied from live probes (2026-07-30): /products/types/TWO @graph entries,
   /products/{id} bodies with real TWO productText layout, and /alerts/active
   geo+json features. Covered: basin bucketing by the outlook's own header line
   ("For the North Atlantic..." vs "...North Pacific...") with product ids that do
   NOT encode the basin, latest-per-basin selection (older list entries never
   fetched), "NN percent" highlighting with NHC low/med/high tiers, relative +
   absolute issuance times, off-season "formation is not expected" honesty (calm
   chip + verbatim text), tropical filtering of the alerts feed (Hurricane Watch
   kept, Flood Warning dropped), escaped hostile markup in an alert description,
   the calm no-tropical state (with and without non-tropical alerts), the designed
   no-location state, the 500 error path + retry (on a sibling page so the inherent
   "Failed to load resource: 500" console noise stays off the main gate, dns.mjs
   pattern), the stale-offline path, exact cache keys, aria-live/labels, and mobile
   no-overflow at 390 px. The interact run never hits the network. */
import { join } from "node:path";

export const selectors = [
  "body", ".topbar", ".back", ".theme-btn", "header h1", "header .tag",
  "#outlooks", "#outAtlantic", "#outPacific", "#alertsBox", "#outStamp", "#alStamp", "footer",
];

export const screenshotAfterInteract = true;
/* The generic harness navigates once before interact(). Abort that eager boot so
   no live NWS response or non-2xx console noise can race the deterministic router
   installed below. The later, more-specific route takes precedence. */
export async function beforeGoto({page}) {
  await page.route("https://api.weather.gov/**", route => route.abort());
}

const MIA = { lat: 25.7743, lon: -80.1937, label: "Miami, FL" };
const ALERTS_CACHE_KEY = "suite.cache.tropical.alerts.25.774x-80.194"; // lat/lon toFixed(3)

/* ---- fixtures (shapes copied from live api.weather.gov probes, 2026-07-30) ---- */
const ATL_TEXT = `
000
ABNT20 KNHC 231118
TWOAT

Tropical Weather Outlook
NWS National Hurricane Center Miami FL
800 AM EDT Thu Jul 23 2026

For the North Atlantic...Caribbean Sea and the Gulf of America:

1. Central Tropical Atlantic (AL95):
Showers and thunderstorms associated with a well-defined area of low
pressure located about midway between the west coast of Africa and
the Lesser Antilles have become better organized since yesterday.
Environmental conditions are conducive for additional development,
and a tropical depression is likely to form during the next day or
two while the system moves generally westward.
* Formation chance through 48 hours...high...70 percent.
* Formation chance through 7 days...high...90 percent.

2. Eastern Tropical Atlantic:
A tropical wave located just off the west coast of Africa is
producing a broad area of disorganized showers. Some slow
development of this system is possible late this week.
* Formation chance through 48 hours...low...10 percent.
* Formation chance through 7 days...low...20 percent.

$$
Forecaster Beven
`;

const EPAC_TEXT = `
000
ABPZ20 KNHC 231121
TWOEP

Tropical Weather Outlook
NWS National Hurricane Center Miami FL
500 AM PDT Thu Jul 23 2026

For the eastern and central North Pacific east of 180 longitude:

Tropical cyclone formation is not expected during the next 7 days.

$$
Forecaster Adams
`;

const STALE_TEXT = "OLD OUTLOOK — MUST NEVER BE FETCHED OR RENDERED";

function makeFixtures(now) {
  const iso = ms => new Date(ms).toISOString().replace(".000Z", "+00:00");
  const entry = (id, wmo, office, t) => ({
    "@id": "https://api.weather.gov/products/" + id, id,
    wmoCollectiveId: wmo, issuingOffice: office, issuanceTime: iso(t),
    productCode: "TWO", productName: "Tropical Weather Outlook and Summary",
  });
  const tAtl = now - 30 * 60 * 1000;   // "30 min ago"
  const tEp = now - 45 * 60 * 1000;    // "45 min ago"
  /* product ids deliberately do NOT encode the basin — bucketing can only come
     from reading the productText header line */
  const list = { "@graph": [
    entry("f81c2a", "ABNT20", "KNHC", tAtl),
    entry("b3d905", "ABNT20", "KNHC", now - 6 * 3600 * 1000),
    entry("c77e14", "ABPZ20", "KNHC", tEp),
    entry("a09d3b", "ABPZ20", "KNHC", now - 7 * 3600 * 1000),
  ] };
  const prod = (id, wmo, t, text) => Object.assign(entry(id, wmo, "KNHC", t), { productText: text });
  const products = {
    f81c2a: prod("f81c2a", "ABNT20", tAtl, ATL_TEXT),
    b3d905: prod("b3d905", "ABNT20", now - 6 * 3600 * 1000, STALE_TEXT),
    c77e14: prod("c77e14", "ABPZ20", tEp, EPAC_TEXT),
    a09d3b: prod("a09d3b", "ABPZ20", now - 7 * 3600 * 1000, STALE_TEXT),
  };
  const feature = p => ({ id: p.id, type: "Feature", properties: p });
  const hurricane = feature({
    id: "urn:oid:2.49.0.1.840.0.hurricane-watch", event: "Hurricane Watch", severity: "Severe",
    certainty: "Possible", urgency: "Expected",
    headline: "Hurricane Watch issued for coastal Miami-Dade County",
    description: 'A Hurricane Watch means hurricane conditions are possible within 48 hours. Markup like <img src=x onerror="boom()"> in the feed must stay inert text.',
    instruction: "Complete preparations before the arrival of tropical-storm-force winds.",
    areaDesc: "Coastal Miami Dade, FL", ends: iso(now + 12 * 3600 * 1000),
  });
  const flood = feature({
    id: "urn:oid:2.49.0.1.840.0.flood-warning", event: "Flood Warning", severity: "Moderate",
    certainty: "Likely", urgency: "Expected", headline: "Flood Warning for the Miami River",
    description: "Non-tropical flooding.", areaDesc: "Miami Dade, FL",
    ends: iso(now + 6 * 3600 * 1000),
  });
  return { list, products, hurricane, flood };
}

const ok = body => ({
  status: 200, contentType: "application/json",
  headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body),
});

/* state-driven router for one page; pushes fetched product ids to prodLog */
function makeRouter(state, prodLog) {
  return route => {
    const url = route.request().url();
    if (state.mode === "abort") return route.abort();
    if (state.mode === "err500")
      return route.fulfill({ status: 500, contentType: "application/json",
        headers: { "access-control-allow-origin": "*" }, body: '{"detail":"server error"}' });
    if (url.includes("/products/types/TWO")) return route.fulfill(ok(state.fix.list));
    const m = url.match(/\/products\/([^/?]+)$/);
    if (m) {
      prodLog.push(m[1]);
      const p = state.fix.products[m[1]];
      return p ? route.fulfill(ok(p)) : route.fulfill({ status: 404, body: "{}" });
    }
    if (url.includes("/alerts/active")) return route.fulfill(ok({ type: "FeatureCollection", features: state.alerts }));
    return route.fulfill({ status: 404, body: "{}" });
  };
}

const clearTropicalCaches = page => page.evaluate(() => {
  for (const k of Object.keys(localStorage))
    if (k.startsWith("suite.cache.")) localStorage.removeItem(k);
});
const outlooksReady = page => page.waitForFunction(() =>
  document.querySelector("#outAtlantic .prodtext") && document.querySelector("#outPacific .prodtext"),
  undefined, { timeout: 15000 });

export async function interact({ page, log, evidenceDir }) {
  const fix = makeFixtures(Date.now());
  const state = { mode: "ok", fix, alerts: [fix.hurricane, fix.flood] };
  const prodLog = [];
  await page.route("https://api.weather.gov/**", makeRouter(state, prodLog));
  /* the harness's initial page load ran before routes existed — let any in-flight
     requests settle so a late live response can't repopulate the caches we clear */
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  /* ---- 1. happy path: seeded location, fully stubbed network ---- */
  await page.evaluate(l => {
    for (const k of Object.keys(localStorage)) if (k !== "suite.theme") localStorage.removeItem(k);
    localStorage.setItem("suite.location", JSON.stringify(l));
    localStorage.setItem("suite.location.autoDenied", JSON.stringify("denied")); // keep autoBoot inert
  }, MIA);
  prodLog.length = 0; // drop anything the pre-route live load managed to send through the router
  await page.reload();
  await outlooksReady(page);
  await page.waitForSelector("#alertsBox details.alert", { timeout: 15000 });

  /* basin bucketing by header line (ids carry no basin hint) */
  const atlText = (await page.textContent("#outAtlantic")).replace(/\s+/g, " ");
  const pacText = (await page.textContent("#outPacific")).replace(/\s+/g, " ");
  if (!atlText.includes("For the North Atlantic")) throw new Error("Atlantic card missing Atlantic header line");
  if (!pacText.includes("North Pacific")) throw new Error("Pacific card missing Pacific header line");
  if (atlText.includes("North Pacific") || pacText.includes("North Atlantic"))
    throw new Error("basin texts crossed");
  log(`basin bucketing by header line: Atlantic card carries "For the North Atlantic...", Pacific card carries "...North Pacific..." (product ids f81c2a/c77e14 carry no basin hint)`);

  /* latest-per-basin: only the two newest products fetched, older ids untouched */
  const fetched = [...new Set(prodLog)].sort();
  if (fetched.join(",") !== "c77e14,f81c2a")
    throw new Error("wrong products fetched: " + JSON.stringify(prodLog));
  if ((atlText + pacText).includes("OLD OUTLOOK")) throw new Error("stale product text rendered");
  log(`latest-per-basin: product fetches = ${JSON.stringify(prodLog)} — the older ABNT20/ABPZ20 entries (b3d905, a09d3b) were never requested`);

  /* percentage highlighting with NHC tiers */
  const pct = await page.evaluate(() => {
    const all = [...document.querySelectorAll("#outAtlantic strong.pct")]
      .map(s => ({ text: s.textContent, cls: s.className }));
    return all;
  });
  const p70 = pct.find(p => p.text === "70 percent"), p20 = pct.find(p => p.text === "20 percent");
  if (!p70 || !p70.cls.includes("pct-high")) throw new Error("70 percent not highlighted high: " + JSON.stringify(pct));
  if (!p20 || !p20.cls.includes("pct-low")) throw new Error("20 percent not highlighted low: " + JSON.stringify(pct));
  log(`percent highlighting: ${pct.length} <strong.pct> chances in the Atlantic card — "70 percent" -> ${p70.cls}, "20 percent" -> ${p20.cls} (NHC low/med/high tiers)`);

  /* relative + absolute issuance time */
  const atlIssued = (await page.textContent("#outAtlantic .issued")).replace(/\s+/g, " ").trim();
  const pacIssued = (await page.textContent("#outPacific .issued")).replace(/\s+/g, " ").trim();
  if (!atlIssued.includes("30 min ago") || !pacIssued.includes("45 min ago"))
    throw new Error(`relative issuance times wrong: "${atlIssued}" / "${pacIssued}"`);
  if (!/·/.test(atlIssued) || !/\d/.test(atlIssued.split("·")[1] || ""))
    throw new Error("absolute issuance time missing: " + atlIssued);
  log(`issuance times: Atlantic "${atlIssued}"; Pacific "${pacIssued}" (relative + absolute)`);

  /* off-season honesty: verbatim "not expected" text + calm chip, no synthesized threat */
  if (!pacText.includes("Tropical cyclone formation is not expected during the next 7 days."))
    throw new Error("off-season text not shown verbatim");
  const calmChips = await page.evaluate(() => ({
    pac: document.querySelectorAll("#outPacific .chip.calm").length,
    atl: document.querySelectorAll("#outAtlantic .chip.calm").length,
  }));
  if (calmChips.pac !== 1 || calmChips.atl !== 0) throw new Error("calm chip wrong: " + JSON.stringify(calmChips));
  log(`off-season honesty: Pacific renders "Tropical cyclone formation is not expected..." verbatim with the calm chip; the 70-percent Atlantic card has no calm chip`);
  log(`outlook stamp: "${(await page.textContent("#outStamp")).trim()}"`);

  /* alerts panel: tropical filter keeps the Hurricane Watch, drops the Flood Warning */
  const alerts = await page.evaluate(() => ({
    cards: document.querySelectorAll("#alertsBox details.alert").length,
    event: document.querySelector("#alertsBox .a-event").textContent,
    badge: document.querySelector("#alertsBox .sev-badge").textContent,
    banner: document.querySelector("#alertsBox .banner").textContent.replace(/\s+/g, " ").trim(),
    hasFlood: document.getElementById("alertsBox").textContent.includes("Flood Warning"),
  }));
  if (alerts.cards !== 1 || alerts.event !== "Hurricane Watch" || alerts.hasFlood)
    throw new Error("tropical filter wrong: " + JSON.stringify(alerts));
  log(`alerts filter: feed had Hurricane Watch + Flood Warning -> 1 card rendered ("${alerts.event}", badge "${alerts.badge}"); Flood Warning dropped`);
  log(`  banner: "${alerts.banner}"`);

  /* hostile markup in the alert description stays inert */
  await page.click("#alertsBox details.alert summary");
  const inert = await page.evaluate(() => {
    const body = document.querySelector("#alertsBox .a-body");
    return { img: body.querySelectorAll("img").length, text: body.textContent.includes('<img src=x onerror="boom()">') };
  });
  if (inert.img !== 0 || !inert.text) throw new Error("alert description markup not inert: " + JSON.stringify(inert));
  log(`escaping: alert description's <img onerror> arrives as visible text, no element created`);

  /* exact cache keys */
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("suite.cache.")).sort());
  const want = ["suite.cache.tropical.two.atlantic", "suite.cache.tropical.two.list",
    "suite.cache.tropical.two.pacific", ALERTS_CACHE_KEY].sort();
  if (JSON.stringify(keys) !== JSON.stringify(want))
    throw new Error(`cache keys wrong: ${JSON.stringify(keys)} != ${JSON.stringify(want)}`);
  log(`cache keys: ${keys.join(", ")}`);

  /* a11y: live regions, icon-button label, native controls */
  const a11y = await page.evaluate(() => ({
    outLive: document.getElementById("outlooks").getAttribute("aria-live"),
    alLive: document.getElementById("alertsBox").getAttribute("aria-live"),
    stamps: [document.getElementById("outStamp"), document.getElementById("alStamp")].map(e => e.getAttribute("aria-live")),
    themeLabel: document.getElementById("themeBtn").getAttribute("aria-label"),
    themePressed: document.getElementById("themeBtn").getAttribute("aria-pressed"),
    summaries: document.querySelectorAll("#alertsBox details > summary").length,
  }));
  if (a11y.outLive !== "polite" || a11y.alLive !== "polite" || a11y.stamps.join() !== "polite,polite")
    throw new Error("live regions missing: " + JSON.stringify(a11y));
  if (!a11y.themeLabel || a11y.themePressed === null) throw new Error("theme button a11y missing");
  log(`a11y: aria-live=polite on #outlooks, #alertsBox and both stamps; theme button aria-label="${a11y.themeLabel}", aria-pressed=${a11y.themePressed}; alert cards use native <details>/<summary> (${a11y.summaries})`);
  await page.screenshot({ path: join(evidenceDir, "happy-path.png"), fullPage: true });

  /* ---- 2. calm state: only a non-tropical alert in the feed ---- */
  const prodCountBefore = prodLog.length;
  state.alerts = [fix.flood];
  await page.evaluate(k => localStorage.removeItem(k), ALERTS_CACHE_KEY);
  await page.reload();
  await outlooksReady(page);
  await page.waitForSelector("#alertsBox .banner.clearly", { timeout: 15000 });
  const calm = (await page.textContent("#alertsBox .banner.clearly")).replace(/\s+/g, " ").trim();
  if (!calm.includes("No tropical alerts") || !calm.includes("1 non-tropical alert"))
    throw new Error("calm state wrong: " + calm);
  log(`calm state (Flood Warning only): "${calm}"`);
  if (prodLog.length !== prodCountBefore)
    throw new Error("fresh basin caches should serve the reload without product refetches");
  log(`fresh-cache reload: outlooks rendered from suite.cache.tropical.two.* with zero product refetches`);

  /* truly empty feed */
  state.alerts = [];
  await page.evaluate(k => localStorage.removeItem(k), ALERTS_CACHE_KEY);
  await page.reload();
  await page.waitForSelector("#alertsBox .banner.clearly", { timeout: 15000 });
  const calm2 = (await page.textContent("#alertsBox .banner.clearly")).replace(/\s+/g, " ").trim();
  if (!calm2.includes("No tropical alerts") || calm2.includes("non-tropical"))
    throw new Error("empty-feed calm state wrong: " + calm2);
  log(`calm state (empty feed): "${calm2}"`);

  /* ---- 3. designed no-location state ---- */
  await page.evaluate(k => { localStorage.removeItem("suite.location"); localStorage.removeItem(k); }, ALERTS_CACHE_KEY);
  await page.reload();
  await page.waitForSelector("#alertsBox .card-msg", { timeout: 15000 });
  const noLoc = await page.evaluate(() => ({
    text: document.querySelector("#alertsBox .card-msg").textContent.replace(/\s+/g, " ").trim(),
    links: [...document.querySelectorAll("#alertsBox .card-msg a")].map(a => a.getAttribute("href")),
  }));
  if (!noLoc.text.includes("No location set") || !noLoc.links.includes("weather.html"))
    throw new Error("no-location state wrong: " + JSON.stringify(noLoc));
  log(`no-location designed state: "${noLoc.text.slice(0, 150)}…" (links: ${noLoc.links.join(", ")})`);
  await page.screenshot({ path: join(evidenceDir, "no-location.png"), fullPage: true });

  /* ---- 4. 500 error path + retry, on a sibling page (console-noise quarantine) ---- */
  await page.evaluate(l => localStorage.setItem("suite.location", JSON.stringify(l)), MIA);
  await clearTropicalCaches(page);
  const p2 = await page.context().newPage();
  const p2Console = [];
  p2.on("console", m => { if (m.type() === "error") p2Console.push(m.text().slice(0, 120)); });
  const p2state = { mode: "err500", fix, alerts: [fix.hurricane, fix.flood] };
  await p2.route("https://api.weather.gov/**", makeRouter(p2state, []));
  await p2.addInitScript(l => { // location must exist on p2 whatever file:// storage scoping does
    localStorage.setItem("suite.location", JSON.stringify(l));
    localStorage.setItem("suite.location.autoDenied", JSON.stringify("denied"));
    for (const k of Object.keys(localStorage)) if (k.startsWith("suite.cache.")) localStorage.removeItem(k);
  }, MIA);
  await p2.goto(page.url());
  await p2.waitForSelector("#alertsBox .card-msg.err", { timeout: 15000 });
  await p2.waitForSelector("#outAtlantic .card-msg.err", { timeout: 15000 });
  const errState = await p2.evaluate(() => ({
    atl: document.querySelector("#outAtlantic .card-msg.err").textContent.replace(/\s+/g, " ").trim(),
    pac: document.querySelector("#outPacific .card-msg.err").textContent.replace(/\s+/g, " ").trim(),
    al: document.querySelector("#alertsBox .card-msg.err").textContent.replace(/\s+/g, " ").trim(),
    retryIsButton: document.getElementById("retryAl") instanceof HTMLButtonElement &&
      document.getElementById("retryOutA") instanceof HTMLButtonElement,
  }));
  if (!errState.atl.includes("couldn't load") || !errState.al.includes("HTTP 500") || !errState.retryIsButton)
    throw new Error("500 error cards wrong: " + JSON.stringify(errState));
  log(`HTTP 500 path: Atlantic "${errState.atl.slice(0, 110)}"; alerts "${errState.al.slice(0, 110)}"; retries are native <button>s`);
  await p2.screenshot({ path: join(evidenceDir, "error-500.png"), fullPage: true });

  /* retry buttons recover once the service is back */
  p2state.mode = "ok";
  await p2.click("#retryAl");
  await p2.waitForSelector("#alertsBox details.alert", { timeout: 15000 });
  await p2.click("#retryOutA");
  await outlooksReady(p2);
  log(`retry: after the service recovers, "Try again" re-renders the alerts card ("${(await p2.textContent("#alertsBox .a-event")).trim()}") and both outlook basins`);
  log(`  sibling-page console (inherent non-2xx fetch noise, quarantined off the main gate): ${p2Console.join(" | ") || "(none)"}`);
  await p2.close();

  /* ---- 5. stale-offline path: repopulate caches on this page, back-date, kill the network ---- */
  state.mode = "ok";
  state.alerts = [fix.hurricane, fix.flood];
  await clearTropicalCaches(page);
  await page.reload();
  await outlooksReady(page);
  await page.waitForSelector("#alertsBox details.alert", { timeout: 15000 });
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("suite.cache.")) {
      const e = JSON.parse(localStorage.getItem(k));
      e.t = Date.now() - 24 * 60 * 60 * 1000;
      localStorage.setItem(k, JSON.stringify(e));
    }
  });
  state.mode = "abort";
  await page.reload();
  await outlooksReady(page);
  await page.waitForSelector("#alertsBox details.alert", { timeout: 15000 });
  const staleBits = await page.evaluate(() => ({
    atl: document.querySelector("#outAtlantic .stamp.off").textContent.trim(),
    pac: document.querySelector("#outPacific .stamp.off").textContent.trim(),
    al: document.getElementById("alStamp").textContent.trim(),
    event: document.querySelector("#alertsBox .a-event").textContent.trim(),
  }));
  for (const v of [staleBits.atl, staleBits.pac, staleBits.al])
    if (!v.includes("Offline — cached from") || !v.includes("1 day ago"))
      throw new Error("stale stamps wrong: " + JSON.stringify(staleBits));
  log(`stale-offline (caches back-dated 24 h, network aborted): both outlook cards render with "${staleBits.atl}"; alerts panel stamp "${staleBits.al}" and still shows the cached ${staleBits.event}`);
  await page.screenshot({ path: join(evidenceDir, "offline-stale.png"), fullPage: true });

  /* ---- 6. mobile 390 px: no horizontal overflow ---- */
  state.mode = "ok";
  await page.evaluate(() => {  // re-freshen caches so the mobile reload paints instantly
    for (const k of Object.keys(localStorage)) if (k.startsWith("suite.cache.")) {
      const e = JSON.parse(localStorage.getItem(k));
      e.t = Date.now();
      localStorage.setItem(k, JSON.stringify(e));
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await outlooksReady(page);
  await page.waitForSelector("#alertsBox details.alert", { timeout: 15000 });
  const mob = await page.evaluate(() => ({
    doc: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
    prod: [...document.querySelectorAll(".prodtext")].map(e => ({ sw: e.scrollWidth, cw: e.clientWidth })),
  }));
  if (mob.doc.sw > mob.doc.cw) throw new Error("horizontal overflow at 390px: " + JSON.stringify(mob.doc));
  for (const p of mob.prod) if (p.sw > p.cw + 1) throw new Error("product text overflows: " + JSON.stringify(mob.prod));
  log(`mobile 390x844: document scrollWidth ${mob.doc.sw} <= clientWidth ${mob.doc.cw}; product-text containers reflow (${mob.prod.map(p => p.sw + "/" + p.cw).join(", ")})`);
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });

  /* ---- restore desktop view for the after-interaction screenshot ---- */
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await outlooksReady(page);
  await page.waitForSelector("#alertsBox details.alert", { timeout: 15000 });
  log(`restored desktop viewport; final view renders both outlooks and the Hurricane Watch card from fresh caches`);
}
