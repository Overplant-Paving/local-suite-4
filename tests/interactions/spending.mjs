/* tests/interactions/spending.mjs — Federal Spending Explorer (v4, cors-open)
   Fully route-stubbed and deterministic: every api.usaspending.gov request in this run is
   fulfilled from fixtures copied from live probes of the real response shapes (2026-07-30).
   Proves: agency ranking + $T/$B formatting + share bars + FY note, state select -> correct
   FIPS in the URL + stat cards + per-capita, suite.state persistence honored on reload,
   absent fields -> "not reported", designed 500 + 429 cards, stale-cache "Offline — cached
   from ..." stamps, labels + live regions, and 390px no-overflow.

   NOTE on the HTTP-error paths: Chromium logs a console error ("Failed to load resource:
   the server responded with a status of 500/429") for ANY non-2xx response, including
   route-fulfilled ones — verified empirically — and verify-tool.mjs treats every console
   error without "net::ERR" as a hard failure. So the 500/429 paths are exercised on a
   second page in the same context (same file, same localStorage), where THIS test monitors
   the console itself and fails on anything beyond the unavoidable network-status lines. */

export const selectors = [
  "body", ".topbar", ".back", ".theme-btn", "header h1", "header .tag",
  "section h2", "section .note", "#agBox", ".locrow", "#stateSel", "#stBox",
  ".stamp", "footer"
];

export const screenshotAfterInteract = true;

/* ---------- fixtures (shapes probed live 2026-07-30) ---------- */
const GRAND_TOTAL = 15823226897068.67;
const A = (name, abbr, code, amt) => ({
  agency_id: 0, toptier_code: code, abbreviation: abbr, agency_name: name,
  congressional_justification_url: null, active_fy: "2026", active_fq: "3",
  outlay_amount: 0.0, obligated_amount: 0.0,
  budget_authority_amount: amt,
  current_total_budget_authority_amount: GRAND_TOTAL,
  percentage_of_total_budget_authority: amt / GRAND_TOTAL, /* fraction, as the real API returns */
  agency_slug: name.toLowerCase().replace(/[^a-z]+/g, "-")
});
/* deliberately unsorted; 18 rows so the top-15 cut is proven (GSA/NASA/AAHC must be cut) */
const AGENCIES = { results: [
  A("Social Security Administration", "SSA", "028", 1271458624654.02),
  A("Department of the Treasury", "TREAS", "020", 4706789671618.7),
  A("General Services Administration", "GSA", "047", 60123456789.01),
  A("Department of Health and Human Services", "HHS", "075", 3379869865441.37),
  A("Department of Homeland Security", "DHS", "070", 575878745676.5),
  A("400 Years of African-American History Commission", "AAHC", "247", 0.0),
  A("Department of Defense", "DOD", "097", 2098732693771.35),
  A("Department of Veterans Affairs", "VA", "036", 524218701979.48),
  A("Department of Agriculture", "USDA", "012", 476747723527.36),
  A("Office of Personnel Management", "OPM", "024", 384432034909.65),
  A("Department of Housing and Urban Development", "HUD", "086", 332900028580.36),
  A("Department of Transportation", "DOT", "069", 302535938761.91),
  A("National Aeronautics and Space Administration", "NASA", "080", 25412345678.9),
  A("Department of Education", "ED", "091", 154108820235.69),
  A("Federal Deposit Insurance Corporation", "FDIC", "051", 142652409610.84),
  A("Department of Energy", "DOE", "089", 138010121182.66),
  A("Department of State", "DOS", "019", 93977939772.29),
  A("Pension Benefit Guaranty Corporation", "PBGC", "1602", 91080373912.98)
] };
const ST = {
  "06": { name: "California", code: "CA", fips: "06", type: "state",
    population: 39536653, pop_year: 2017,
    pop_source: "U.S. Census Bureau, 2017 Population Estimate",
    median_household_income: 67739.0, mhi_year: 2016,
    mhi_source: "U.S. Census Bureau, 2016 American Community Survey 1-Year Estimates",
    total_prime_amount: 396760302770.75, total_prime_awards: 432673,
    total_face_value_loan_amount: 64706323689.73, total_face_value_loan_prime_awards: 170657,
    award_amount_per_capita: 10035.25, total_outlays: 289841670950.6 },
  /* empty/absent-fields fixture: nulls must render "not reported", never invented numbers */
  "56": { name: "Wyoming", code: "WY", fips: "56", type: "state",
    population: null, pop_year: null, pop_source: null,
    median_household_income: null, mhi_year: null, mhi_source: null,
    total_prime_amount: 6543210987.65, total_prime_awards: 8123,
    total_face_value_loan_amount: null, total_face_value_loan_prime_awards: null,
    award_amount_per_capita: null, total_outlays: null }
};

const API = "https://api.usaspending.gov/**";
const fx = (body, status = 200) => ({
  status, contentType: "application/json",
  headers: { "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body)
});
async function installRoutes(p, hits) {
  await p.route(API, route => {
    const u = route.request().url();
    if (hits) hits.push(u);
    if (u.includes("/references/toptier_agencies/")) return route.fulfill(fx(AGENCIES));
    const m = u.match(/\/api\/v2\/recipient\/state\/(\d{2})\//);
    if (m && ST[m[1]]) return route.fulfill(fx(ST[m[1]]));
    return route.abort(); /* nothing else may be requested (abort -> net::ERR, filtered) */
  });
}

const expect = (cond, what) => { if (!cond) throw new Error("EXPECT FAILED: " + what); };
const agenciesReady = p => p.waitForFunction(
  () => document.querySelectorAll("#agTable tbody tr").length === 15 ||
        !!document.querySelector("#agBox .errcard"), undefined, { timeout: 20000 });
const stateValue = (p, v) => p.waitForFunction(
  want => { const el = document.querySelector("#stBox .stat .v"); return !!el && el.textContent === want; },
  v, { timeout: 20000 });

export async function interact({ page, log, evidenceDir }) {
  /* ---- 1. determinism: stub every endpoint, wipe cache + state, cold boot on fixtures ---- */
  const hits = [];
  await installRoutes(page, hits);
  await page.reload(); /* kills any live in-flight fetches from the harness's initial goto */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("suite.cache.spending.") || k === "suite.state") localStorage.removeItem(k);
  });
  hits.length = 0;
  await page.reload();
  await agenciesReady(page);
  log(`deterministic boot: ${hits.length} stubbed request(s): ${hits.join(" , ")}`);
  expect(hits.some(u => u.endsWith("/api/v2/references/toptier_agencies/")), "agencies endpoint URL");

  /* ---- 2. Panel 1: ranking, top-15 cut, $T/$B formatting, share bars, FY note ---- */
  const rows = await page.$$eval("#agTable tbody tr",
    trs => trs.map(tr => tr.textContent.replace(/\s+/g, " ").trim()));
  expect(rows.length === 15, `15 rows, got ${rows.length}`);
  expect(rows[0].includes("Department of the Treasury") && rows[0].includes("$4.71T") && rows[0].includes("29.7%"),
    `row 1 = Treasury $4.71T 29.7%, got "${rows[0]}"`);
  expect(rows[1].includes("Department of Health and Human Services") && rows[1].includes("$3.38T"),
    `row 2 = HHS $3.38T, got "${rows[1]}"`);
  expect(rows[2].includes("Department of Defense") && rows[2].includes("$2.10T"), `row 3 DOD, got "${rows[2]}"`);
  expect(rows[4].includes("Department of Homeland Security") && rows[4].includes("$575.88B"),
    `row 5 = DHS $575.88B, got "${rows[4]}"`);
  expect(rows[14].includes("Pension Benefit Guaranty Corporation") && rows[14].includes("$91.08B") && rows[14].includes("0.6%"),
    `row 15 = PBGC $91.08B 0.6%, got "${rows[14]}"`);
  expect(!rows.some(r => r.includes("General Services") || r.includes("Aeronautics") || r.includes("African-American")),
    "GSA ($60.1B), NASA ($25.4B) and $0 AAHC cut from the top 15");
  log(`agencies table: 15 rows, sorted desc from an unsorted 18-row fixture`);
  log(`  row 1:  "${rows[0]}"`);
  log(`  row 15: "${rows[14]}"`);
  const widths = await page.$$eval("#agTable .bar i", els => els.map(e => e.style.width));
  expect(parseFloat(widths[0]) === 100, `share bar 1 scaled to max (100%): got ${widths[0]}`);
  expect(parseFloat(widths[1]) === 71.8, `share bar 2 = 3379.87/4706.79 = 71.8%: got ${widths[1]}`);
  log(`share-of-total bars (scaled to largest): [${widths.slice(0, 4).join(", ")} ...]`);
  const fyNote = (await page.textContent("#agFY")).trim();
  expect(fyNote.includes("fiscal year 2026") && fyNote.includes("quarter 3"), `FY note, got "${fyNote}"`);
  log(`fiscal-year note: "${fyNote}"`);
  const agStamp = (await page.textContent("#agStamp")).trim();
  expect(agStamp.startsWith("Fetched"), `fresh agencies stamp, got "${agStamp}"`);
  log(`fresh stamp: "${agStamp}"`);

  /* ---- 3. Panel 2 initial state: no suite.state -> designed empty card ---- */
  const emptyMsg = (await page.textContent("#stBox .card-msg")).trim();
  expect(emptyMsg.includes("Choose your state"), `designed empty state, got "${emptyMsg}"`);
  log(`no suite.state -> designed empty card: "${emptyMsg}"`);

  /* ---- 4. state select -> correct FIPS in URL, stat cards, per-capita, persistence ---- */
  await page.selectOption("#stateSel", "CA");
  await stateValue(page, "$396.76B");
  const stateHit = hits.find(u => u.includes("/recipient/state/"));
  expect(stateHit && stateHit.endsWith("/api/v2/recipient/state/06/?year=latest"),
    `CA -> FIPS 06 in URL, got ${stateHit}`);
  log(`select California -> request URL: ${stateHit} (CA -> FIPS 06, year=latest)`);
  const cards = await page.$$eval("#stBox .stat", els =>
    els.map(e => e.textContent.replace(/\s+/g, " ").trim()));
  expect(cards.length === 4, `4 stat cards, got ${cards.length}`);
  expect(cards[0].includes("$396.76B"), `award $ card, got "${cards[0]}"`);
  expect(cards[1].includes("432,673"), `award count card, got "${cards[1]}"`);
  expect(cards[2].includes("$10,035"), `per-capita card, got "${cards[2]}"`);
  expect(cards[3].includes("Latest 12 months"), `period card, got "${cards[3]}"`);
  log(`CA stat cards: ${cards.map(c => `[${c}]`).join(" ")}`);
  const subnote = (await page.textContent("#stBox .subnote")).trim();
  expect(subnote.includes("39,536,653") && subnote.includes("2017 Population Estimate"),
    `population provenance in subnote, got "${subnote}"`);
  log(`population provenance: "${subnote}"`);
  const link = await page.$eval("#stBox .stlink a", a =>
    ({ href: a.getAttribute("href"), target: a.target, rel: a.rel, text: a.textContent.trim() }));
  expect(link.href === "https://www.usaspending.gov/state/06/latest" &&
         link.target === "_blank" && link.rel === "noopener", `profile link, got ${JSON.stringify(link)}`);
  const leaves = (await page.textContent("#stBox .stlink .leaves")).trim();
  log(`state profile link: ${link.href} target=${link.target} rel=${link.rel} — labeled "${leaves}"`);
  expect(await page.evaluate(() => localStorage.getItem("suite.state")) === "CA",
    "suite.state persisted as bare 'CA'");
  log(`suite.state written: "CA" (bare string, recalls.html-compatible)`);

  /* ---- 5. reload: persisted suite.state honored with no interaction, no refetch ---- */
  const hitsBefore = hits.length;
  await page.reload();
  await agenciesReady(page);
  await stateValue(page, "$396.76B");
  expect(await page.$eval("#stateSel", s => s.value) === "CA", "select restored to CA on reload");
  expect(hits.length === hitsBefore, `reload served from fresh 24h cache, no new requests (${hits.length - hitsBefore} new)`);
  log(`reload -> suite.state honored: select shows CA, cards render with zero interaction and zero new requests`);

  /* ---- 6. absent fields (WY fixture nulls) -> "not reported" ---- */
  await page.selectOption("#stateSel", "WY");
  await stateValue(page, "$6.54B");
  const wy = await page.$$eval("#stBox .stat", els => els.map(e => e.textContent.replace(/\s+/g, " ").trim()));
  expect(wy[0].includes("$6.54B") && wy[1].includes("8,123"), `WY totals, got ${JSON.stringify(wy)}`);
  expect(wy[2].includes("not reported"), `null per-capita -> "not reported", got "${wy[2]}"`);
  const wyNote = (await page.textContent("#stBox .subnote")).trim();
  expect(wyNote.includes("not reported"), `null population -> honest note, got "${wyNote}"`);
  log(`WY (null per-capita/population fixture): cards ${wy.map(c => `[${c}]`).join(" ")}`);
  log(`  population note: "${wyNote}"`);

  /* ---- 7. HTTP error paths on a second page (see header note): 500 and 429 designed cards ---- */
  const errPage = await page.context().newPage();
  const errIssues = [];
  errPage.on("console", m => {
    if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errIssues.push(m.text());
  });
  errPage.on("pageerror", e => errIssues.push(String(e)));
  await errPage.route(API, route => {
    const u = route.request().url();
    if (u.includes("/references/toptier_agencies/")) return route.fulfill(fx(AGENCIES));
    if (u.includes("/recipient/state/48/")) return route.fulfill(fx({ detail: "Internal server error." }, 500));
    if (u.includes("/recipient/state/36/")) return route.fulfill(fx({ detail: "Request was throttled." }, 429));
    return route.abort();
  });
  await errPage.goto(page.url());
  await errPage.selectOption("#stateSel", "TX"); /* FIPS 48, uncached -> HTTP 500 */
  await errPage.waitForSelector("#stBox .errcard", { timeout: 20000 });
  const e500 = (await errPage.textContent("#stBox .errcard")).replace(/\s+/g, " ").trim();
  expect(e500.includes("Couldn't load award data for Texas") && e500.includes("HTTP 500"),
    `designed 500 card, got "${e500}"`);
  expect(!(await errPage.$("#stBox .errcard.rl")), "500 card is NOT the rate-limit variant");
  log(`HTTP 500 (TX) -> designed error card: "${e500}"`);
  await errPage.screenshot({ path: `${evidenceDir}/error-500.png`, fullPage: true });
  await errPage.selectOption("#stateSel", "NY"); /* FIPS 36, uncached -> HTTP 429 */
  await errPage.waitForSelector("#stBox .errcard.rl", { timeout: 20000 });
  const e429 = (await errPage.textContent("#stBox .errcard.rl")).replace(/\s+/g, " ").trim();
  expect(e429.includes("rate-limiting") && e429.includes("HTTP 429"), `designed 429 card, got "${e429}"`);
  log(`HTTP 429 (NY) -> visibly distinct rate-limit card: "${e429}"`);
  await errPage.screenshot({ path: `${evidenceDir}/error-429.png`, fullPage: true });
  expect(errIssues.length === 0,
    `error-path page console clean beyond network-status lines: ${errIssues.join(" | ")}`);
  log(`error-path page console: clean (only Chromium's unavoidable non-2xx network-status lines)`);
  await errPage.evaluate(() => localStorage.setItem("suite.state", "CA")); /* restore for stale phase */
  await errPage.close();

  /* ---- 8. stale-cache offline path: back-date > 24h TTL, block network, reload ---- */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("suite.cache.spending.")) {
        const e = JSON.parse(localStorage.getItem(k));
        e.t = Date.now() - 25 * 60 * 60 * 1000;
        localStorage.setItem(k, JSON.stringify(e));
      }
  });
  await page.route(/^https?:/, r => r.abort()); /* registered last -> takes precedence */
  await page.reload();
  await agenciesReady(page);
  await stateValue(page, "$396.76B");
  await page.waitForFunction(() =>
    document.getElementById("agStamp").textContent.startsWith("Offline — cached from") &&
    document.getElementById("stStamp").textContent.startsWith("Offline — cached from"),
    undefined, { timeout: 20000 });
  log(`offline + stale cache -> both panels render cached data with stamps:`);
  log(`  agencies: "${(await page.textContent("#agStamp")).trim()}"`);
  log(`  state:    "${(await page.textContent("#stStamp")).trim()}"`);
  await page.screenshot({ path: `${evidenceDir}/offline-stale.png`, fullPage: true });
  await page.unroute(/^https?:/); /* fixture routes still installed underneath */

  /* ---- 9. restore a fresh-cache view (no refetch), then a11y + mobile ---- */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("suite.cache.spending.")) {
        const e = JSON.parse(localStorage.getItem(k));
        e.t = Date.now();
        localStorage.setItem(k, JSON.stringify(e));
      }
  });
  await page.reload();
  await agenciesReady(page);
  await stateValue(page, "$396.76B");

  const a11y = await page.evaluate(() => ({
    selectLabel: (document.querySelector('label[for="stateSel"]') || {}).textContent || null,
    agLive: document.getElementById("agBox").getAttribute("aria-live"),
    stLive: document.getElementById("stBox").getAttribute("aria-live"),
    themeLabel: document.getElementById("themeBtn").getAttribute("aria-label"),
    themePressed: document.getElementById("themeBtn").getAttribute("aria-pressed"),
    favPressed: (document.querySelector(".fav-btn") || {}).getAttribute
      ? document.querySelector(".fav-btn").getAttribute("aria-pressed") : null,
    barsDecorative: [...document.querySelectorAll("#agTable .bar")]
      .every(b => b.getAttribute("aria-hidden") === "true")
  }));
  expect(a11y.selectLabel === "Your state", `select <label for>, got ${JSON.stringify(a11y.selectLabel)}`);
  expect(a11y.agLive === "polite" && a11y.stLive === "polite", "both async panels are aria-live=polite");
  expect(!!a11y.themeLabel && a11y.themePressed !== null, "theme button labeled with aria-pressed");
  expect(a11y.barsDecorative, "share bars aria-hidden (the % text carries the value)");
  log(`a11y: label[for=stateSel]="${a11y.selectLabel}", #agBox/#stBox aria-live=${a11y.agLive}/${a11y.stLive}, ` +
    `theme aria-label="${a11y.themeLabel}" aria-pressed=${a11y.themePressed}, fav aria-pressed=${a11y.favPressed}, ` +
    `bars aria-hidden=${a11y.barsDecorative}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mob = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth, docClient: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth, tableScrolls: document.querySelector(".table-scroll").scrollWidth
  }));
  expect(mob.docScroll <= mob.docClient, `no horizontal overflow at 390px: ${mob.docScroll} > ${mob.docClient}`);
  log(`mobile 390px: document scrollWidth ${mob.docScroll} <= clientWidth ${mob.docClient} (no body overflow; ` +
    `wide table scrolls inside its own container)`);
  await page.screenshot({ path: `${evidenceDir}/mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
}
