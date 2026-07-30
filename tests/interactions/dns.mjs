/* tests/interactions/dns.mjs — DNS Lookup (v4, cors-open, fully route-stubbed)

   Both resolver endpoints (dns.google, cloudflare-dns.com) are route-fulfilled with
   deterministic fixtures copied from real DoH JSON responses (live curl probes,
   2026-07-30) — the run never hits the network. Covered: invalid-domain inline error
   before any request (routed-request counter), punycode conversion note, agreeing A
   records + AD/DNSSEC chip, MX priority split, TXT unquoting (+ hostile markup chunk
   proven inert), SOA labeled fields, NXDOMAIN status decoding, a disagreement case
   (Cloudflare returns an extra A -> callout), history write/dedupe/bound-10/chip
   re-query, cache identity keys, the stale-offline path, the one-resolver-500 path
   (on a sibling page so the inherent "Failed to load resource: 500" console noise
   stays off the main page's console gate, same pattern as apod.mjs), and mobile
   no-overflow at 390 px. */

export const selectors = [
  "body", ".topbar", ".back", ".theme-btn", "header h1", "header .tag",
  "form.lookup", "#domain", "#rtype", "#callout", ".cols", "#colG", "#colC", "footer",
];

export const screenshotAfterInteract = true;

/* ---- fixtures: shapes copied from live probes of both resolvers ----
   Google appends trailing dots to names and rdata; Cloudflare doesn't. AD (DNSSEC
   authenticated) is set on Google's example.com answer only, so exactly one column
   must render the authenticated chip. */
const A = (name, ttl, data, type = 1) => ({ name, type, TTL: ttl, data });
const resp = o => Object.assign({ Status: 0, TC: false, RD: true, RA: true, AD: false, CD: false }, o);

const FX = {
  g: {
    "A|example.com": resp({ AD: true, Question: [{ name: "example.com.", type: 1 }], Answer: [
      A("example.com.", 75, "172.66.147.243"), A("example.com.", 75, "104.20.23.154")] }),
    "A|xn--mnchen-3ya.de": resp({ Question: [{ name: "xn--mnchen-3ya.de.", type: 1 }], Answer: [
      A("xn--mnchen-3ya.de.", 300, "212.18.0.15")] }),
    "MX|gmail.com": resp({ Question: [{ name: "gmail.com.", type: 15 }], Answer: [
      A("gmail.com.", 3281, "5 gmail-smtp-in.l.google.com.", 15),
      A("gmail.com.", 3281, "10 alt1.gmail-smtp-in.l.google.com.", 15)] }),
    "TXT|example.org": resp({ Question: [{ name: "example.org.", type: 16 }], Answer: [
      A("example.org.", 300, '"v=spf1 -all"', 16),
      A("example.org.", 300, '"chunk-one" "chunk-two"', 16),
      A("example.org.", 300, '"<b>hostile</b> markup stays text"', 16)] }),
    "SOA|example.com": resp({ Question: [{ name: "example.com.", type: 6 }], Answer: [
      A("example.com.", 3600, "ns.icann.org. noc.dns.icann.org. 2024081461 7200 3600 1209600 3600", 6)] }),
    "A|no-such-host.example.com": resp({ Status: 3,
      Question: [{ name: "no-such-host.example.com.", type: 1 }],
      Authority: [A("example.com.", 900, "ns.icann.org. noc.dns.icann.org. 2024081461 7200 3600 1209600 3600", 6)] }),
    "A|disagree.example.com": resp({ Question: [{ name: "disagree.example.com.", type: 1 }], Answer: [
      A("disagree.example.com.", 60, "192.0.2.1")] }),
  },
  c: {
    "A|example.com": resp({ Question: [{ name: "example.com", type: 1 }], Answer: [
      /* reversed order + no trailing dots: the match must be order-insensitive */
      A("example.com", 75, "104.20.23.154"), A("example.com", 75, "172.66.147.243")] }),
    "A|xn--mnchen-3ya.de": resp({ Question: [{ name: "xn--mnchen-3ya.de", type: 1 }], Answer: [
      A("xn--mnchen-3ya.de", 300, "212.18.0.15")] }),
    "MX|gmail.com": resp({ Question: [{ name: "gmail.com", type: 15 }], Answer: [
      A("gmail.com", 3281, "10 alt1.gmail-smtp-in.l.google.com", 15),
      A("gmail.com", 3281, "5 gmail-smtp-in.l.google.com", 15)] }),
    "TXT|example.org": resp({ Question: [{ name: "example.org", type: 16 }], Answer: [
      A("example.org", 300, '"chunk-one" "chunk-two"', 16),
      A("example.org", 300, '"<b>hostile</b> markup stays text"', 16),
      A("example.org", 300, '"v=spf1 -all"', 16)] }),
    "SOA|example.com": resp({ Question: [{ name: "example.com", type: 6 }], Answer: [
      A("example.com", 3600, "ns.icann.org. noc.dns.icann.org. 2024081461 7200 3600 1209600 3600", 6)] }),
    "A|no-such-host.example.com": resp({ Status: 3,
      Question: [{ name: "no-such-host.example.com", type: 1 }],
      Authority: [A("example.com", 900, "ns.icann.org. noc.dns.icann.org. 2024081461 7200 3600 1209600 3600", 6)] }),
    "A|disagree.example.com": resp({ Question: [{ name: "disagree.example.com", type: 1 }], Answer: [
      /* the disagreement: Cloudflare returns an extra A record */
      A("disagree.example.com", 60, "192.0.2.1"), A("disagree.example.com", 60, "203.0.113.9")] }),
    "A|half.example.com": resp({ Question: [{ name: "half.example.com", type: 1 }], Answer: [
      A("half.example.com", 120, "198.51.100.7")] }),
  },
};

export async function interact({ page, log, evidenceDir }) {
  /* ---- route-fulfill BOTH endpoints first; count every routed request ---- */
  const counts = { g: 0, c: 0 };
  let cfAccept = null;
  const gRoute = u => u.hostname === "dns.google";
  const cRoute = u => u.hostname === "cloudflare-dns.com";
  const make = which => route => {
    counts[which]++;
    const req = route.request();
    if (which === "c" && cfAccept === null) cfAccept = req.headers()["accept"] || "(none)";
    const u = new URL(req.url());
    const key = `${u.searchParams.get("type")}|${u.searchParams.get("name")}`;
    const fx = FX[which][key];
    if (!fx) return route.fulfill({ status: 500, contentType: "text/plain", body: "no fixture for " + key });
    return route.fulfill({ status: 200, contentType: "application/dns-json", body: JSON.stringify(fx) });
  };
  await page.route(gRoute, make("g"));
  await page.route(cRoute, make("c"));

  const waitDone = p => p.waitForFunction(
    () => document.getElementById("results").dataset.done, undefined, { timeout: 20000 });
  async function lookup(name, type) {
    await page.evaluate(() => document.getElementById("results").removeAttribute("data-done"));
    await page.fill("#domain", name);
    await page.selectOption("#rtype", type);
    await page.click("#goBtn");
    await waitDone(page);
  }
  const colText = id => page.evaluate(
    i => document.getElementById(i).innerText.replace(/\s+/g, " ").trim(), id);
  const calloutText = () => page.evaluate(() => document.getElementById("callout").textContent.replace(/\s+/g, " ").trim());

  /* ---- a11y: labeled controls, live regions, 8 record types ---- */
  const a11y = await page.evaluate(() => ({
    domainLabeled: !!document.querySelector("label input#domain"),
    typeLabeled: !!document.querySelector("label select#rtype"),
    resultsLive: document.getElementById("results").getAttribute("aria-live"),
    errLive: document.getElementById("formErr").getAttribute("aria-live"),
    themePressed: document.getElementById("themeBtn").getAttribute("aria-pressed"),
    options: [...document.querySelectorAll("#rtype option")].map(o => o.value).join(","),
  }));
  if (!a11y.domainLabeled || !a11y.typeLabeled || a11y.resultsLive !== "polite" || a11y.errLive !== "polite")
    throw new Error("a11y check failed: " + JSON.stringify(a11y));
  log(`a11y: domain+type inputs label-wrapped, #results aria-live=${a11y.resultsLive}, ` +
    `#formErr aria-live=${a11y.errLive}, theme-btn aria-pressed=${a11y.themePressed}`);
  log(`record types offered: ${a11y.options}`);

  /* ---- invalid domains: designed inline error BEFORE any request ---- */
  await page.fill("#domain", "not a domain!!");
  await page.click("#goBtn");
  await page.waitForSelector("#formErr:not([hidden])", { timeout: 5000 });
  log(`invalid "not a domain!!" -> inline error: "${(await page.textContent("#formErr")).trim()}"`);
  await page.fill("#domain", "localhost");
  await page.click("#goBtn");
  log(`invalid "localhost" (single label) -> inline error: "${(await page.textContent("#formErr")).trim()}"`);
  if (counts.g + counts.c !== 0)
    throw new Error(`requests made for invalid input: google=${counts.g} cloudflare=${counts.c}`);
  log(`routed requests after both invalid submissions: google=${counts.g} cloudflare=${counts.c} (0 as required)`);

  /* ---- unicode input -> punycode note ---- */
  await lookup("münchen.de", "A");
  const puny = (await page.textContent("#punyNote")).trim();
  if (!puny.includes("xn--mnchen-3ya.de")) throw new Error("punycode note missing: " + puny);
  log(`unicode "münchen.de" -> punycode note: "${puny}"; requests google=${counts.g} cloudflare=${counts.c}`);

  /* ---- agreeing A records: side-by-side columns, statuses, AD chip, match callout ---- */
  await lookup("example.com", "A");
  const gCol = await colText("colG"), cCol = await colText("colC");
  const co = await calloutText();
  if (!gCol.includes("NOERROR") || !cCol.includes("NOERROR")) throw new Error("NOERROR status word missing");
  if (!gCol.includes("DNSSEC ✓ authenticated")) throw new Error("AD chip missing on Google column");
  if (!cCol.includes("DNSSEC not validated")) throw new Error("AD-off chip missing on Cloudflare column");
  if (!/Answers match/.test(co)) throw new Error("match callout missing: " + co);
  const rows = await page.evaluate(() => ({
    g: document.querySelectorAll("#colG .ans").length, c: document.querySelectorAll("#colC .ans").length }));
  log(`example.com A: google col "${gCol.slice(0, 120)}…"`);
  log(`  cloudflare col "${cCol.slice(0, 110)}…"`);
  log(`  ${rows.g}+${rows.c} answer rows (name/TTL/data), AD chip on Google only, callout: "${co}"`);
  log(`  (fixture orders differ and Google uses trailing dots — match is order-insensitive and normalized)`);
  const cacheKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter(k => k.startsWith("suite.cache.dns.")).sort());
  if (!cacheKeys.includes("suite.cache.dns.google.A.example.com") ||
      !cacheKeys.includes("suite.cache.dns.cloudflare.A.example.com"))
    throw new Error("cache identity keys missing: " + cacheKeys.join(", "));
  log(`cache identity keys (dns.<resolver>.<type>.<name>): ${cacheKeys.join(", ")}`);

  /* ---- MX: priority + host split ---- */
  await lookup("gmail.com", "MX");
  const mx = await page.evaluate(() => {
    const first = document.querySelector("#colG .ans");
    return { prio: first.querySelector(".prio").textContent, host: first.querySelector(".host").textContent };
  });
  if (mx.prio !== "priority 5" || mx.host !== "gmail-smtp-in.l.google.com")
    throw new Error("MX split wrong: " + JSON.stringify(mx));
  log(`gmail.com MX: first row split into [${mx.prio}] + host "${mx.host}"; callout: "${await calloutText()}"`);

  /* ---- TXT: unquoted, chunks joined, hostile markup inert ---- */
  await lookup("example.org", "TXT");
  const txt = await page.evaluate(() => ({
    values: [...document.querySelectorAll("#colG .ans-data")].map(d => d.textContent),
    injected: document.querySelectorAll("#colG .ans-data b, #colC .ans-data b").length,
  }));
  if (!txt.values.includes("v=spf1 -all")) throw new Error("TXT not unquoted: " + JSON.stringify(txt.values));
  if (!txt.values.includes("chunk-onechunk-two")) throw new Error("TXT chunks not joined: " + JSON.stringify(txt.values));
  if (txt.injected !== 0 || !txt.values.some(v => v.includes("<b>hostile</b>")))
    throw new Error("hostile TXT markup not inert: " + JSON.stringify(txt));
  log(`example.org TXT: unquoted "${txt.values[0]}", chunks joined "${txt.values[1]}", ` +
    `hostile "<b>" chunk rendered as text (0 injected elements)`);

  /* ---- SOA: labeled fields ---- */
  await lookup("example.com", "SOA");
  const soa = await colText("colG");
  for (const bit of ["Primary NS", "ns.icann.org", "Admin mailbox", "Serial", "2024081461", "Refresh", "7200 s", "Minimum TTL"])
    if (!soa.includes(bit)) throw new Error(`SOA field "${bit}" missing: ${soa}`);
  log(`example.com SOA: labeled fields render — "${soa.slice(soa.indexOf("Primary NS"), soa.indexOf("Primary NS") + 120)}…"`);

  /* ---- NXDOMAIN: Status 3 decoded to words ---- */
  await lookup("no-such-host.example.com", "A");
  const nxG = await colText("colG"), nxCo = await calloutText();
  if (!nxG.includes("NXDOMAIN") || !nxG.includes("does not exist")) throw new Error("NXDOMAIN not decoded: " + nxG);
  if (!nxCo.includes("NXDOMAIN")) throw new Error("NXDOMAIN callout wrong: " + nxCo);
  log(`no-such-host.example.com A: status decoded "${nxG.slice(0, 100)}…"; callout: "${nxCo}"`);

  /* ---- disagreement: Cloudflare returns an extra A -> callout ---- */
  await lookup("disagree.example.com", "A");
  const dis = await calloutText();
  const disClass = await page.evaluate(() => document.getElementById("callout").className);
  if (!/disagree/i.test(dis) || !dis.includes("203.0.113.9") || !disClass.includes("warn"))
    throw new Error(`disagreement callout wrong: class="${disClass}" text="${dis}"`);
  log(`disagree.example.com A: callout (${disClass}): "${dis}"`);
  await page.screenshot({ path: `${evidenceDir}/disagree.png`, fullPage: true });

  /* ---- one-resolver-500: sibling page quarantines the inherent console noise ---- */
  const p2 = await page.context().newPage();
  const p2Console = [];
  p2.on("console", m => { if (m.type() === "error") p2Console.push(m.text().slice(0, 140)); });
  p2.on("pageerror", e => p2Console.push("PAGEERROR: " + String(e).slice(0, 140)));
  await p2.route(gRoute, r => r.fulfill({ status: 500, contentType: "text/plain", body: "boom" }));
  await p2.route(cRoute, make("c"));
  await p2.goto(page.url());
  await p2.fill("#domain", "half.example.com");
  await p2.selectOption("#rtype", "A");
  await p2.click("#goBtn");
  await waitDone(p2);
  const half = await p2.evaluate(() => ({
    errCard: (document.querySelector("#colG .errcard") || { innerText: "" }).innerText.replace(/\s+/g, " ").trim(),
    cfRows: document.querySelectorAll("#colC .ans").length,
    cfText: document.getElementById("colC").innerText.replace(/\s+/g, " ").trim(),
    callout: document.getElementById("callout").textContent.trim(),
  }));
  if (!half.errCard.includes("HTTP 500") || half.cfRows < 1 || !/Comparison unavailable/.test(half.callout))
    throw new Error("one-resolver-500 path wrong: " + JSON.stringify(half));
  log(`one-resolver-500 (google 500, cloudflare ok): error card "${half.errCard}"`);
  log(`  cloudflare column still renders ${half.cfRows} row(s): "${half.cfText.slice(0, 90)}…"; callout: "${half.callout}"`);
  await p2.screenshot({ path: `${evidenceDir}/one-resolver-500.png`, fullPage: true });
  log(`  sibling-page console (inherent non-2xx fetch noise, quarantined off the main gate): ` +
    (p2Console.join(" | ") || "(none)"));
  await p2.close();

  /* ---- history: write order, dedupe, bound 10, chip re-query ---- */
  let hist = await page.evaluate(() => JSON.parse(localStorage.getItem("suite.dns.history")));
  log(`suite.dns.history (newest first): ${hist.map(h => h.n + "/" + h.t).join(", ")}`);
  if (hist[0].n !== "half.example.com" || hist.length !== 8)
    throw new Error("history order/length wrong: " + JSON.stringify(hist));
  const reqBefore = counts.g + counts.c;
  await lookup("example.com", "A"); /* repeat: dedupe + fresh-cache hit */
  hist = await page.evaluate(() => JSON.parse(localStorage.getItem("suite.dns.history")));
  const dup = hist.filter(h => h.n === "example.com" && h.t === "A").length;
  if (dup !== 1 || hist[0].n !== "example.com" || hist.length !== 8)
    throw new Error("history dedupe failed: " + JSON.stringify(hist));
  log(`dedupe: re-ran example.com A -> moved to front, 1 occurrence, length still ${hist.length}; ` +
    `${counts.g + counts.c - reqBefore} new requests (served from fresh 10-min cache)`);
  const chips = await page.evaluate(() => [...document.querySelectorAll("#histList .hchip")].map(b => b.textContent));
  if (chips.length !== hist.length || chips[0] !== "example.com · A")
    throw new Error("history chips mismatch: " + JSON.stringify(chips));
  log(`history chips rendered: [${chips.join(" | ")}]`);

  /* bound: seed 10 entries, a new lookup must keep length at 10 */
  await page.evaluate(() => localStorage.setItem("suite.dns.history", JSON.stringify(
    Array.from({ length: 10 }, (_, i) => ({ n: `seed${i}.example.com`, t: "NS" })))));
  await lookup("gmail.com", "MX"); /* cached -> no requests */
  hist = await page.evaluate(() => JSON.parse(localStorage.getItem("suite.dns.history")));
  if (hist.length !== 10 || hist[0].n !== "gmail.com" || hist.some(h => h.n === "seed9.example.com"))
    throw new Error("history bound failed: " + JSON.stringify(hist));
  log(`bound: seeded 10 entries then looked up gmail.com MX -> length stays 10, oldest (seed9) dropped`);

  /* chip re-query: expire the gmail MX cache, click its chip, expect 1 request per resolver */
  await page.evaluate(() => {
    for (const k of ["suite.cache.dns.google.MX.gmail.com", "suite.cache.dns.cloudflare.MX.gmail.com"]) {
      const e = JSON.parse(localStorage.getItem(k));
      e.t = Date.now() - 11 * 60000; /* past the 10-min TTL */
      localStorage.setItem(k, JSON.stringify(e));
    }
  });
  const b2 = { g: counts.g, c: counts.c };
  await page.evaluate(() => document.getElementById("results").removeAttribute("data-done"));
  await page.click('#histList .hchip[data-n="gmail.com"][data-t="MX"]');
  await waitDone(page);
  const title = (await page.textContent("#qTitle")).trim();
  if (counts.g !== b2.g + 1 || counts.c !== b2.c + 1 || title !== "gmail.com · MX")
    throw new Error(`chip re-query wrong: +${counts.g - b2.g}/+${counts.c - b2.c} requests, title "${title}"`);
  log(`history chip click re-queries: title "${title}", +1 request to each resolver (cache expired first)`);
  log(`cloudflare Accept header observed on routed requests: "${cfAccept}"`);
  if (cfAccept !== "application/dns-json") throw new Error("Cloudflare Accept header wrong: " + cfAccept);

  /* ---- stale-offline path: back-date caches, abort all network ---- */
  await page.unroute(gRoute);
  await page.unroute(cRoute);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("suite.cache.")) {
        const e = JSON.parse(localStorage.getItem(k));
        e.t = Date.now() - 60 * 60000;
        localStorage.setItem(k, JSON.stringify(e));
      }
    }
  });
  await page.context().route(/^https?:/, r => r.abort());
  await lookup("example.com", "A");
  const staleG = await colText("colG"), staleC = await colText("colC");
  if (!staleG.includes("Offline — cached from") || !staleC.includes("Offline — cached from"))
    throw new Error(`stale stamps missing: G="${staleG}" C="${staleC}"`);
  log(`offline + stale cache: google col "${staleG.slice(0, 110)}…"`);
  log(`  cloudflare col "${staleC.slice(0, 110)}…"`);
  log(`  both columns carry the per-column "Offline — cached from …" stamp; callout still compares: "${await calloutText()}"`);
  await page.screenshot({ path: `${evidenceDir}/offline-stale.png`, fullPage: true });
  await page.context().unroute(/^https?:/);

  /* ---- restore a fresh-cache view for the after shot (no refetch needed) ---- */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("suite.cache.")) {
        const e = JSON.parse(localStorage.getItem(k));
        e.t = Date.now();
        localStorage.setItem(k, JSON.stringify(e));
      }
    }
  });
  await lookup("example.com", "A");
  log(`restored: example.com A re-rendered from fresh cache without refetch (stale stamp gone: ` +
    `${!(await colText("colG")).includes("Offline")})`);

  /* ---- mobile: 390 px wide, no horizontal overflow ---- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    bsw: document.body.scrollWidth,
  }));
  if (m.sw > m.cw) throw new Error("horizontal overflow at 390px: " + JSON.stringify(m));
  log(`mobile 390px: scrollWidth ${m.sw} <= clientWidth ${m.cw} (no horizontal overflow; columns stack)`);
  await page.screenshot({ path: `${evidenceDir}/mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
}
