/* tests/interactions/cite.mjs — Citation Builder (v4, cors-open: api.crossref.org)

   Fully offline-deterministic: a context-wide abort route blocks ALL http(s), and a
   page-level route fulfils api.crossref.org with fixtures copied from real Crossref
   response shapes (live curl probes 2026-07-30; ACAO * confirmed on the same probes).
   Proves: DOI-input path vs search path (exact request URLs), the result picker,
   exact APA 7 / MLA 9 / BibTeX strings for a 2-author journal article, et-al rules
   (MLA et al. at 3+, APA lists all up to 20, APA ". . ." ellipsis at 21+), a
   missing-fields book (no container/pages — no "undefined" anywhere), plain-text
   copy (clipboard stub + rejected-clipboard fallback state), reading list
   add/persist/reload/remove + .bib export content, 404 and 429 designed errors,
   empty search results, the stale-cache offline path (7-day TTL exceeded), an
   adversarial escaping probe, a11y labels/live regions, storage-key audit, and
   390 px no-overflow. */

export const selectors = [
  "body", ".topbar", ".back", ".theme-btn", "header h1", "header .tag",
  ".controls .search", ".go", "#status", "#workSec", ".fmt", "#apaOut",
  "section.saved h2", "#savedList", "footer"
];

export const screenshotAfterInteract = true;

/* ---------- fixtures (Crossref /works shapes, trimmed to the fields the tool reads) ---------- */
const WORK2 = { // journal article, 2 authors, volume/issue/pages — exact-string fixture
  DOI: "10.5555/12345678", type: "journal-article",
  title: ["The Memory of Rivers"],
  "container-title": ["Journal of Hydrology Letters"],
  volume: "12", issue: "3", page: "101-118",
  publisher: "Example Press",
  author: [
    { given: "Ada", family: "Lovelace", sequence: "first", affiliation: [] },
    { given: "Grace", family: "Hopper", sequence: "additional", affiliation: [] }
  ],
  issued: { "date-parts": [[2021, 5, 10]] }
};
const ETAL = { // 3 authors: MLA goes et al., APA still lists all three
  DOI: "10.5555/etal1", type: "journal-article",
  title: ["Signal Processing at Scale"],
  "container-title": ["Annals of Applied Signals"],
  volume: "7", issue: "2", page: "55-71",
  publisher: "Example Press",
  author: [
    { given: "Wei", family: "Chen" },
    { given: "Ngozi", family: "Okafor" },
    { given: "Luisa", family: "Duarte" }
  ],
  issued: { "date-parts": [[2020]] }
};
const BOOK = { // missing-fields fixture: book, no container-title, no page, no issue/volume
  DOI: "10.5555/bk9", type: "book",
  title: ["Field Notes on Silence"],
  publisher: "Quiet House Press",
  author: [{ given: "Mara", family: "Ilves" }],
  issued: { "date-parts": [[2019]] }
};
const BIGTEAM = { // 22 authors: APA first 19 + ". . ." + last, no ampersand
  DOI: "10.5555/team1", type: "journal-article",
  title: ["Consortium Measurements of Everything"],
  "container-title": ["Journal of Big Teams"],
  volume: "4", issue: "1", page: "1-44",
  author: Array.from({ length: 22 }, (_, i) => ({
    given: "Given" + String(i + 1).padStart(2, "0"),
    family: "Fam" + String(i + 1).padStart(2, "0")
  })),
  issued: { "date-parts": [[2022]] }
};
const EVIL = { // adversarial: markup in every rendered field — must stay inert text
  DOI: "10.5555/evil", type: "journal-article",
  title: ['<img src=x onerror="window.__xssC=1">'],
  "container-title": ["<script>window.__xssC=2<\/script>"],
  volume: "<b>9</b>", issue: "1", page: "1-2",
  publisher: '"><svg onload=window.__xssC=4>',
  author: [{ given: "Eve", family: '"><svg onload=window.__xssC=3>' }],
  issued: { "date-parts": [[2024]] }
};

/* ---------- expected exact strings (mirror of the tool's documented format rules) ---------- */
const APA_2 = "Lovelace, A., & Hopper, G. (2021). The Memory of Rivers. Journal of Hydrology Letters, 12(3), 101–118. https://doi.org/10.5555/12345678";
const MLA_2 = "Lovelace, Ada, and Grace Hopper. “The Memory of Rivers.” Journal of Hydrology Letters, vol. 12, no. 3, 2021, pp. 101–118.";
const BIB_2 = `@article{lovelace2021memory,
  author = {Lovelace, Ada and Hopper, Grace},
  title = {The Memory of Rivers},
  journal = {Journal of Hydrology Letters},
  volume = {12},
  number = {3},
  pages = {101--118},
  publisher = {Example Press},
  year = {2021},
  doi = {10.5555/12345678}
}`;
const APA_3 = "Chen, W., Okafor, N., & Duarte, L. (2020). Signal Processing at Scale. Annals of Applied Signals, 7(2), 55–71. https://doi.org/10.5555/etal1";
const MLA_3 = "Chen, Wei, et al. “Signal Processing at Scale.” Annals of Applied Signals, vol. 7, no. 2, 2020, pp. 55–71.";
const APA_B = "Ilves, M. (2019). Field Notes on Silence. Quiet House Press. https://doi.org/10.5555/bk9";
const MLA_B = "Ilves, Mara. Field Notes on Silence. Quiet House Press, 2019.";
const BIB_B = `@book{ilves2019field,
  author = {Ilves, Mara},
  title = {Field Notes on Silence},
  publisher = {Quiet House Press},
  year = {2019},
  doi = {10.5555/bk9}
}`;

const API = "https://api.crossref.org";
const wrapWork = m => ({ status: "ok", "message-type": "work", "message-version": "1.0.0", message: m });
const wrapList = items => ({
  status: "ok", "message-type": "work-list", "message-version": "1.0.0",
  message: { facets: {}, "total-results": items.length ? 5321 : 0, items, "items-per-page": 10 }
});

const eq = (got, want, what) => {
  if (got !== want) throw new Error(`MISMATCH ${what}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
};
const expect = (cond, msg) => { if (!cond) throw new Error("EXPECT FAILED: " + msg); };

export async function interact({ page, log, evidenceDir }) {
  /* ---- routes FIRST: context-wide abort baseline, page-level Crossref fixtures ---- */
  const reqs = [];
  let releaseSlowSearch;
  const slowSearchResponse = new Promise(resolve => { releaseSlowSearch = resolve; });
  await page.context().route(/^https?:/, r => r.abort());
  const crossref = u => u.href.startsWith(API + "/");
  const stub = async r => {
    const url = r.request().url();
    reqs.push(url);
    const json = body => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url === API + "/works/10.5555%2F12345678") return json(wrapWork(WORK2));
    if (url === API + "/works/10.5555%2Fbk9") return json(wrapWork(BOOK));
    if (url === API + "/works/10.5555%2Fevil") return json(wrapWork(EVIL));
    if (url.includes("query.bibliographic=older%20delayed")) {
      await slowSearchResponse;
      return json(wrapList([ETAL]));
    }
    if (url.includes("query.bibliographic=zzz")) return json(wrapList([]));
    if (url.includes("query.bibliographic=")) return json(wrapList([ETAL, BOOK, BIGTEAM]));
    return r.abort();
  };
  await page.route(crossref, stub);

  const askFor = async q => { await page.fill("#q", q); await page.press("#q", "Enter"); };
  const waitWork = needle => page.waitForFunction(n => {
    const s = document.getElementById("workSec"), a = document.getElementById("apaOut");
    return s && !s.hidden && a && a.textContent.includes(n);
  }, needle, { timeout: 10000 });
  const fmt = async () => ({
    apa: await page.textContent("#apaOut"),
    mla: await page.textContent("#mlaOut"),
    bib: await page.textContent("#bibOut")
  });

  /* ---- 1. DOI-input path ("doi:" prefix tolerated) → exact request URL + exact formats ---- */
  await askFor("doi:10.5555/12345678");
  await waitWork("10.5555/12345678");
  eq(reqs[0], API + "/works/10.5555%2F12345678", "DOI lookup request URL");
  log(`DOI path: input "doi:10.5555/12345678" -> GET ${reqs[0]} (no mailto/email param)`);
  expect(!reqs[0].includes("mailto"), "no mailto attached");
  let f = await fmt();
  eq(f.apa, APA_2, "APA 7, 2-author journal article");
  eq(f.mla, MLA_2, "MLA 9, 2-author journal article");
  eq(f.bib, BIB_2, "BibTeX, 2-author journal article");
  log(`APA exact ✓: "${f.apa}"`);
  log(`MLA exact ✓: "${f.mla}"`);
  log(`BibTeX exact ✓ (@article{lovelace2021memory}, pages 101--118, braces balanced)`);
  const italics = await page.evaluate(() => ({
    apa: [...document.querySelectorAll("#apaOut i")].map(i => i.textContent),
    mla: [...document.querySelectorAll("#mlaOut i")].map(i => i.textContent)
  }));
  expect(italics.apa.includes("Journal of Hydrology Letters") && italics.apa.includes("12"),
    "APA preview italicizes container and volume");
  expect(italics.mla.includes("Journal of Hydrology Letters"), "MLA preview italicizes container");
  log(`italics via <i> in preview: APA ${JSON.stringify(italics.apa)}, MLA ${JSON.stringify(italics.mla)}`);
  log(`status: "${(await page.textContent("#status")).trim()}"`);

  /* ---- 2. overlapping title→DOI requests: delayed earlier work cannot win ---- */
  const slowRequest = page.waitForRequest(req =>
    req.url().includes("query.bibliographic=older%20delayed"));
  await askFor("older delayed");
  await slowRequest;
  await askFor("doi:10.5555/bk9");
  await waitWork("10.5555/bk9");
  releaseSlowSearch();
  await page.waitForTimeout(250);
  const raceWinner = await page.evaluate(() => ({
    title: document.getElementById("wkTitle").textContent,
    doi: document.getElementById("wkMeta").textContent,
    picks: document.querySelectorAll(".pick").length,
    status: document.getElementById("status").textContent.trim()
  }));
  expect(raceWinner.title === "Field Notes on Silence" &&
    raceWinner.doi.includes("doi:10.5555/bk9") && raceWinner.picks === 0,
    "older Crossref search overwrote newer DOI result: " + JSON.stringify(raceWinner));
  log(`overlap guard: delayed title search completed last; newer DOI result remained: ${JSON.stringify(raceWinner)}`);
  await askFor("doi:10.5555/12345678");
  await waitWork("10.5555/12345678");

  /* ---- 3. copy buttons: clipboard stub → PLAIN text (no markup), raw BibTeX ---- */
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = t => { window.__copied.push(t); return Promise.resolve(); };
  });
  await page.click("#copyApa");
  await page.click("#copyBib");
  const copied = await page.evaluate(() => window.__copied);
  eq(copied[0], APA_2, "clipboard payload for APA (plain text)");
  eq(copied[1], BIB_2, "clipboard payload for BibTeX (raw entry)");
  expect(!copied[0].includes("<") && !copied[0].includes(">"), "APA copy carries no markup");
  log(`copy: clipboard.writeText attempted — APA payload is plain text (no <i>), BibTeX raw entry ✓`);
  log(`  copy button feedback: "${(await page.textContent("#copyBib")).trim()}"`);
  /* rejected clipboard → designed fallback state (execCommand path or the "copy blocked" hint) */
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error("denied")); });
  await page.click("#copyMla");
  await page.waitForFunction(() => {
    const t = document.getElementById("copyMla").textContent.trim();
    return t !== "Copy";
  }, undefined, { timeout: 5000 });
  const mlaBtnState = (await page.textContent("#copyMla")).trim();
  expect(mlaBtnState === "✓ copied" || mlaBtnState === "copy blocked — select the text",
    "fallback state after clipboard rejection: " + mlaBtnState);
  log(`clipboard rejected -> fallback state shown: "${mlaBtnState}"`);

  /* ---- 4. save to reading list ---- */
  await page.click("#saveBtn");
  let list = await page.evaluate(() => JSON.parse(localStorage.getItem("suite.cite.list")));
  eq(list.length, 1, "reading-list length after first save");
  eq(list[0].doi, "10.5555/12345678", "saved essential fields carry the DOI");
  log(`saved to list: suite.cite.list[0] = {doi:${list[0].doi}, year:${list[0].year}, authors:${list[0].authors.length}} · save button: "${(await page.textContent("#saveBtn")).trim()}"`);

  /* ---- 5. search path → picker (title/authors/year/container) ---- */
  const nBefore = reqs.length;
  await askFor("signal processing at scale");
  await page.waitForSelector(".pick", { timeout: 10000 });
  eq(reqs[nBefore], API + "/works?query.bibliographic=signal%20processing%20at%20scale&rows=10",
    "search request URL (query.bibliographic, rows=10)");
  log(`search path: GET ${reqs[nBefore]}`);
  const picks = await page.evaluate(() =>
    [...document.querySelectorAll(".pick")].map(b => b.textContent.replace(/\s+/g, " ").trim()));
  eq(picks.length, 3, "picker result count");
  expect(picks[0].includes("Signal Processing at Scale") && picks[0].includes("Wei Chen") &&
    picks[0].includes("2020") && picks[0].includes("Annals of Applied Signals"),
    "picker row shows title, authors, year, container: " + picks[0]);
  log(`picker rows: ${picks.map((p, i) => `[${i}] ${p}`).join(" | ")}`);

  /* ---- 5. et-al rules: 3 authors → APA lists all, MLA et al. ---- */
  await page.click(".pick:nth-child(1)");
  await waitWork("10.5555/etal1");
  f = await fmt();
  eq(f.apa, APA_3, "APA 7, 3-author article (all three listed)");
  eq(f.mla, MLA_3, "MLA 9, 3-author article (first author + et al.)");
  expect(!f.apa.includes("et al"), "APA does not use et al. at 3 authors");
  expect(f.mla.includes("et al.") && !f.mla.includes("Okafor"), "MLA collapses 3+ authors to et al.");
  log(`et-al (3 authors): APA lists Chen/Okafor/Duarte ✓ — "${f.apa}"`);
  log(`et-al (3 authors): MLA "Chen, Wei, et al." ✓ — "${f.mla}"`);
  await page.click("#saveBtn"); // second list entry

  /* ---- 6. cache hit: same query again makes NO new request ---- */
  const nCache = reqs.length;
  await askFor("signal processing at scale");
  await page.waitForSelector(".pick", { timeout: 10000 });
  eq(reqs.length, nCache, "repeat search served from suite.cache.cite.q.* (no new request)");
  log(`repeat search -> served from cache, request count still ${reqs.length}; status: "${(await page.textContent("#status")).trim()}"`);

  /* ---- 7. missing-fields fixture: book, no container/pages — never "undefined" ---- */
  await page.click(".pick:nth-child(2)");
  await waitWork("10.5555/bk9");
  f = await fmt();
  eq(f.apa, APA_B, "APA 7, book with no container/pages");
  eq(f.mla, MLA_B, "MLA 9, book with no container/pages");
  eq(f.bib, BIB_B, "BibTeX @book skips journal/volume/number/pages");
  const bodyText = await page.evaluate(() => document.body.innerText);
  expect(!bodyText.includes("undefined") && !bodyText.includes("null"),
    "no 'undefined'/'null' rendered anywhere with missing fields");
  expect(!f.bib.includes("journal =") && !f.bib.includes("pages ="), "BibTeX omits absent fields");
  log(`missing fields (book): APA "${f.apa}" · MLA "${f.mla}" — clauses skipped, no "undefined" in the whole page ✓`);
  await page.click("#saveBtn"); // third list entry

  /* ---- 8. APA 21+ authors: first 19, ". . .", final author, no ampersand ---- */
  await askFor("signal processing at scale");
  await page.waitForSelector(".pick", { timeout: 10000 });
  await page.click(".pick:nth-child(3)");
  await waitWork("10.5555/team1");
  f = await fmt();
  expect(f.apa.includes("Fam19, G.") && f.apa.includes(", . . . Fam22, G."),
    "APA 21+: first 19 authors then ellipsis then last");
  expect(!f.apa.includes("Fam20") && !f.apa.includes("&"), "APA 21+: no 20th author, no ampersand");
  expect(f.mla.startsWith("Fam01, Given01, et al."), "MLA 21+ still first author + et al.");
  log(`APA 21+ rule (22-author fixture): "...Fam19, G., . . . Fam22, G." ✓, no "&", MLA stays et al.`);

  /* ---- 9. reading list persists across reload; per-item copy/remove; export .bib ---- */
  await page.reload();
  await page.waitForSelector(".saved-item", { timeout: 10000 });
  list = await page.evaluate(() => JSON.parse(localStorage.getItem("suite.cite.list")));
  eq(list.length, 3, "reading list persisted across reload");
  const savedTitles = await page.evaluate(() =>
    [...document.querySelectorAll(".saved-item .ttl")].map(b => b.textContent));
  log(`after reload — list persisted (${list.length}): [${savedTitles.join(" | ")}] · count badge "${(await page.textContent("#savedCount")).trim()}"`);
  /* export all as BibTeX: capture the blob the download link is built from */
  await page.evaluate(() => {
    window.__blobText = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = b => { b.text().then(t => { window.__blobText = t; }); return orig(b); };
  });
  await page.click("#exportBtn");
  await page.waitForFunction(() => window.__blobText !== null, undefined, { timeout: 5000 });
  const bib = await page.evaluate(() => window.__blobText);
  for (const key of ["@book{ilves2019field", "@article{chen2020signal", "@article{lovelace2021memory"])
    expect(bib.includes(key), "exported .bib contains " + key);
  expect(bib.includes(BIB_B), "exported .bib contains the full @book entry verbatim");
  log(`export all as BibTeX -> reading-list.bib with 3 entries (${bib.split("@").length - 1} @-entries, ${bib.length} chars) ✓`);
  /* per-item copy (APA, plain) */
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = t => { window.__copied.push(t); return Promise.resolve(); };
  });
  await page.click(".saved-item:nth-child(1) .copy");
  const itemCopied = await page.evaluate(() => window.__copied[0]);
  eq(itemCopied, APA_B, "per-item copy = plain APA of the newest item (the book)");
  log(`per-item copy ✓: "${itemCopied}"`);
  /* per-item remove */
  await page.click(".saved-item:nth-child(1) .rm");
  list = await page.evaluate(() => JSON.parse(localStorage.getItem("suite.cite.list")));
  eq(list.length, 2, "remove drops the item from suite.cite.list");
  expect(!list.some(w => w.doi === "10.5555/bk9"), "removed DOI is gone from storage");
  log(`per-item remove ✓ — list now ${list.length}, book DOI gone`);
  /* reopen from the list regenerates locally (no request) */
  const nLocal = reqs.length;
  await page.click(".saved-item:nth-child(2) .ttl");
  await waitWork("10.5555/12345678");
  eq(reqs.length, nLocal, "reading-list reopen makes no network request");
  eq((await fmt()).apa, APA_2, "reopened item regenerates the exact APA from stored fields");
  log(`reading-list reopen -> citations regenerated locally, status: "${(await page.textContent("#status")).trim()}"`);

  /* ---- 10. designed error states: 404 DOI, 429 rate limit, empty search ----
     HTTP error statuses are synthesized as in-page Response objects (not route-
     fulfilled real 4xx) so Chromium's network-layer "Failed to load resource"
     console error never fires — Suite.fetchJSON sees the identical r.status. */
  await page.evaluate(() => {
    const orig = window.fetch.bind(window);
    window.__origFetch = orig;
    window.fetch = (url, opts) => {
      const u = String(url);
      if (u.includes("10.5555%2Fnope"))
        return Promise.resolve(new Response("Resource not found.", { status: 404 }));
      if (u.includes("10.5555%2Fbusy"))
        return Promise.resolve(new Response("Rate limited", { status: 429 }));
      return orig(url, opts);
    };
  });
  await askFor("10.5555/nope");
  await page.waitForSelector(".statecard", { timeout: 10000 });
  let card = (await page.textContent(".statecard")).replace(/\s+/g, " ").trim();
  expect(card.includes("No work found") && card.includes("10.5555/nope"), "404 card: " + card);
  expect(await page.evaluate(() => document.getElementById("workSec").hidden), "work section hidden on error");
  log(`404 DOI -> designed error card: "${card}"`);
  await askFor("doi:10.5555/busy");
  await page.waitForFunction(() =>
    (document.querySelector(".statecard") || {}).textContent?.includes("rate-limiting"), undefined, { timeout: 10000 });
  card = (await page.textContent(".statecard")).replace(/\s+/g, " ").trim();
  log(`429 -> distinct rate-limit card: "${card}"`);
  await askFor("zzz");
  await page.waitForFunction(() =>
    (document.querySelector(".statecard") || {}).textContent?.includes("No works matched"), undefined, { timeout: 10000 });
  card = (await page.textContent(".statecard")).replace(/\s+/g, " ").trim();
  log(`empty results -> designed empty state: "${card}"`);
  await page.evaluate(() => { window.fetch = window.__origFetch; });

  /* ---- 11. adversarial escaping probe: hostile Crossref record stays inert text ---- */
  await askFor("doi:10.5555/evil");
  await waitWork("10.5555/evil");
  const probe = await page.evaluate(() => ({
    xss: window.__xssC === undefined ? null : window.__xssC,
    injected: document.querySelectorAll("#workSec img, #workSec svg, #workSec script, #workSec b").length,
    title: document.getElementById("wkTitle").textContent,
    apa: document.getElementById("apaOut").textContent
  }));
  expect(probe.xss === null && probe.injected === 0, "hostile record inert: " + JSON.stringify(probe));
  expect(probe.title.includes("<img src=x") && probe.apa.includes("<script>"),
    "hostile markup rendered as literal text");
  log(`ADVERSARIAL record (markup in title/container/author/volume) -> inert: __xssC=${probe.xss}, injected els=${probe.injected}, markup shown as text ✓`);
  await page.evaluate(() => localStorage.removeItem("suite.cache.cite.doi.10-5555-evil"));

  /* ---- 12. stale-cache offline path: back-date past the 7-day TTL, block all network ---- */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("suite.cache.cite.")) {
        const e = JSON.parse(localStorage.getItem(k));
        e.t = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 d > 10080-min TTL
        localStorage.setItem(k, JSON.stringify(e));
      }
  });
  await page.unroute(crossref); // context-wide abort now applies to Crossref too
  await askFor("https://doi.org/10.5555/12345678"); // doi.org prefix tolerated
  await waitWork("10.5555/12345678");
  let status = (await page.textContent("#status")).trim();
  expect(status.startsWith("Offline") && status.includes("8 days ago"), "stale DOI stamp: " + status);
  expect(await page.evaluate(() => document.getElementById("status").classList.contains("warn")),
    "stale stamp uses the warn style");
  eq((await fmt()).apa, APA_2, "stale cache still renders the exact citation");
  log(`offline + stale cache (DOI, doi.org-prefixed input) -> "${status}" ✓, citation intact`);
  await askFor("signal processing at scale");
  await page.waitForSelector(".pick", { timeout: 10000 });
  status = (await page.textContent("#status")).trim();
  expect(status.includes("Offline — cached results"), "stale search stamp: " + status);
  log(`offline + stale cache (search) -> picker renders with stamp: "${status}"`);
  await page.screenshot({ path: `${evidenceDir}/offline-stale.png`, fullPage: true });
  await page.route(crossref, stub); // restore fixtures

  /* ---- 13. a11y: labels, live regions, toggle states ---- */
  const a11y = await page.evaluate(() => ({
    q: document.getElementById("q").getAttribute("aria-label"),
    status: document.getElementById("status").getAttribute("aria-live"),
    results: document.getElementById("results").getAttribute("aria-live"),
    work: document.getElementById("workSec").getAttribute("aria-live"),
    copyApa: document.getElementById("copyApa").getAttribute("aria-label"),
    copyBib: document.getElementById("copyBib").getAttribute("aria-label"),
    rm: (document.querySelector(".saved-item .rm") || {}).getAttribute?.("aria-label"),
    themePressed: document.getElementById("themeBtn").getAttribute("aria-pressed")
  }));
  expect(a11y.status === "polite" && a11y.results === "polite" && a11y.work === "polite",
    "live regions on async containers");
  expect(!!a11y.q && !!a11y.copyApa && !!a11y.copyBib && !!a11y.rm, "aria-labels present");
  log(`a11y: input label "${a11y.q}"; aria-live polite on #status/#results/#workSec; copy labels "${a11y.copyApa}" / "${a11y.copyBib}"; remove label "${a11y.rm}"; theme aria-pressed=${a11y.themePressed}`);

  /* ---- 14. storage-key audit: exactly the manifest keys (+ suite-chrome hub keys) ---- */
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  for (const k of keys)
    expect(/^suite\.(theme$|cite\.list$|cache\.cite\.|hub\.)/.test(k), "unexpected storage key: " + k);
  expect(keys.includes("suite.cite.list"), "suite.cite.list present");
  expect(keys.some(k => k.startsWith("suite.cache.cite.doi.")) &&
    keys.some(k => k.startsWith("suite.cache.cite.q.")), "cite.doi.* and cite.q.* cache keys present");
  log(`storage keys (manifest-clean): ${keys.join(", ")}`);

  /* ---- 15. mobile: 390 px, no horizontal overflow, dense state on screen ---- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mob = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth
  }));
  expect(mob.sw <= mob.cw, `mobile overflow: scrollWidth ${mob.sw} > clientWidth ${mob.cw}`);
  log(`mobile 390px: scrollWidth ${mob.sw} <= clientWidth ${mob.cw} ✓ (picker + reading list on screen)`);
  await page.screenshot({ path: `${evidenceDir}/mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  /* ---- restore a presentable final state (fresh cache, no refetch) ---- */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("suite.cache.cite.")) {
        const e = JSON.parse(localStorage.getItem(k));
        e.t = Date.now();
        localStorage.setItem(k, JSON.stringify(e));
      }
  });
  await askFor("doi:10.5555/12345678");
  await waitWork("10.5555/12345678");
  log(`restored: WORK2 served from fresh cache — status "${(await page.textContent("#status")).trim()}"`);
}

/* New-in-v4 tool — no v1 original; localStorage parity N/A. Keys written on a plain
   run: suite.theme (harness toggle), suite.cite.list, suite.cache.cite.* (manifest),
   plus the suite-wide chrome keys (suite.hub.recents) written by Suite.theme.init(). */
