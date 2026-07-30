/* tests/interactions/worldbank.mjs — Country Indicator Trends (v4, cors-open)
   Fully offline-deterministic: every api.worldbank.org endpoint is route-fulfilled
   with fixtures copied from live response shapes (probed 2026-07-30; [meta, rows]
   pairs, rows newest-first {date, value|null}). Exercised:
   - country-list fixture incl. an aggregate row (region.id "NA") that must be filtered,
   - latest-non-null + reporting year (2025 null rows must be skipped),
   - sparkline path point counts (nulls skipped), % change math recomputed in-test,
   - $T / $B / M / years / % formatting, compare mode (both series + legend),
   - all-null indicator -> designed "no data" state, HTTP 500 -> error card + retry
     recovery, 429 -> distinct rate-limit card, countries 500 -> global error card
     (the intentional non-2xx noise is quarantined on a sibling page, dns.mjs-style),
   - stale-cache offline path with per-card stamps, cache-key scope, country switch
     re-queries, mobile 390px no-overflow, labels + live regions. */

export const selectors = [
  "body", ".topbar", ".back", ".theme-btn", "header h1", "header .tag",
  ".picker", "#c1", "#c2", "#status", "#cards", ".card", ".card h2", "footer"
];

export const screenshotAfterInteract = true;

/* ---------- fixtures (real World Bank shapes, deterministic values) ---------- */
const COUNTRIES_FIX = [
  { page: 1, pages: 1, per_page: "400", total: 5 },
  [
    { id: "AFE", iso2Code: "ZH", name: "Africa Eastern and Southern",
      region: { id: "NA", iso2code: "NA", value: "Aggregates" } }, // must be filtered out
    { id: "USA", iso2Code: "US", name: "United States",
      region: { id: "NAC", iso2code: "XU", value: "North America" } },
    { id: "JPN", iso2Code: "JP", name: "Japan",
      region: { id: "EAS", iso2code: "Z4", value: "East Asia & Pacific" } },
    { id: "KEN", iso2Code: "KE", name: "Kenya",
      region: { id: "SSF", iso2code: "ZG", value: "Sub-Saharan Africa" } },
    { id: "DEU", iso2Code: "DE", name: "Germany",
      region: { id: "ECS", iso2code: "Z7", value: "Europe & Central Asia" } }
  ]
];

/* USA life expectancy: 30 rows 1996..2025, 2025 + 2020 null -> 28 points */
const usaLE = [];
for (let y = 2025; y >= 1996; y--) {
  let v;
  if (y === 2025 || y === 2020) v = null;
  else if (y === 2024) v = 79.2;
  else v = +(76 + (y - 1996) * 0.1).toFixed(1);
  usaLE.push([y, v]);
}

const FIX = {
  USA: {
    "NY.GDP.MKTP.CD": [[2025, 26.9e12], [2024, 25.7e12], [2023, 24.5e12], [2022, 23.3e12],
      [2021, 22.3e12], [2020, 21.3e12], [2019, 21.7e12], [2018, 20.9e12], [2017, 20.4e12],
      [2016, 20e12]],
    "NY.GDP.PCAP.CD": [[2025, 80190], [2024, 77500], [2023, 74600], [2022, 71100], [2021, 69300]],
    "SP.POP.TOTL": [[2025, null], [2024, 334000000], [2023, 333300000], [2022, 332100000],
      [2021, 331900000], [2020, 331500000], [2019, 328300000], [2018, 326800000],
      [2017, 325100000], [2016, 323100000], [2015, 320000000]],
    "SP.DYN.LE00.IN": usaLE,
    "FP.CPI.TOTL.ZG": [[2025, 4.1], [2024, 2.9], [2023, 4.1], [2022, 8.0], [2021, 4.7]],
    "IT.NET.USER.ZS": [[2025, null], [2024, null], [2023, null], [2022, null]], // all null
    "SP.URB.TOTL.IN.ZS": [[2025, 83.5], [2024, 83.3], [2023, 83.1], [2022, 82.9], [2021, 82.7]]
  },
  JPN: {
    "NY.GDP.MKTP.CD": [[2025, 4.2e12], [2024, 4.1e12], [2023, 4.4e12], [2022, 4.7e12], [2021, 5.0e12]],
    "NY.GDP.PCAP.CD": [[2025, 33900], [2024, 33100], [2023, 34000]],
    "SP.POP.TOTL": [[2025, 123300000], [2024, 123800000], [2023, 124400000]],
    "SP.DYN.LE00.IN": [[2025, null], [2024, 84.9], [2023, 84.7], [2022, 84.5]],
    "FP.CPI.TOTL.ZG": [[2025, 2.7], [2024, 2.2], [2023, 3.3]],
    "IT.NET.USER.ZS": [[2025, null], [2024, 86.2], [2023, 84.9]], // mixed card: USA no-data, JPN data
    "SP.URB.TOTL.IN.ZS": [[2025, 92.1], [2024, 92.0], [2023, 91.9]]
  },
  KEN: {
    "NY.GDP.MKTP.CD": [[2025, null], [2024, 108e9], [2023, 100e9], [2022, 95e9]],
    "NY.GDP.PCAP.CD": [[2024, 2110], [2023, 1980], [2022, 1870]],
    "SP.POP.TOTL": [[2024, 55300000], [2023, 54000000], [2022, 53000000]],
    "SP.DYN.LE00.IN": [[2024, 63.6], [2023, 63.2], [2022, 62.9]],
    "FP.CPI.TOTL.ZG": [[2024, 4.5], [2023, 7.7], [2022, 7.6]],
    "IT.NET.USER.ZS": [[2024, 40.8], [2023, 35.0], [2022, 32.0]],
    "SP.URB.TOTL.IN.ZS": [[2024, 29.5], [2023, 29.0], [2022, 28.5]]
  },
  DEU: { // served only once flags.deuDown is cleared (retry-recovery proof)
    "NY.GDP.MKTP.CD": [[2024, 4.5e12], [2023, 4.4e12], [2022, 4.1e12]],
    "NY.GDP.PCAP.CD": [[2024, 54300], [2023, 52800]],
    "SP.POP.TOTL": [[2024, 83500000], [2023, 83300000]],
    "SP.DYN.LE00.IN": [[2024, 81.2], [2023, 81.0]],
    "FP.CPI.TOTL.ZG": [[2024, 2.3], [2023, 5.9]],
    "IT.NET.USER.ZS": [[2024, 93.2], [2023, 92.5]],
    "SP.URB.TOTL.IN.ZS": [[2024, 77.8], [2023, 77.7]]
  }
};

const mkRows = (iso3, code, pairs) => [
  { page: 1, pages: 1, per_page: 50, total: pairs.length, sourceid: "2", lastupdated: "2026-07-13" },
  pairs.map(([d, v]) => ({
    indicator: { id: code, value: code }, country: { id: iso3.slice(0, 2), value: iso3 },
    countryiso3code: iso3, date: String(d), value: v, unit: "", obs_status: "", decimal: 0
  }))
];

const json = body => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const WB = u => u.hostname === "api.worldbank.org";
const ABORT = u => u.protocol === "http:" || u.protocol === "https:";

function wbHandler(flags, requested) {
  return route => {
    const url = new URL(route.request().url());
    requested.push(url.pathname + url.search);
    if (url.pathname === "/v2/country") {
      if (flags.countriesFail) return route.fulfill({ status: 500, contentType: "text/plain", body: "boom" });
      return route.fulfill(json(COUNTRIES_FIX));
    }
    const m = url.pathname.match(/^\/v2\/country\/([A-Z]{3})\/indicator\/([A-Z0-9.]+)$/);
    if (m) {
      const [, iso3, code] = m;
      if (iso3 === "DEU" && flags.deuDown) {
        if (code === "FP.CPI.TOTL.ZG") return route.fulfill({ status: 429, contentType: "text/plain", body: "slow down" });
        return route.fulfill({ status: 500, contentType: "text/plain", body: "boom" });
      }
      const pairs = FIX[iso3] && FIX[iso3][code];
      if (pairs) return route.fulfill(json(mkRows(iso3, code, pairs)));
      return route.fulfill({ status: 404, contentType: "application/json", body: "[]" });
    }
    return route.abort();
  };
}

function expect(cond, msg) { if (!cond) throw new Error("EXPECT FAILED: " + msg); }

const cardInfo = (pg, code) => pg.evaluate(c => {
  const card = document.querySelector(`#cards .card[data-code="${c}"]`);
  if (!card) return null;
  return {
    paths: card.querySelectorAll("path.sline").length,
    series: [...card.querySelectorAll(".serie")].map(s => ({
      name: s.querySelector(".cname")?.textContent ?? null,
      val: s.querySelector(".val")?.textContent ?? null,
      yr: s.querySelector(".yr")?.textContent ?? null,
      delta: s.querySelector(".delta")?.textContent ?? null,
      nodata: s.querySelector(".nodata")?.textContent ?? null,
      stale: s.querySelector(".stale-note")?.textContent ?? null,
      err: s.querySelector(".errbox p")?.textContent ?? null,
      sparkLabel: s.querySelector("svg.spark")?.getAttribute("aria-label") ?? null,
      pathPts: (() => {
        const p = s.querySelector("path.sline");
        return p ? (p.getAttribute("d").match(/L/g) || []).length + 1 : 0;
      })()
    }))
  };
}, code);

const waitVal = (pg, code, text) => pg.waitForFunction(([c, t]) => {
  const card = document.querySelector(`#cards .card[data-code="${c}"]`);
  return !!card && [...card.querySelectorAll(".val")].some(v => v.textContent === t);
}, [code, text], { timeout: 20000 });

const GDP = "NY.GDP.MKTP.CD";

export async function interact({ page, log, evidenceDir }) {
  /* ---- 1. deterministic fixtures FIRST: route every WB endpoint, wipe live cache ---- */
  const flags = { deuDown: true, countriesFail: false };
  const requested = [];
  await page.route(WB, wbHandler(flags, requested));
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("suite.cache.")) localStorage.removeItem(k);
  });
  await page.reload();
  await waitVal(page, GDP, "$26.9T");
  log("fixture boot: default country United States, all 7 indicator cards fetched via route-stub");

  /* ---- 2. aggregate filtering in the country picker ---- */
  const opts = await page.evaluate(() => [...document.querySelectorAll("#countryList option")].map(o => o.value));
  expect(opts.length === 4, "datalist should hold 4 real countries, got " + JSON.stringify(opts));
  expect(!opts.includes("Africa Eastern and Southern"), "aggregate row must be filtered out");
  log(`country picker: fixture had 5 rows incl. aggregate "Africa Eastern and Southern" (region.id "NA") -> datalist [${opts.join(", ")}] (aggregate filtered)`);

  /* ---- 3. latest-non-null + year, formatting, % change math, sparkline points ---- */
  const gdp = (await cardInfo(page, GDP)).series[0];
  expect(gdp.val === "$26.9T" && gdp.yr === "2025", "GDP latest: " + JSON.stringify(gdp));
  expect(gdp.delta === "+34.5% · 2016→2025", "GDP delta: " + gdp.delta);
  expect(gdp.pathPts === 10, "GDP sparkline points: " + gdp.pathPts);
  log(`GDP: "${gdp.val}" (${gdp.yr}) — $T formatting; delta "${gdp.delta}" (recomputed: ((26.9-20)/20*100).toFixed(1) = ${((26.9e12 - 20e12) / 20e12 * 100).toFixed(1)}); sparkline path = 10 points / 9 L-segments`);

  const pop = (await cardInfo(page, "SP.POP.TOTL")).series[0];
  expect(pop.val === "334M" && pop.yr === "2024", "POP latest: " + JSON.stringify(pop));
  expect(pop.delta === "+4.4% · 2015→2024", "POP delta: " + pop.delta);
  log(`Population: fixture 2025 row is null -> latest-with-year picks newest NON-null: "${pop.val}" (${pop.yr}); delta "${pop.delta}" (recomputed ${((334 - 320) / 320 * 100).toFixed(1)}%)`);

  const le = (await cardInfo(page, "SP.DYN.LE00.IN")).series[0];
  expect(le.val === "79.2 years" && le.yr === "2024", "LE latest: " + JSON.stringify(le));
  expect(le.pathPts === 28, "LE sparkline points (30 rows, 2 nulls): " + le.pathPts);
  expect(le.delta === "+4.2% · 1996→2024", "LE delta: " + le.delta);
  log(`Life expectancy: "${le.val}" (${le.yr}); 30-row series with nulls at 2025+2020 -> sparkline draws 28 points (nulls skipped); delta "${le.delta}"`);

  const pcap = (await cardInfo(page, "NY.GDP.PCAP.CD")).series[0];
  const cpi = (await cardInfo(page, "FP.CPI.TOTL.ZG")).series[0];
  const urb = (await cardInfo(page, "SP.URB.TOTL.IN.ZS")).series[0];
  expect(pcap.val === "$80,190", "PCAP value: " + pcap.val);
  expect(cpi.val === "4.1%" && cpi.delta === "-12.8% · 2021→2025", "CPI: " + JSON.stringify(cpi));
  expect(urb.val === "83.5%", "URB value: " + urb.val);
  log(`formats: GDP per capita "${pcap.val}", inflation "${cpi.val}" (negative-trend delta "${cpi.delta}", recomputed ${((4.1 - 4.7) / 4.7 * 100).toFixed(1)}%), urban "${urb.val}"`);

  /* ---- 4. all-null indicator -> designed "no data reported" state ---- */
  const net = (await cardInfo(page, "IT.NET.USER.ZS")).series[0];
  expect(net.nodata && net.val === null, "NET should be no-data: " + JSON.stringify(net));
  log(`all-null indicator (Internet users, USA fixture): designed state "${net.nodata}" — no fake value, no blank`);

  /* ---- 5. cache keys: exactly the manifest scope suite.cache.worldbank.* ---- */
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("suite.cache.")).sort());
  expect(keys.includes("suite.cache.worldbank.countries"), "countries cache key");
  for (const ind of Object.keys(FIX.USA)) {
    expect(keys.includes("suite.cache.worldbank.USA." + ind), "missing cache key for " + ind);
  }
  expect(keys.every(k => k.startsWith("suite.cache.worldbank.")), "cache keys outside manifest scope: " + keys);
  log(`cache keys (${keys.length}, all under suite.cache.worldbank.*): countries + per-(country,indicator) e.g. ${keys[1]}`);
  const q = requested.find(u => u.includes("/indicator/"));
  expect(q.includes("format=json") && q.includes("mrv=30"), "indicator query params: " + q);
  log(`request shape: ${q}`);

  /* ---- 6. a11y: labels, live regions, aria ---- */
  const a11y = await page.evaluate(() => ({
    l1: document.querySelector('label[for="c1"]')?.textContent,
    l2: document.querySelector('label[for="c2"]')?.textContent,
    status: document.getElementById("status").getAttribute("aria-live"),
    cards: document.getElementById("cards").getAttribute("aria-live"),
    note: document.getElementById("pickNote").getAttribute("aria-live"),
    clear: document.getElementById("clearCmp").getAttribute("aria-label"),
    spark: document.querySelector("svg.spark")?.getAttribute("aria-label")
  }));
  expect(a11y.l1 === "Country" && a11y.l2 === "Compare with", "select labels: " + JSON.stringify(a11y));
  expect(a11y.status === "polite" && a11y.cards === "polite" && a11y.note === "polite", "live regions");
  expect(!!a11y.clear && !!a11y.spark, "aria-labels: " + JSON.stringify(a11y));
  log(`a11y: labeled inputs ("${a11y.l1}", "${a11y.l2}"); #status/#cards/#pickNote aria-live=polite; clear button aria-label="${a11y.clear}"; sparkline aria-label="${a11y.spark}"`);

  /* ---- 7. unknown country input -> designed note, no state change ---- */
  await page.fill("#c1", "Atlantis");
  await page.press("#c1", "Enter");
  const noteTxt = (await page.textContent("#pickNote")).trim();
  expect(noteTxt.includes("No country matched"), "picker note: " + noteTxt);
  log(`unknown input "Atlantis" + Enter -> note "${noteTxt}", cards untouched`);
  await page.fill("#c1", "United States");
  await page.press("#c1", "Enter");

  /* ---- 8. compare mode: both values + sparklines + legend ---- */
  await page.fill("#c2", "Japan");
  await page.press("#c2", "Enter"); // Enter submits (quality bar)
  await page.waitForFunction(() =>
    document.querySelectorAll(`#cards .card[data-code="NY.GDP.MKTP.CD"] .serie`).length === 2, { timeout: 20000 });
  await waitVal(page, GDP, "$4.2T");
  const cmp = await cardInfo(page, GDP);
  expect(cmp.paths === 2, "compare GDP should draw 2 sparklines, got " + cmp.paths);
  expect(cmp.series[0].name === "United States" && cmp.series[1].name === "Japan", "legend names");
  expect(cmp.series[1].val === "$4.2T" && cmp.series[1].yr === "2025", "JPN GDP: " + JSON.stringify(cmp.series[1]));
  expect(cmp.series[1].delta === "-16.0% · 2021→2025", "JPN delta: " + cmp.series[1].delta);
  log(`compare mode (Japan via Enter): GDP card renders 2 series / 2 sparkline paths; legend "${cmp.series[0].name}" ${cmp.series[0].val} vs "${cmp.series[1].name}" ${cmp.series[1].val} (${cmp.series[1].yr}), JPN delta "${cmp.series[1].delta}"`);
  const netCmp = await cardInfo(page, "IT.NET.USER.ZS");
  expect(netCmp.series[0].nodata && netCmp.series[1].val === "86.2%", "mixed NET card: " + JSON.stringify(netCmp.series));
  log(`mixed card (Internet users): USA "${netCmp.series[0].nodata}" while Japan shows "${netCmp.series[1].val}" (${netCmp.series[1].yr}) — honest per-series states`);
  log(`status line: "${(await page.textContent("#status")).trim()}"`);

  /* ---- 9. country switch re-queries the API ---- */
  await page.fill("#c1", "Kenya");
  await page.press("#c1", "Enter");
  await waitVal(page, GDP, "$108B");
  const kenReqs = requested.filter(u => u.includes("/v2/country/KEN/indicator/"));
  expect(kenReqs.length === 7, "Kenya switch should fire 7 indicator requests, got " + kenReqs.length);
  const ken = (await cardInfo(page, GDP)).series[0];
  expect(ken.val === "$108B" && ken.yr === "2024" && ken.delta === "+13.7% · 2022→2024", "KEN GDP: " + JSON.stringify(ken));
  log(`country switch to Kenya: 7 fresh /v2/country/KEN/indicator/* requests (Japan compare served from cache); GDP "$108B" (${ken.yr}, 2025 null skipped), delta "${ken.delta}" (recomputed ${((108 - 95) / 95 * 100).toFixed(1)}%) — $B formatting`);
  await page.click("#clearCmp");
  await page.waitForFunction(() =>
    document.querySelectorAll(`#cards .card[data-code="NY.GDP.MKTP.CD"] .serie`).length === 1, { timeout: 20000 });
  log("clear-compare button: cards back to a single series");

  /* ---- 10. HTTP 500 / 429 / global error on a SIBLING page (dns.mjs pattern:
          keeps the intentional non-2xx console noise off the harness gate) ---- */
  const p2 = await page.context().newPage();
  const req2 = [];
  await p2.route(WB, wbHandler(flags, req2));
  await p2.goto(page.url());
  await waitVal(p2, GDP, "$26.9T"); // boots from the shared fixture cache
  await p2.fill("#c1", "Germany");
  await p2.press("#c1", "Enter");
  await p2.waitForFunction(() =>
    document.querySelectorAll("#cards .errbox").length >= 7, { timeout: 30000 });
  const deuGdp = (await cardInfo(p2, GDP)).series[0];
  const deuCpi = (await cardInfo(p2, "FP.CPI.TOTL.ZG")).series[0];
  expect(deuGdp.err && deuGdp.err.includes("HTTP 500"), "500 error card: " + JSON.stringify(deuGdp));
  expect(deuCpi.err && deuCpi.err.includes("Rate-limited") && deuCpi.err.includes("429"), "429 card: " + JSON.stringify(deuCpi));
  const retryLabel = await p2.getAttribute(`#cards .card[data-code="${GDP}"] .retry`, "aria-label");
  log(`HTTP 500 (Germany, uncached): designed error card "${deuGdp.err}" with retry button (aria-label="${retryLabel}")`);
  log(`HTTP 429 (Germany CPI): distinct rate-limit card "${deuCpi.err}"`);
  await p2.screenshot({ path: `${evidenceDir}/error-500.png`, fullPage: true });

  flags.deuDown = false; // provider recovers -> retry works
  await p2.click(`#cards .card[data-code="${GDP}"] .retry`);
  await waitVal(p2, GDP, "$4.5T");
  log(`retry after recovery: GDP card re-queried and now shows "$4.5T" (2024)`);

  flags.countriesFail = true; // country list itself down, nothing cached
  await p2.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("suite.cache.")) localStorage.removeItem(k);
  });
  await p2.reload();
  await p2.waitForSelector("#cards .errbox.global", { timeout: 20000 });
  const gErr = (await p2.textContent("#cards .errbox.global p")).trim();
  expect(gErr.includes("HTTP 500"), "global error text: " + gErr);
  log(`country-list 500 with empty cache: global error card "${gErr}"`);
  flags.countriesFail = false;
  await p2.click("#retryAll");
  await waitVal(p2, GDP, "$26.9T");
  log("retry-all: country list + United States cards recover (cache repopulated)");
  await p2.close();

  /* ---- 11. stale-cache offline path: back-date beyond TTL, block the network ---- */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith("suite.cache.")) continue;
      const e = JSON.parse(localStorage.getItem(k));
      // indicators: 8 d > 7 d TTL; countries: 31 d > 30 d TTL
      e.t = Date.now() - (k === "suite.cache.worldbank.countries" ? 31 : 8) * 24 * 60 * 60 * 1000;
      localStorage.setItem(k, JSON.stringify(e));
    }
  });
  await page.route(ABORT, r => r.abort()); // registered later -> takes precedence over fixtures
  await page.reload();
  await waitVal(page, GDP, "$26.9T"); // must render from stale cache, not a blank
  const staleGdp = (await cardInfo(page, GDP)).series[0];
  expect(staleGdp.stale && staleGdp.stale.startsWith("Offline — cached from"), "stale stamp: " + JSON.stringify(staleGdp));
  const staleStatus = (await page.textContent("#status")).trim();
  expect(staleStatus.includes("offline: country list cached from"), "stale status: " + staleStatus);
  log(`offline + expired cache: cards render cached values with per-card stamp "${staleGdp.stale}"`);
  log(`  status carries the stale country list too: "${staleStatus}"`);
  await page.screenshot({ path: `${evidenceDir}/offline-stale.png`, fullPage: true });
  await page.unroute(ABORT);

  /* ---- 12. restore a fresh-cache view (no refetch), then the mobile check ---- */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith("suite.cache.")) continue;
      const e = JSON.parse(localStorage.getItem(k));
      e.t = Date.now();
      localStorage.setItem(k, JSON.stringify(e));
    }
  });
  await page.reload();
  await waitVal(page, GDP, "$26.9T");
  const fresh = (await cardInfo(page, GDP)).series[0];
  expect(fresh.stale === null, "fresh view should carry no stale stamp");
  log("restored: fresh cache serves without refetch, stale stamps gone");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mob = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth
  }));
  expect(mob.sw <= mob.cw, `mobile overflow: scrollWidth ${mob.sw} > clientWidth ${mob.cw}`);
  log(`mobile 390px: scrollWidth ${mob.sw} <= clientWidth ${mob.cw} (no horizontal overflow; cards stack)`);
  await page.screenshot({ path: `${evidenceDir}/mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200);
}
