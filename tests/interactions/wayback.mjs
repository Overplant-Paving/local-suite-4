/* tests/interactions/wayback.mjs — Wayback Machine Lookup (v4, cors-open)

   Fully offline-deterministic: every archive.org request is route-fulfilled from
   fixtures copied from the real Availability API shape
   (https://archive.org/wayback/available?url=…&timestamp=…). Exercised paths:
   - available fixture: 14-digit timestamp "20190304142200" parsed to
     "March 4, 2019 · 14:22 UTC", capture HTTP status chip, exact https-forced
     snapshot href with target=_blank rel=noopener;
   - timestamp param passed when a date is chosen + distance-from-requested wording;
   - not-archived fixture -> designed state with a labeled web.archive.org/save link;
   - invalid URL -> inline error with ZERO requests (request counter proves it);
   - schemeless input normalized to https:// before the query;
   - history: write, dedupe by (url,date), 10-entry bound, chip re-run, clear;
   - HTTP 500 -> designed error card; HTTP 429 -> distinct rate-limit card;
   - stale path: cache back-dated past the 24 h TTL + routes aborted -> stale stamp;
   - cache keys: exact suite.cache.wayback.<slug>-<fnv> key recomputed independently;
   - hostile fixtures (markup in status, javascript: snapshot URL) stay inert;
   - labels + live regions; mobile 390 px with no horizontal overflow. */

export const selectors = [
  "body", ".topbar", ".back", ".theme-btn", "header h1", "header .tag",
  "form.lookup", "#pageUrl", "#onDate", "#goBtn", "#result", ".callout", "footer"
];

export const screenshotAfterInteract = true;

function expect(cond, msg) { if (!cond) throw new Error("EXPECT FAILED: " + msg); }

/* independent recomputation of the tool's cache-key scheme (slug + FNV-1a suffix) */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
function cacheKeyFor(url, ts) {
  const slug = url.toLowerCase().replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "page";
  return "suite.cache.wayback." + slug + (ts ? "-" + ts : "") + "-" + fnv1a(url + "|" + (ts || ""));
}

/* real Availability API response shape (archived_snapshots.closest envelope) */
const SNAP_TS = "20190304142200";
const available = url => ({
  url,
  archived_snapshots: {
    closest: {
      status: "200", available: true,
      url: "http://web.archive.org/web/" + SNAP_TS + "/" + url,
      timestamp: SNAP_TS
    }
  }
});
const notArchived = url => ({ url, archived_snapshots: {} });

export async function interact({ page, log, evidenceDir }) {
  /* ---- deterministic routing for EVERY archive.org request (context-wide,
     so the sibling page used for the 500/429 paths is covered too) ---- */
  const reqs = [];
  let offline = false;
  await page.context().route(u => u.hostname === "archive.org", r => {
    const u = new URL(r.request().url());
    reqs.push(u.href);
    if (offline) return r.abort();
    const target = u.searchParams.get("url") || "";
    let body;
    if (target.includes("boom.")) return r.fulfill({ status: 500, contentType: "text/plain", body: "server error" });
    if (target.includes("limit.")) return r.fulfill({ status: 429, contentType: "application/json", body: '{"error":"too many requests"}' });
    else if (target.includes("notarchived.")) body = notArchived(target);
    else if (target.includes("hostile-status.")) {
      body = available(target);
      body.archived_snapshots.closest.status = '<img src=x onerror="window.__xss=9">';
    } else if (target.includes("hostile-link.")) {
      body = available(target);
      body.archived_snapshots.closest.url = "javascript:window.__xss=10";
    } else body = available(target);
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  const state = () => page.evaluate(() => document.getElementById("result").dataset.state);
  const hist = () => page.evaluate(() => JSON.parse(localStorage.getItem("suite.wayback.history") || "null"));
  async function lookupOn(pg, url, date) {
    if (date !== undefined) await pg.fill("#onDate", date);
    await pg.fill("#pageUrl", url);
    const prev = await pg.evaluate(() => document.getElementById("result").dataset.seq || "0");
    await pg.press("#pageUrl", "Enter"); // Enter submits the form
    await pg.waitForFunction(p =>
      (document.getElementById("result").dataset.seq || "0") !== p, prev, { timeout: 15000 });
  }
  const lookup = (url, date) => lookupOn(page, url, date);

  /* ---- a11y: labeled inputs, live regions, icon-free named buttons ---- */
  const a11y = await page.evaluate(() => ({
    urlLabeled: !!document.getElementById("pageUrl").closest("label"),
    dateLabeled: !!document.getElementById("onDate").closest("label"),
    resultLive: document.getElementById("result").getAttribute("aria-live"),
    errLive: document.getElementById("formErr").getAttribute("aria-live"),
    themePressed: document.getElementById("themeBtn").getAttribute("aria-pressed"),
    clearText: document.getElementById("clearHist").textContent.trim()
  }));
  expect(a11y.urlLabeled && a11y.dateLabeled, "both inputs wrapped in <label>: " + JSON.stringify(a11y));
  expect(a11y.resultLive === "polite" && a11y.errLive === "polite", "live regions: " + JSON.stringify(a11y));
  log(`a11y: inputs labeled=${a11y.urlLabeled}/${a11y.dateLabeled}, aria-live #result=${a11y.resultLive} #formErr=${a11y.errLive}, theme aria-pressed=${a11y.themePressed}, clear button text="${a11y.clearText}"`);

  /* ---- invalid URL -> inline error BEFORE any request ---- */
  await page.fill("#pageUrl", "not a url");
  await page.press("#pageUrl", "Enter");
  await page.waitForSelector("#formErr:not([hidden])", { timeout: 5000 });
  const err1 = (await page.textContent("#formErr")).trim();
  expect(reqs.length === 0, "no requests after invalid URL, saw " + reqs.length);
  log(`invalid URL "not a url" -> inline error "${err1}", requests made: ${reqs.length} (expect 0)`);
  await page.fill("#pageUrl", "javascript:alert(1)");
  await page.press("#pageUrl", "Enter");
  const err2 = (await page.textContent("#formErr")).trim();
  expect(reqs.length === 0 && /javascript/.test(err2), "non-http scheme rejected without a request");
  log(`non-http scheme "javascript:alert(1)" -> inline error "${err2}", requests: ${reqs.length} (expect 0)`);

  /* ---- schemeless normalization + available fixture ---- */
  await lookup("example.com", "");
  expect((await state()) === "ok", "archived state after example.com");
  const q1 = new URL(reqs[0]);
  expect(q1.pathname === "/wayback/available", "endpoint path, got " + q1.pathname);
  expect(q1.searchParams.get("url") === "https://example.com/", "schemeless normalized, got " + q1.searchParams.get("url"));
  expect(q1.searchParams.get("timestamp") === null, "no timestamp param without a date");
  log(`schemeless "example.com" -> request ${q1.href} (url param normalized to https://example.com/, no timestamp param)`);
  const when = (await page.textContent("#result .when")).trim();
  expect(when === "March 4, 2019 · 14:22 UTC", `timestamp ${SNAP_TS} parsed, got "${when}"`);
  const statusChip = (await page.textContent("#result .chips .chip")).trim();
  expect(statusChip === "HTTP 200 at capture", "status chip, got " + statusChip);
  const link = await page.evaluate(() => {
    const a = document.querySelector("#result a.ext");
    return { href: a.getAttribute("href"), target: a.target, rel: a.rel, text: a.textContent };
  });
  expect(link.href === "https://web.archive.org/web/20190304142200/https://example.com/",
    "https-forced exact snapshot href, got " + link.href);
  expect(link.target === "_blank" && link.rel === "noopener", "target/rel on capture link");
  log(`archived card: "${(await page.textContent("#result .verdict b")).trim()}" · when="${when}" · chip="${statusChip}"`);
  log(`capture link: text="${link.text}" href=${link.href} target=${link.target} rel=${link.rel} (http:// from the API forced to https)`);

  /* ---- cache key recomputed independently ---- */
  const key1 = cacheKeyFor("https://example.com/", "");
  const env1 = await page.evaluate(k => {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const e = JSON.parse(raw);
    return { hasT: typeof e.t === "number", ts: e.v.archived_snapshots.closest.timestamp };
  }, key1);
  expect(env1 && env1.hasT && env1.ts === SNAP_TS, "cache envelope at " + key1 + ": " + JSON.stringify(env1));
  log(`cache key (recomputed independently): ${key1} -> envelope {t: number, v.…closest.timestamp: "${env1.ts}"}`);

  /* ---- cached re-run + history dedupe by (url, date) ---- */
  const before = reqs.length;
  await lookup("example.com", "");
  expect(reqs.length === before, "second identical lookup served from 24 h cache");
  const h1 = await hist();
  expect(h1.length === 1 && h1[0].u === "https://example.com/" && h1[0].d === "", "history deduped: " + JSON.stringify(h1));
  const cachedChip = await page.evaluate(() =>
    [...document.querySelectorAll("#result .chips .chip")].map(c => c.textContent).find(t => t.includes("cached")));
  log(`re-run same lookup: requests still ${reqs.length} (served from cache, chip "${cachedChip}"), history deduped to ${h1.length} entry`);

  /* ---- date chosen -> timestamp param + distance wording ---- */
  await lookup("example.com", "2019-03-01");
  const q2 = new URL(reqs[reqs.length - 1]);
  expect(q2.searchParams.get("timestamp") === "20190301", "timestamp param, got " + q2.searchParams.get("timestamp"));
  const dist = (await page.textContent("#result .dist")).trim();
  expect(dist === "Captured 3 days after your requested date (March 1, 2019).", "distance wording, got: " + dist);
  log(`date 2019-03-01 chosen -> request carries timestamp=${q2.searchParams.get("timestamp")}; distance line: "${dist}"`);
  const keyDated = cacheKeyFor("https://example.com/", "20190301");
  expect(await page.evaluate(k => !!localStorage.getItem(k), keyDated), "dated lookup got its own cache key " + keyDated);
  log(`dated lookup cached separately under ${keyDated}`);

  /* ---- not-archived fixture -> designed state + save link ---- */
  await lookup("notarchived.example.com", "");
  expect((await state()) === "none", "not-archived state");
  const save = await page.evaluate(() => {
    const a = document.querySelector("#result a.ext");
    return { href: a.getAttribute("href"), target: a.target, rel: a.rel, text: a.textContent,
      verdict: document.querySelector("#result .verdict b").textContent,
      body: document.querySelector("#result .none-body").textContent,
      leave: document.querySelector("#result .leave").textContent };
  });
  expect(save.href === "https://web.archive.org/save/https://notarchived.example.com/",
    "save link href, got " + save.href);
  expect(save.target === "_blank" && save.rel === "noopener", "save link target/rel");
  expect(/Leaves this tool/.test(save.leave), "save link marked as leaving: " + save.leave);
  log(`not archived -> "${save.verdict}": "${save.body.slice(0, 70)}…"`);
  log(`  save link: text="${save.text}" href=${save.href} target=${save.target} rel=${save.rel}; note: "${save.leave}"`);

  /* ---- HTTP 500 -> designed error card; 429 -> distinct rate-limit card ----
     Exercised on a sibling page (same context, same fixtures/localStorage): a
     non-2xx response makes Chromium itself log "Failed to load resource" — a
     network-stack message no page code can suppress. Same pattern the suite's
     committed 429 tests use (apod.mjs, markets.mjs, launches.mjs). All error-
     card assertions still run and still gate. */
  const p2 = await page.context().newPage();
  await p2.goto(page.url());
  await p2.waitForSelector("#pageUrl", { timeout: 10000 });
  await lookupOn(p2, "boom.example.com", "");
  expect((await p2.evaluate(() => document.getElementById("result").dataset.state)) === "error", "error state on 500");
  const e500 = await p2.evaluate(() => ({
    head: document.querySelector("#result .errcard b").textContent,
    body: document.querySelector("#result .errcard span").textContent
  }));
  expect(e500.head === "Lookup failed" && e500.body.includes("HTTP 500"), "500 card: " + JSON.stringify(e500));
  log(`HTTP 500 -> error card "${e500.head}": "${e500.body.slice(0, 90)}…"`);
  await lookupOn(p2, "limit.example.com", "");
  const e429 = await p2.evaluate(() => ({
    head: document.querySelector("#result .errcard b").textContent,
    body: document.querySelector("#result .errcard span").textContent
  }));
  expect(/rate-limiting/.test(e429.head) && e429.body.includes("429"), "429 card distinct: " + JSON.stringify(e429));
  log(`HTTP 429 -> distinct card "${e429.head}": "${e429.body}"`);
  await p2.screenshot({ path: evidenceDir + "/error-card-429.png", fullPage: true });
  await p2.close();

  /* ---- hostile fixtures stay inert (all rendering is textContent) ---- */
  await lookup("hostile-status.example.com", "");
  const probe1 = await page.evaluate(() => ({
    xss: window.__xss === undefined ? null : window.__xss,
    imgs: document.querySelectorAll("#result img, #result svg, #result script").length,
    chip: document.querySelector("#result .chips .chip").textContent
  }));
  expect(probe1.xss === null && probe1.imgs === 0 && probe1.chip.includes("<img"), "hostile status inert: " + JSON.stringify(probe1));
  log(`hostile capture status (markup) -> inert: __xss=${probe1.xss}, injected els=${probe1.imgs}, rendered as text: "${probe1.chip.slice(0, 50)}…"`);
  await lookup("hostile-link.example.com", "");
  const probe2 = await page.evaluate(() => ({
    xss: window.__xss === undefined ? null : window.__xss,
    state: document.getElementById("result").dataset.state,
    jsHrefs: [...document.querySelectorAll("a")].filter(a => /^\s*javascript:/i.test(a.getAttribute("href") || "")).length
  }));
  expect(probe2.xss === null && probe2.state === "none" && probe2.jsHrefs === 0, "javascript: snapshot URL refused: " + JSON.stringify(probe2));
  log(`hostile javascript: snapshot URL -> refused, designed "${probe2.state}" state, javascript: hrefs on page=${probe2.jsHrefs}`);

  /* ---- history: bound at 10, chip re-run, clear ---- */
  for (const h of ["h0", "h1", "h2", "h3"]) await lookup(h + ".example.com", "");
  const h2 = await hist();
  expect(h2.length === 10, "history bounded at 10, got " + h2.length);
  expect(h2[0].u === "https://h3.example.com/", "newest first, got " + h2[0].u);
  expect(!h2.some(x => x.u === "https://example.com/" && x.d === ""), "oldest (undated example.com) evicted");
  expect(h2.some(x => x.u === "https://example.com/" && x.d === "2019-03-01"), "dated example.com entry retained");
  log(`history after 11 distinct lookups: ${h2.length} entries (bound 10), newest=${h2[0].u}, oldest undated example.com evicted, dated entry retained`);
  const chipCount = await page.evaluate(() => document.querySelectorAll("#histList .hchip").length);
  const beforeChip = reqs.length;
  await page.click('#histList .hchip[data-u="https://example.com/"][data-d="2019-03-01"]');
  await page.waitForFunction(() => document.getElementById("result").dataset.state === "ok", undefined, { timeout: 10000 });
  const rerunDist = (await page.textContent("#result .dist")).trim();
  expect(rerunDist.includes("3 days after"), "chip re-run restored the dated result");
  expect(reqs.length === beforeChip, "chip re-run served from cache (no new request)");
  log(`${chipCount} history chips rendered; dated chip click re-ran the lookup (inputs restored, served from cache, distance line back: "${rerunDist}")`);

  /* ---- stale path: back-date the cache past the 24 h TTL, go offline ---- */
  await page.evaluate(k => {
    const e = JSON.parse(localStorage.getItem(k));
    e.t = Date.now() - 25 * 60 * 60 * 1000; // 25 h > 1440 min TTL
    localStorage.setItem(k, JSON.stringify(e));
  }, keyDated);
  offline = true;
  await lookup("example.com", "2019-03-01");
  const staleTxt = (await page.textContent("#result .stale")).trim();
  expect(staleTxt.startsWith("Offline — cached from"), "stale stamp, got: " + staleTxt);
  expect((await state()) === "ok", "stale cached result still renders the archived card");
  log(`offline + 25 h-old cache -> archived card renders with stale stamp: "${staleTxt}"`);
  await page.screenshot({ path: evidenceDir + "/offline-stale.png", fullPage: true });
  offline = false;

  /* ---- clear history ---- */
  await page.click("#clearHist");
  const cleared = await hist();
  const histHidden = await page.evaluate(() => document.getElementById("histWrap").hidden);
  expect(cleared === null && histHidden, "history cleared and section hidden");
  log(`clear history -> suite.wayback.history removed (${JSON.stringify(cleared)}), section hidden=${histHidden}`);

  /* ---- storage keys written (manifest: suite.theme, suite.wayback.history, suite.cache.wayback.*) ---- */
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  const toolKeys = keys.filter(k => k.includes("wayback"));
  expect(toolKeys.every(k => k.startsWith("suite.cache.wayback.")), "only manifest cache keys remain: " + toolKeys.join(","));
  log(`localStorage keys now: ${keys.join(", ")} (tool keys all under suite.cache.wayback.*; history re-added below)`);

  /* ---- mobile: long-URL result + history at 390 px, no horizontal overflow ---- */
  await lookup("example.com/a/really/long/path/that/keeps/going/and/going/for-overflow-checking", "");
  await page.setViewportSize({ width: 390, height: 844 });
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth
  }));
  expect(m.sw <= m.cw, `mobile overflow: scrollWidth ${m.sw} > clientWidth ${m.cw}`);
  log(`mobile 390px with a long-URL archived card + history chip: scrollWidth ${m.sw} <= clientWidth ${m.cw} (no horizontal overflow)`);
  await page.screenshot({ path: evidenceDir + "/mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  /* leave a representative view for the after-interaction shot */
  await lookup("example.com", "2019-03-01");
  log(`final view restored: "${(await page.textContent("#result .qtitle")).trim()}" state=${await state()}, total archive.org requests this run: ${reqs.length} (all route-fulfilled fixtures)`);
}
