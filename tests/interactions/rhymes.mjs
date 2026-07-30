/* tests/interactions/rhymes.mjs — Rhyme & Word Finder (v4, cors-open, api.datamuse.com)

   Fully offline-deterministic: every api.datamuse.com request is route-fulfilled with
   fixtures copied from a real probe of /words?rel_rhy=day&md=ps (2026-07-30). Covered:
   - rel_rhy "day" -> syllable-grouped results (1/2/3-syllable headers, chip counts)
   - chip click re-queries the clicked word with the same relation (URL tracked)
   - fresh-cache re-search issues NO request (URL count unchanged)
   - relation switch to "Means like" changes the query param (ml=day) + POS mini-chips
   - copy-all with navigator.clipboard removed -> textarea fallback, no throw
   - empty fixture -> designed no-matches card
   - 500 and 429 fixtures on a SIBLING PAGE (launches.mjs pattern: Chrome logs HTTP-4xx/5xx
     resource loads as console errors; the harness fails on non-net::ERR console errors,
     so deliberate error fixtures stay off the harness's listener)
   - stale path: cache back-dated 8 d (> 7 d TTL), all http(s) aborted -> stale stamp
   - cache key suite.cache.rhymes.rel_rhy.day in localStorage, {t, v} envelope
   - a11y: aria-pressed on relation buttons, labelled search input
   - mobile 390px: no horizontal overflow, mobile.png */

export const selectors = [
  "body", ".topbar", ".back", ".theme-btn", "header h1", "header .tag",
  "#q", "#go", "#rels", ".relbtn", "#results", ".msg", "footer"
];

export const screenshotAfterInteract = true;

/* fixture shapes copied from a live probe:
   [{"word":"convey","score":66045,"numSyllables":2,"tags":["v"]}, ...] */
const FIX_DAY = [
  { word: "convey",    score: 66045, numSyllables: 2, tags: ["v"] },
  { word: "display",   score: 56049, numSyllables: 2, tags: ["n", "v"] },
  { word: "dismay",    score: 49034, numSyllables: 2, tags: ["n", "v"] },
  { word: "sobriquet", score: 38037, numSyllables: 3, tags: ["n"] },
  { word: "disarray",  score: 37032, numSyllables: 3, tags: ["n", "v"] },
  { word: "allay",     score: 33034, numSyllables: 2, tags: ["v", "n"] },
  { word: "gray",      score: 32052, numSyllables: 1, tags: ["adj", "n", "v"] },
  { word: "decay",     score: 29055, numSyllables: 2, tags: ["n", "v"] },
  { word: "way",       score: 28040, numSyllables: 1, tags: ["n", "adv"] },
  { word: "they",      score: 27031, numSyllables: 1, tags: ["u"] }
]; // groups: 1 syll x3 (gray, way, they) · 2 syll x5 · 3 syll x2
const FIX_GRAY = [
  { word: "day",    score: 51043, numSyllables: 1, tags: ["n"] },
  { word: "play",   score: 45038, numSyllables: 1, tags: ["n", "v"] },
  { word: "stay",   score: 41034, numSyllables: 1, tags: ["n", "v"] },
  { word: "convey", score: 30021, numSyllables: 2, tags: ["v"] }
];
const FIX_ML_DAY = [ // ml tags mix POS with metadata ("syn", "results_type:…") — only POS may chip
  { word: "daytime",      score: 3006, numSyllables: 2, tags: ["syn", "n", "results_type:primary_rel"] },
  { word: "sidereal day", score: 2005, numSyllables: 4, tags: ["syn", "n"] },
  { word: "daylight",     score: 1004, numSyllables: 2, tags: ["syn", "n"] },
  { word: "solar",        score: 904,  numSyllables: 2, tags: ["adj"] }
];

const isDatamuse = u => u.hostname === "api.datamuse.com";
function makeHandler(urls) {
  return route => {
    const u = new URL(route.request().url());
    urls.push(u.search);
    const q = k => u.searchParams.get(k);
    let status = 200, body = "[]";
    if (q("rel_rhy") === "day")       body = JSON.stringify(FIX_DAY);
    else if (q("rel_rhy") === "gray") body = JSON.stringify(FIX_GRAY);
    else if (q("ml") === "day")       body = JSON.stringify(FIX_ML_DAY);
    else if (u.search.includes("=kaboom"))  { status = 500; body = "server error"; }
    else if (u.search.includes("=toofast")) { status = 429; body = "rate limit exceeded"; }
    return route.fulfill({ status, contentType: "application/json", body });
  };
}

const groupInfo = p => p.evaluate(() =>
  [...document.querySelectorAll("#results .group")].map(g => ({
    h: g.querySelector("h3") ? g.querySelector("h3").textContent : "(no header)",
    chips: g.querySelectorAll(".word-chip").length
  })));
const countLine = p => p.evaluate(() => {
  const c = document.querySelector("#results .count");
  return c ? c.textContent.trim() : "(no count line)";
});

export async function interact({ page, log, evidenceDir }) {
  const urls = [];
  await page.route(isDatamuse, makeHandler(urls));

  /* ---- designed initial state ---- */
  const idle = await page.evaluate(() => ({
    msg: !!document.querySelector("#results .msg"),
    examples: [...document.querySelectorAll("#results .word-chip")].map(c => c.textContent.trim())
  }));
  if (!idle.msg || idle.examples.length !== 4)
    throw new Error("initial designed state missing: " + JSON.stringify(idle));
  log(`initial designed state: prompt card with example chips [${idle.examples.join(", ")}]`);

  /* ---- Enter submits: rel_rhy "day" -> syllable-grouped results ---- */
  await page.fill("#q", "day");
  await page.press("#q", "Enter");
  await page.waitForFunction(() => document.querySelectorAll("#results .group").length === 3,
    undefined, { timeout: 15000 });
  if (urls.length !== 1 || !urls[0].includes("rel_rhy=day") ||
      !urls[0].includes("max=80") || !urls[0].includes("md=ps"))
    throw new Error("unexpected request(s): " + JSON.stringify(urls));
  log(`Enter submit -> 1 request, query string "${urls[0]}" (rel_rhy=day&max=80&md=ps)`);
  const g1 = await groupInfo(page);
  log(`count line: "${await countLine(page)}"`);
  log(`syllable groups: ${g1.map(g => `"${g.h}" (${g.chips} chips)`).join(" · ")}`);
  const want = [["1 syllable · 3", 3], ["2 syllables · 5", 5], ["3 syllables · 2", 2]];
  want.forEach(([h, n], i) => {
    if (g1[i].h !== h || g1[i].chips !== n)
      throw new Error(`group ${i} mismatch: got ${JSON.stringify(g1[i])}, want "${h}"/${n}`);
  });

  /* ---- a11y: relation buttons carry aria-pressed; search input is labelled ---- */
  const a11y = await page.evaluate(() => ({
    rels: [...document.querySelectorAll("#rels .relbtn")].map(b =>
      `${b.textContent}=${b.getAttribute("aria-pressed")}`),
    pressed: document.querySelectorAll('#rels .relbtn[aria-pressed="true"]').length,
    qLabel: document.getElementById("q").getAttribute("aria-label"),
    groupRole: document.getElementById("rels").getAttribute("role")
  }));
  if (a11y.pressed !== 1 || a11y.rels.length !== 9 || !a11y.qLabel || a11y.groupRole !== "group")
    throw new Error("a11y check failed: " + JSON.stringify(a11y));
  log(`a11y: 9 relation buttons, exactly one aria-pressed=true — [${a11y.rels.join(", ")}]`);
  log(`a11y: input aria-label="${a11y.qLabel}", #rels role="${a11y.groupRole}"`);

  /* ---- cache key + envelope ---- */
  const env = await page.evaluate(() => {
    const raw = localStorage.getItem("suite.cache.rhymes.rel_rhy.day");
    if (!raw) return null;
    const e = JSON.parse(raw);
    return { hasT: typeof e.t === "number", words: Array.isArray(e.v) ? e.v.length : "not-array" };
  });
  if (!env || !env.hasT || env.words !== 10)
    throw new Error("cache envelope wrong: " + JSON.stringify(env));
  log(`cache written: suite.cache.rhymes.rel_rhy.day = {t, v[${env.words}]}`);

  /* ---- chip click re-queries the clicked word, same relation ---- */
  await page.click('#results .word-chip:has-text("gray")');
  await page.waitForFunction(() => {
    const c = document.querySelector("#results .count");
    return c && c.textContent.includes("“gray”");
  }, undefined, { timeout: 15000 });
  if (urls.length !== 2 || !urls[1].includes("rel_rhy=gray"))
    throw new Error("chip click did not re-query: " + JSON.stringify(urls));
  log(`chip "gray" click -> input="${await page.inputValue("#q")}", request "${urls[1]}", ` +
    `count line "${await countLine(page)}"`);

  /* ---- fresh cache: re-searching "day" issues NO request ---- */
  await page.fill("#q", "day");
  await page.press("#q", "Enter");
  await page.waitForFunction(() => document.querySelectorAll("#results .group").length === 3,
    undefined, { timeout: 15000 });
  if (urls.length !== 2) throw new Error("cache-fresh re-search hit the network: " + JSON.stringify(urls));
  log(`re-search "day" within 7-day TTL -> served from cache, request count still ${urls.length}`);

  /* ---- relation switch changes the query param; POS mini-chips on meaning results ---- */
  await page.click('#rels .relbtn[data-rel="ml"]');
  await page.waitForFunction(() => {
    const c = document.querySelector("#results .count");
    return c && c.textContent.includes("means like");
  }, undefined, { timeout: 15000 });
  if (urls.length !== 3 || !urls[2].includes("ml=day") || urls[2].includes("rel_rhy"))
    throw new Error("relation switch request wrong: " + JSON.stringify(urls));
  log(`relation switch to "Means like" -> re-query with same word: "${urls[2]}"`);
  const pos = await page.evaluate(() =>
    [...document.querySelectorAll("#results .word-chip")].map(c => ({
      w: c.querySelector("span").textContent,
      pos: [...c.querySelectorAll(".pos")].map(p => p.textContent)
    })));
  log(`POS mini-chips: ${pos.map(x => `${x.w}[${x.pos.join(",")}]`).join(" · ")}`);
  const solar = pos.find(x => x.w === "solar"), daytime = pos.find(x => x.w === "daytime");
  if (!solar || solar.pos.join() !== "adj" || !daytime || daytime.pos.join() !== "n")
    throw new Error("POS chips wrong (metadata tags must not chip): " + JSON.stringify(pos));
  const mlPressed = await page.evaluate(() =>
    [...document.querySelectorAll('#rels .relbtn[aria-pressed="true"]')].map(b => b.textContent));
  if (mlPressed.join() !== "Means like") throw new Error("aria-pressed did not move: " + mlPressed);
  log(`aria-pressed moved with the switch: now [${mlPressed.join(", ")}]`);

  /* ---- copy-all: clipboard API removed -> textarea fallback, no throw ---- */
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
  await page.click("#copyBtn");
  const copyNote = (await page.textContent("#copyNote")).trim();
  if (!/^(Copied 4 words|Copy blocked)/.test(copyNote))
    throw new Error("copy feedback missing/unexpected: " + JSON.stringify(copyNote));
  log(`copy-all with navigator.clipboard removed -> fallback ran, note: "${copyNote}"`);

  /* ---- empty results -> designed no-matches card ---- */
  await page.fill("#q", "zzzz");
  await page.press("#q", "Enter");
  await page.waitForSelector("#results .msg.nomatch", { timeout: 15000 });
  log(`empty fixture (ml=zzzz) -> designed no-match card: ` +
    `"${(await page.textContent("#results .msg.nomatch")).replace(/\s+/g, " ").trim()}"`);
  if (!urls[3] || !urls[3].includes("ml=zzzz"))
    throw new Error("empty-path request wrong: " + JSON.stringify(urls));

  /* ---- 500 + 429 error cards on a sibling page (keeps HTTP-error console noise
          off the harness's fail-on-console listener; shared file:// localStorage) ---- */
  const p2 = await page.context().newPage();
  await p2.route(isDatamuse, makeHandler(urls));
  await p2.goto(page.url());
  await p2.fill("#q", "kaboom");
  await p2.press("#q", "Enter");
  await p2.waitForSelector("#results .msg.err", { timeout: 15000 });
  const err500 = (await p2.textContent("#results .msg.err")).replace(/\s+/g, " ").trim();
  if (!err500.includes("HTTP 500")) throw new Error("500 error card wrong: " + err500);
  log(`route-fulfilled 500 -> designed error card: "${err500}"`);
  await p2.fill("#q", "toofast");
  await p2.press("#q", "Enter");
  await p2.waitForFunction(() => {
    const e = document.querySelector("#results .msg.err");
    return e && e.textContent.includes("Rate-limited");
  }, undefined, { timeout: 15000 });
  const err429 = (await p2.textContent("#results .msg.err")).replace(/\s+/g, " ").trim();
  log(`route-fulfilled 429 -> distinct rate-limit card: "${err429}"`);
  await p2.screenshot({ path: `${evidenceDir}/error-cards.png`, fullPage: true });
  await p2.close();

  /* ---- stale path: back-date the cache 8 d (> 7 d TTL), abort all http(s) ---- */
  await page.click('#rels .relbtn[data-rel="rel_rhy"]'); // back to Rhymes (re-queries "zzzz" -> [])
  await page.waitForSelector("#results .msg.nomatch", { timeout: 15000 });
  await page.evaluate(() => {
    const k = "suite.cache.rhymes.rel_rhy.day";
    const e = JSON.parse(localStorage.getItem(k));
    e.t = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(k, JSON.stringify(e));
  });
  await page.unroute(isDatamuse);
  await page.context().route(/^https?:/, r => r.abort());
  await page.fill("#q", "day");
  await page.press("#q", "Enter");
  await page.waitForSelector("#results .stale", { timeout: 15000 });
  const stamp = (await page.textContent("#results .stale")).trim();
  if (!stamp.startsWith("Offline — cached results from"))
    throw new Error("stale stamp wrong: " + stamp);
  const gStale = await groupInfo(page);
  log(`offline + expired cache -> stale results render with stamp: "${stamp}"`);
  log(`  stale view still grouped: ${gStale.map(g => `"${g.h}" (${g.chips})`).join(" · ")}`);
  await page.screenshot({ path: `${evidenceDir}/offline-stale.png`, fullPage: true });
  await page.context().unroute(/^https?:/);
  await page.route(isDatamuse, makeHandler(urls)); // never risk a live hit afterwards

  /* ---- restore a fresh-cache view (no refetch) for the after-interaction shot ---- */
  await page.evaluate(() => {
    const k = "suite.cache.rhymes.rel_rhy.day";
    const e = JSON.parse(localStorage.getItem(k));
    e.t = Date.now();
    localStorage.setItem(k, JSON.stringify(e));
  });
  await page.press("#q", "Enter");
  await page.waitForFunction(() =>
    document.querySelectorAll("#results .group").length === 3 &&
    !document.querySelector("#results .stale"), undefined, { timeout: 15000 });
  log(`restored fresh-cache view, no stale stamp, count line: "${await countLine(page)}"`);

  /* ---- mobile: 390 px, no horizontal overflow ---- */
  await page.setViewportSize({ width: 390, height: 844 });
  const mob = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    bodySw: document.body.scrollWidth
  }));
  if (mob.sw > mob.cw || mob.bodySw > mob.cw)
    throw new Error("horizontal overflow at 390px: " + JSON.stringify(mob));
  log(`mobile 390x844: scrollWidth ${mob.sw} <= clientWidth ${mob.cw} (no horizontal overflow)`);
  await page.screenshot({ path: `${evidenceDir}/mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  log(`total stubbed datamuse requests: ${urls.length} — [${urls.join(" | ")}]`);
}
