/* tests/interactions/nasaimages.mjs — NASA Image Library (v4, cors-open)

   Fully offline-deterministic: every images-api.nasa.gov and images-assets.nasa.gov
   request is route-fulfilled with fixtures copied from live probes (2026-07-30 —
   ACAO * on both hosts; the /asset manifest really returns http:// hrefs, which the
   tool must upgrade to https). Exercised paths:
   - starter state with 3 suggested-search chips, chip triggers a search
   - Enter-submitted search -> 3-tile grid, thumbs decode (naturalWidth>0), alt text,
     center chips, "page 1 of 40 · 956 results" math from metadata.total_hits
   - unsafe-URL filtering: an http:// search thumbnail is dropped (designed no-preview)
   - pagination: next -> page=2 request URL, prev -> page 1 served from cache (no refetch)
   - detail overlay: asset manifest -> ~medium.jpg picked and upgraded to https, honest
     credit line (photographer / secondary_creator / default NASA), nasa_id, labeled
     external link, Esc closes + focus returns to the opening tile
   - empty results -> designed card; 500 and 429 -> distinct error cards (sibling
     context so the expected resource-load console lines never touch the main gate)
   - stale path: caches back-dated 48 h (> 24 h TTL), API aborted -> results + detail
     both render with visible "Offline — cached from …" stamps
   - storage keys, a11y (labels, roles, live regions), 390 px mobile no-overflow */

export const selectors = [
  "body", "header h1", ".theme-btn", "footer", ".search", ".yearrow",
  "#status", ".pager", ".starter", "#grid"
];
export const screenshotAfterInteract = true;

const PNG1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const A = "https://images-assets.nasa.gov";

/* fixture shapes copied from the live search probe (collection.items[].data[0] + links[0]) */
function item(nasa_id, title, date, center, description, extra, thumbHref){
  return {
    href: `${A}/image/${nasa_id}/collection.json`,
    data: [Object.assign({
      center, date_created: date, description, media_type: "image", nasa_id, title,
      keywords: ["Apollo", "Moon"]
    }, extra)],
    links: [{ href: thumbHref, rel: "preview", render: "image" }]
  };
}
const ITEMS = [
  item("as11-40-5874", "Aldrin on the Moon", "1969-07-20T00:00:00Z", "JSC",
    "Astronaut Buzz Aldrin walks on the surface of the Moon near the leg of the Lunar Module Eagle.",
    { photographer: "Neil Armstrong" },
    `${A}/image/as11-40-5874/as11-40-5874~thumb.jpg`),
  item("GPN-2000-001137", "Earthrise", "1968-12-24T00:00:00Z", "HQ",
    "The rising Earth above the lunar horizon, photographed during the Apollo 8 mission.",
    { secondary_creator: "NASA/Bill Anders" },
    `${A}/image/GPN-2000-001137/GPN-2000-001137~thumb.jpg`),
  item("http-thumb-record", "Insecure thumbnail record", "1970-04-11T00:00:00Z", "KSC",
    "This record's preview link is plain http and must never reach an img src.",
    {},
    `http://images-assets.nasa.gov/image/http-thumb-record/http-thumb-record~thumb.jpg`)
];
const ITEM_P2 = item("PIA00452", "Earth - Pale Blue Dot", "1996-09-08T00:00:00Z", "JPL",
  "This narrow-angle color image of the Earth is a part of the first ever solar system portrait.",
  {}, `${A}/image/PIA00452/PIA00452~thumb.jpg`);
const RACE_SLOW = item("race-slow", "Older delayed search result", "2001-01-01T00:00:00Z", "JSC",
  "This response must not replace a newer search.", {}, `${A}/image/race-slow/race-slow~thumb.jpg`);
const RACE_FAST = item("race-fast", "Newest fast search result", "2002-01-01T00:00:00Z", "JPL",
  "This is the current search response.", {}, `${A}/image/race-fast/race-fast~thumb.jpg`);

function searchBody(items, total){
  return { collection: { version: "1.1", href: "http://images-api.nasa.gov/search",
    items, metadata: { total_hits: total }, links: [] } };
}
/* the live /asset probe returns http:// hrefs — reproduced faithfully here */
const ASSET_ITEMS = {
  "as11-40-5874": [
    { href: "http://images-assets.nasa.gov/image/as11-40-5874/as11-40-5874~orig.tif" },
    { href: "http://images-assets.nasa.gov/image/as11-40-5874/as11-40-5874~large.jpg" },
    { href: "http://images-assets.nasa.gov/image/as11-40-5874/as11-40-5874~medium.jpg" },
    { href: "http://images-assets.nasa.gov/image/as11-40-5874/as11-40-5874~small.jpg" },
    { href: "http://images-assets.nasa.gov/image/as11-40-5874/metadata.json" }
  ],
  "GPN-2000-001137": [
    { href: "http://images-assets.nasa.gov/image/GPN-2000-001137/GPN-2000-001137~orig.jpg" },
    { href: "http://images-assets.nasa.gov/image/GPN-2000-001137/metadata.json" }
  ]
};
const jsonResp = body => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const SEARCH_RE = /^https:\/\/images-api\.nasa\.gov\/search\?/;
const ASSET_RE = /^https:\/\/images-api\.nasa\.gov\/asset\//;
const IMG_RE = /^https:\/\/images-assets\.nasa\.gov\//;
const API_RE = /^https:\/\/images-api\.nasa\.gov\//;

async function waitThumbsDecoded(page, n){
  await page.waitForFunction(want => {
    const imgs = [...document.querySelectorAll("#grid .tile img")];
    return imgs.length === want && imgs.every(i => i.complete && i.naturalWidth > 0);
  }, n, { timeout: 15000 });
}
const statusText = page => page.textContent("#status");
async function expect(cond, msg){ if (!cond) throw new Error("EXPECT FAILED: " + msg); }

export async function interact({ page, log, evidenceDir }) {
  const searchCalls = [];
  let releaseSlowSearch;
  const slowSearchResponse = new Promise(resolve => { releaseSlowSearch = resolve; });
  async function installRoutes(p){
    await p.route(SEARCH_RE, async r => {
      const u = new URL(r.request().url());
      searchCalls.push(u.href);
      const q = u.searchParams.get("q");
      if (q === "older delayed") {
        await slowSearchResponse;
        return r.fulfill(jsonResp(searchBody([RACE_SLOW], 1)));
      }
      if (q === "newest fast") return r.fulfill(jsonResp(searchBody([RACE_FAST], 1)));
      if (q === "nothingfound") return r.fulfill(jsonResp(searchBody([], 0)));
      if (u.searchParams.get("page") === "2") return r.fulfill(jsonResp(searchBody([ITEM_P2], 956)));
      return r.fulfill(jsonResp(searchBody(ITEMS, 956)));
    });
    await p.route(ASSET_RE, r => {
      const id = decodeURIComponent(new URL(r.request().url()).pathname.split("/").pop());
      return r.fulfill(jsonResp({ collection: { version: "1.1", href: "http://images-api.nasa.gov/asset/" + id,
        items: ASSET_ITEMS[id] || [{ href: `http://images-assets.nasa.gov/image/${id}/${id}~medium.jpg` }] } }));
    });
    await p.route(IMG_RE, r => r.fulfill({ status: 200, contentType: "image/png", body: PNG1x1 }));
  }
  await installRoutes(page);

  /* ---- 1. starter state ---- */
  const chips = await page.$$eval(".chiprow .chipbtn", els => els.map(e => e.textContent.trim()));
  await expect((await page.isVisible("#starter")), "starter card visible before any search");
  await expect(chips.join("|") === "Apollo 11|Hubble deep field|Artemis", "3 suggested chips: " + chips.join("|"));
  await expect((await page.$$("#grid .tile")).length === 0, "grid empty at boot");
  log(`starter state: designed card visible, suggested chips [${chips.join(", ")}], grid empty, zero network at boot`);

  /* ---- 2. Enter-submitted search: grid, thumbs, alt, unsafe filter, total math ---- */
  await page.fill("#q", "Apollo 11");
  await page.press("#q", "Enter");
  await page.waitForFunction(() => document.querySelectorAll("#grid .tile").length === 3, undefined, { timeout: 15000 });
  await waitThumbsDecoded(page, 2);
  const st1 = (await statusText(page)).trim();
  await expect(/page 1 of 40 · 956 results/.test(st1), `total_hits math in status: "${st1}"`);
  log(`search "Apollo 11" (Enter submits) -> 3 tiles; status: "${st1}" (ceil(956/24)=40 pages)`);
  const thumbs = await page.$$eval("#grid .tile img", imgs =>
    imgs.map(i => ({ alt: i.alt, src: i.src, w: i.naturalWidth })));
  await expect(thumbs.length === 2 && thumbs.every(t => t.w > 0), "2 safe thumbnails decoded naturalWidth>0");
  await expect(thumbs[0].alt === "Aldrin on the Moon" && thumbs[1].alt === "Earthrise", "alt text from record titles");
  await expect(thumbs.every(t => t.src.startsWith("https://images-assets.nasa.gov/")), "thumb srcs https on images-assets.nasa.gov");
  log(`thumbnails decoded: ${thumbs.map(t => `"${t.alt}" (naturalWidth=${t.w})`).join(", ")}`);
  const unsafe = await page.$eval("#grid .tile:nth-child(3)", el =>
    ({ imgs: el.querySelectorAll("img").length, ph: el.querySelector(".ph").textContent.trim(), label: el.getAttribute("aria-label") }));
  const anyHttpImg = await page.$$eval("img", imgs => imgs.filter(i => /^http:\/\//.test(i.getAttribute("src") || "")).length);
  await expect(unsafe.imgs === 0 && unsafe.ph === "No preview" && anyHttpImg === 0, "http:// thumbnail dropped: " + JSON.stringify(unsafe));
  log(`unsafe-URL filter: http:// thumbnail record rendered as designed "${unsafe.ph}" tile, 0 http:// img src on page`);
  const centerChip = await page.textContent("#grid .tile:nth-child(1) .chip");
  await expect(centerChip.trim() === "JSC", "center chip on tile: " + centerChip);
  const key1 = await page.evaluate(() => localStorage.getItem("suite.cache.nasaimages.q.apollo-11.1") !== null);
  await expect(key1, "cache key suite.cache.nasaimages.q.apollo-11.1 written");
  log(`center chip "JSC" on tile 1; cache key suite.cache.nasaimages.q.apollo-11.1 written (TTL 24 h)`);
  await page.screenshot({ path: `${evidenceDir}/results.png`, fullPage: true });

  /* ---- 3. pagination ---- */
  const callsBefore = searchCalls.length;
  await page.click("#nextBtn");
  await page.waitForFunction(() => /page 2 of 40/.test(document.getElementById("status").textContent), undefined, { timeout: 15000 });
  const p2url = searchCalls[searchCalls.length - 1];
  await expect(/q=Apollo%2011/.test(p2url) && /page=2/.test(p2url) && /media_type=image/.test(p2url) && /page_size=24/.test(p2url),
    "page-2 request URL: " + p2url);
  await expect((await page.$$("#grid .tile")).length === 1, "page 2 renders its own items");
  log(`next -> "${(await statusText(page)).trim()}"; request URL: ${p2url}`);
  await page.click("#prevBtn");
  await page.waitForFunction(() => /page 1 of 40/.test(document.getElementById("status").textContent), undefined, { timeout: 15000 });
  await expect(searchCalls.length === callsBefore + 1, "prev to page 1 served from fresh cache (no refetch)");
  await expect((await page.locator("#prevBtn").isDisabled()), "prev disabled on page 1");
  log(`prev -> page 1 of 40 served from cache (search fetches: ${searchCalls.length - callsBefore} for the round-trip); prev disabled on page 1`);

  /* ---- 4. overlapping searches: an older delayed response cannot overwrite the newest ---- */
  const slowRequest = page.waitForRequest(req =>
    req.url().startsWith("https://images-api.nasa.gov/search?") &&
    new URL(req.url()).searchParams.get("q") === "older delayed");
  await page.fill("#q", "older delayed");
  await page.press("#q", "Enter");
  await slowRequest;
  await page.fill("#q", "newest fast");
  await page.press("#q", "Enter");
  await page.waitForFunction(() =>
    document.querySelector("#grid .tile b")?.textContent === "Newest fast search result");
  releaseSlowSearch();
  await page.waitForTimeout(250);
  const raceWinner = await page.evaluate(() => ({
    title: document.querySelector("#grid .tile b")?.textContent,
    tiles: document.querySelectorAll("#grid .tile").length,
    status: document.getElementById("status").textContent.trim()
  }));
  await expect(raceWinner.title === "Newest fast search result" && raceWinner.tiles === 1,
    "older response overwrote newer NASA search: " + JSON.stringify(raceWinner));
  log(`overlap guard: delayed "older delayed" completed last; UI stayed on "newest fast": ${JSON.stringify(raceWinner)}`);
  await page.fill("#q", "Apollo 11");
  await page.press("#q", "Enter");
  await page.waitForFunction(() => document.querySelectorAll("#grid .tile").length === 3);

  /* ---- 5. detail flow: medium variant, https upgrade, credit, Esc + focus return ---- */
  await waitThumbsDecoded(page, 2);
  await page.click("#grid .tile:nth-child(1)");
  await page.waitForFunction(() => {
    const i = document.querySelector("#detailFrame img");
    return i && i.complete && i.naturalWidth > 0;
  }, undefined, { timeout: 15000 });
  const detail = await page.evaluate(() => ({
    src: document.querySelector("#detailFrame img").src,
    title: document.getElementById("detailTitle").textContent,
    credit: document.getElementById("detailCredit").textContent,
    id: document.getElementById("detailId").textContent,
    date: document.getElementById("detailMeta").textContent.trim().slice(0, 10),
    link: { href: document.getElementById("detailLink").href,
      target: document.getElementById("detailLink").target,
      rel: document.getElementById("detailLink").rel,
      text: document.getElementById("detailLink").textContent },
    role: document.getElementById("overlay").getAttribute("role"),
    modal: document.getElementById("overlay").getAttribute("aria-modal"),
    focused: document.activeElement === document.getElementById("closeBtn")
  }));
  await expect(detail.src === "https://images-assets.nasa.gov/image/as11-40-5874/as11-40-5874~medium.jpg",
    "~medium.jpg picked from the asset manifest and upgraded http->https: " + detail.src);
  await expect(detail.credit === "Credit: Neil Armstrong", "photographer credit line: " + detail.credit);
  await expect(detail.id === "as11-40-5874" && detail.date === "1969-07-20", "nasa_id + date shown");
  await expect(detail.link.href === "https://images.nasa.gov/details/as11-40-5874" &&
    detail.link.target === "_blank" && detail.link.rel === "noopener" && /images\.nasa\.gov/.test(detail.link.text),
    "labeled external link: " + JSON.stringify(detail.link));
  await expect(detail.role === "dialog" && detail.modal === "true" && detail.focused,
    "dialog semantics + focus moved to close button");
  log(`detail "as11-40-5874": image ${detail.src} (manifest served http://, upgraded), credit "${detail.credit}", date ${detail.date}`);
  log(`  external link ${detail.link.href} target=_blank rel=noopener; role=dialog aria-modal=true, focus on close button`);
  const assetKey = await page.evaluate(() => localStorage.getItem("suite.cache.nasaimages.asset.as11-40-5874") !== null);
  await expect(assetKey, "cache key suite.cache.nasaimages.asset.as11-40-5874 written");
  await page.screenshot({ path: `${evidenceDir}/detail.png` });
  await page.keyboard.press("Escape");
  const afterEsc = await page.evaluate(() => ({
    open: document.getElementById("overlay").classList.contains("show"),
    focusLabel: document.activeElement && document.activeElement.getAttribute("aria-label")
  }));
  await expect(!afterEsc.open && afterEsc.focusLabel === "Open details: Aldrin on the Moon",
    "Esc closes + focus returns to opening tile: " + JSON.stringify(afterEsc));
  log(`Esc closed the overlay and focus returned to the opening tile ("${afterEsc.focusLabel}"); asset cache key written`);

  /* ---- 5. detail credit fallbacks: secondary_creator, then default NASA ---- */
  await page.click("#grid .tile:nth-child(2)");
  await page.waitForFunction(() => {
    const i = document.querySelector("#detailFrame img");
    return i && i.complete && i.naturalWidth > 0;
  }, undefined, { timeout: 15000 });
  const d2 = await page.evaluate(() => ({
    src: document.querySelector("#detailFrame img").src,
    credit: document.getElementById("detailCredit").textContent }));
  await expect(d2.src === "https://images-assets.nasa.gov/image/GPN-2000-001137/GPN-2000-001137~orig.jpg",
    "no ~medium in manifest -> ~orig.jpg fallback: " + d2.src);
  await expect(d2.credit === "Credit: NASA/Bill Anders", "secondary_creator credit: " + d2.credit);
  await page.click("#closeBtn");
  const f2 = await page.evaluate(() => document.activeElement.getAttribute("aria-label"));
  await expect(f2 === "Open details: Earthrise", "close button also returns focus: " + f2);
  log(`detail "GPN-2000-001137": ~orig.jpg fallback (${d2.src}), credit "${d2.credit}" (secondary_creator); close button returns focus`);
  await page.click("#grid .tile:nth-child(3)");
  await page.waitForFunction(() => document.getElementById("detailCredit").textContent.length > 0, undefined, { timeout: 15000 });
  const d3credit = await page.textContent("#detailCredit");
  await expect(d3credit === "Credit: NASA", "default credit line: " + d3credit);
  log(`detail with no photographer/secondary_creator -> honest default "${d3credit}"`);
  await page.keyboard.press("Escape");

  /* ---- 6. empty results -> designed state ---- */
  await page.fill("#q", "nothingfound");
  await page.press("#q", "Enter");
  await page.waitForSelector("#msg:not([hidden])", { timeout: 15000 });
  const emptyCard = await page.evaluate(() => ({
    h2: document.querySelector("#msg h2").textContent, p: document.querySelector("#msg p").textContent,
    status: document.getElementById("status").textContent.trim() }));
  await expect(/No images found for “nothingfound”/.test(emptyCard.h2) && /broader terms/.test(emptyCard.p) &&
    emptyCard.status === "0 results", "designed empty state: " + JSON.stringify(emptyCard));
  log(`empty results -> designed card "${emptyCard.h2}" with guidance; status "${emptyCard.status}"`);

  /* ---- 7. suggested-search chip works after reload (starter returns; no persisted query) ---- */
  await page.reload();
  await page.waitForSelector("#starter", { timeout: 15000 });
  await expect((await page.isVisible("#starter")), "starter returns on reload");
  await page.click('.chipbtn[data-q="Artemis"]');
  await page.waitForFunction(() => document.querySelectorAll("#grid .tile").length === 3, undefined, { timeout: 15000 });
  const chipState = await page.evaluate(() => ({
    q: document.getElementById("q").value,
    key: localStorage.getItem("suite.cache.nasaimages.q.artemis.1") !== null }));
  await expect(chipState.q === "Artemis" && chipState.key, "chip fills the box + runs the search: " + JSON.stringify(chipState));
  log(`suggested chip "Artemis" -> search box filled, 3 tiles rendered, cache key suite.cache.nasaimages.q.artemis.1`);

  /* ---- 8. 500 + 429 error cards in a sibling context (expected resource-load
          console lines stay off the main page's clean-console gate) ---- */
  const ectx = await page.context().browser().newContext();
  const ep = await ectx.newPage();
  const econsole = [];
  ep.on("console", m => { if (m.type() === "error") econsole.push(m.text()); });
  ep.on("pageerror", e => econsole.push("PAGEERROR: " + String(e)));
  let emode = 500;
  await ep.route(API_RE, r => r.fulfill({ status: emode, contentType: "application/json", body: '{"reason":"nope"}' }));
  await ep.goto(page.url());
  await ep.fill("#q", "saturn");
  await ep.press("#q", "Enter");
  await ep.waitForSelector("#msg.err", { timeout: 15000 });
  const err500 = await ep.evaluate(() => ({ h2: document.querySelector("#msg h2").textContent,
    p: document.querySelector("#msg p").textContent }));
  await expect(/Couldn’t reach NASA’s image library/.test(err500.h2) && /Tried at/.test(err500.p),
    "designed 500 error card with timestamp: " + JSON.stringify(err500));
  log(`HTTP 500 -> designed error card "${err500.h2}" (${err500.p.match(/Tried at [^"]*$/)[0]})`);
  emode = 429;
  await ep.fill("#q", "jupiter");
  await ep.press("#q", "Enter");
  await ep.waitForFunction(() => /rate-limiting/.test((document.querySelector("#msg h2") || {}).textContent || ""), undefined, { timeout: 15000 });
  const err429 = await ep.textContent("#msg h2");
  log(`HTTP 429 -> distinct rate-limit card "${err429}"`);
  const unexpected = econsole.filter(s => !/Failed to load resource/.test(s) && !/net::ERR/.test(s));
  if (unexpected.length) throw new Error("unexpected sibling console: " + unexpected.join(" | "));
  log(`  sibling-page console during 500/429 provocation: expected resource-load errors only (${econsole.length} lines)`);
  await ectx.close();

  /* ---- 9. stale path: back-date caches 48 h (> 24 h TTL), API unreachable ---- */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("suite.cache.nasaimages.")) {
        const e = JSON.parse(localStorage.getItem(k));
        e.t = Date.now() - 48 * 60 * 60 * 1000;
        localStorage.setItem(k, JSON.stringify(e));
      }
  });
  await page.unroute(SEARCH_RE);
  await page.unroute(ASSET_RE);
  await page.route(API_RE, r => r.abort());
  await page.fill("#q", "Apollo 11");
  await page.press("#q", "Enter");
  await page.waitForFunction(() => document.querySelectorAll("#grid .tile").length === 3, undefined, { timeout: 15000 });
  const staleStatus = (await statusText(page)).trim();
  await expect(/Offline — cached from/.test(staleStatus), "visible stale stamp in status: " + staleStatus);
  log(`offline + expired cache -> results still render with stamp: "${staleStatus}"`);
  await page.click("#grid .tile:nth-child(1)");
  await page.waitForFunction(() => /Offline — image list cached from/.test(document.getElementById("detailNote").textContent),
    undefined, { timeout: 15000 });
  log(`  stale detail: "${(await page.textContent("#detailNote")).trim()}" (asset manifest from cache, image still shown)`);
  await page.screenshot({ path: `${evidenceDir}/offline-stale.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.unroute(API_RE);
  await installRoutes(page);

  /* ---- 10. storage keys + a11y audit ---- */
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  const toolKeys = keys.filter(k => !k.startsWith("suite.theme") && !k.startsWith("suite.hub."));
  await expect(toolKeys.every(k => k.startsWith("suite.cache.nasaimages.")),
    "tool writes only suite.cache.nasaimages.* (+ core suite.theme / suite.hub.recents): " + keys.join(", "));
  log(`storage keys: ${keys.join(", ")} — tool-owned keys all under suite.cache.nasaimages.*`);
  const a11y = await page.evaluate(() => ({
    qLabel: document.getElementById("q").getAttribute("aria-label"),
    yearLabelFor: !!document.querySelector('label[for="yearStart"]'),
    statusLive: document.getElementById("status").getAttribute("aria-live"),
    noteLive: document.getElementById("detailNote").getAttribute("aria-live"),
    pagerLabels: [document.getElementById("prevBtn"), document.getElementById("nextBtn")].map(b => b.getAttribute("aria-label")),
    closeLabel: document.getElementById("closeBtn").getAttribute("aria-label"),
    tilesAreButtons: [...document.querySelectorAll("#grid .tile")].every(t => t.tagName === "BUTTON" && t.getAttribute("aria-label"))
  }));
  await expect(a11y.qLabel && a11y.yearLabelFor && a11y.statusLive === "polite" && a11y.noteLive === "polite" &&
    a11y.pagerLabels.every(Boolean) && a11y.closeLabel && a11y.tilesAreButtons, "a11y bits: " + JSON.stringify(a11y));
  log(`a11y: search aria-label, year <label for>, live regions (status+detail note polite), pager/close aria-labels, tiles are labeled <button>s`);

  /* ---- 11. mobile 390 px: no horizontal overflow ---- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mob = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    body: document.body.scrollWidth <= document.body.clientWidth,
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  await expect(mob.doc && mob.body, "no horizontal overflow at 390px: " + JSON.stringify(mob));
  log(`mobile 390x844: scrollWidth ${mob.sw} <= clientWidth ${mob.cw}, no horizontal overflow`);
  await page.screenshot({ path: `${evidenceDir}/mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200);
}
