/* Built Arcade contract: seven cards, honest live-Pages destinations, inlined art,
   alt text, external-link safety, keyboard focus, CSP, file:// + hosted mode, mobile.
   Deterministic — no request leaves the page (the cards are links, not fetches).
   Run from tests/:  node arcade-built.mjs                          exit 0 = green */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const ROOT = resolve(import.meta.dirname, "..");
const EXPECT = [
  ["Bathhouse Brigade", "Desktop · keyboard", "https://overplant-paving.github.io/bathhouse-brigade/", "https://github.com/Overplant-Paving/bathhouse-brigade", "Soviet-constructivist falling blocks"],
  ["Bathhouse Brigade — Mobile Detail", "Mobile · touch + keyboard", "https://overplant-paving.github.io/bathhouse-brigade-mobile/", "https://github.com/Overplant-Paving/bathhouse-brigade-mobile", "phone in portrait"],
  ["Chromatic Chains — Desktop Edition", "Desktop · mouse + keyboard", "https://overplant-paving.github.io/chromatic-chains-desktop/", "https://github.com/Overplant-Paving/chromatic-chains-desktop", "glowing colored glass beads"],
  ["Chromatic Chains — Mobile Edition", "Mobile · touch-first", "https://overplant-paving.github.io/chromatic-chains-mobile/", "https://github.com/Overplant-Paving/chromatic-chains-mobile", "portrait title scene"],
  ["DOOM (1993) — Shareware", "Desktop + touch", "https://overplant-paving.github.io/doom-shareware/", "https://github.com/Overplant-Paving/doom-shareware", "DOOM title screen"],
  ["Unicorn 42069er: The Sprinkle Mines", "Desktop · keyboard", "https://overplant-paving.github.io/unicorn-42069er/", "https://github.com/Overplant-Paving/unicorn-42069er", "pastel candy-mine entrance"],
  ["Miner 42069er", "Desktop · keyboard", "https://overplant-paving.github.io/miner-42069er/", "https://github.com/Overplant-Paving/miner-42069er", "timbered mine entrance"],
];

let browser;
try { browser = await chromium.launch({ channel: "chrome" }); }
catch (e) {
  if (!String(e).includes("distribution 'chrome' is not found")) throw e;
  browser = await chromium.launch();
}
const failures = [];
const check = (n, ok, d = "") => { console.log((ok ? "ok   " : "FAIL ") + n + (ok || !d ? "" : "  — " + d)); if (!ok) failures.push(n); };

async function audit(page, modeName) {
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", e => window.__csp.push(e.violatedDirective + " " + (e.blockedURI || "inline")));
  });
  return { errs, csp: () => page.evaluate(() => window.__csp) };
}

/* ---- file:// mode ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const mon = await audit(page, "file");
  let escaped = 0;
  await page.route(/^https?:/, r => { escaped++; r.abort(); });
  await page.goto(pathToFileURL(join(ROOT, "dist", "arcade.html")).href);
  await page.waitForTimeout(600);

  const cards = await page.evaluate(() => [...document.querySelectorAll(".game")].map(c => ({
    title: c.querySelector("h2 a")?.textContent.trim(),
    headingHref: c.querySelector("h2 a")?.getAttribute("href"),
    edition: c.querySelector(".chips .chip")?.textContent.trim(),
    artHref: c.querySelector("a.art")?.getAttribute("href"),
    play: c.querySelector("a.play")?.getAttribute("href"),
    playLabel: c.querySelector("a.play")?.textContent.trim(),
    src: c.querySelector("a.src")?.getAttribute("href"),
    rels: [...c.querySelectorAll("a[href^='http']")].map(a => a.getAttribute("rel") + "|" + a.getAttribute("target")),
    imgData: (c.querySelector(".art img")?.getAttribute("src") || "").startsWith("data:image/"),
    imgLoaded: (i => i && i.complete && i.naturalWidth > 0)(c.querySelector(".art img")),
    alt: c.querySelector(".art img")?.getAttribute("alt") || "",
    artLabel: c.querySelector("a.art")?.getAttribute("aria-label") || "",
  })));
  check("seven cards render", cards.length === 7, String(cards.length));
  EXPECT.forEach(([title, edition, play, src, altFragment], i) => {
    const c = cards[i] || {};
    check(`card ${i + 1}: ${title}`,
      c.title === title && c.edition === edition && c.play === play && c.src === src &&
        c.artHref === play && c.headingHref === play,
      JSON.stringify(c));
    check(`card ${i + 1} art inlined as data URI, decoded, meaningful alt`,
      c.imgData && c.imgLoaded && c.alt.includes(altFragment) && /new tab/.test(c.artLabel),
      JSON.stringify({ imgData: c.imgData, imgLoaded: c.imgLoaded, alt: c.alt.slice(0, 80) }));
    check(`card ${i + 1} external links are noopener+_blank`,
      c.rels.length >= 3 && c.rels.every(r => /noopener/.test(r) && /_blank/.test(r)), JSON.stringify(c.rels));
  });
  check("playable labels say what happens", cards.every(c => /Play in your browser/.test(c.playLabel || "")));
  check("DOOM card credits id Software and disclaims open source",
    await page.evaluate(() => /© id Software/.test(document.body.innerText) && /not open source/.test(document.body.innerText)));
  check("no network request escapes the page on load", escaped === 0, String(escaped));

  /* keyboard: tab reaches the first art link and Enter would activate (assert focusability) */
  const focusable = await page.evaluate(() => {
    const a = document.querySelector("a.art");
    a.focus();
    return document.activeElement === a;
  });
  check("card art link is keyboard-focusable", focusable);
  check("file:// zero console/page errors", mon.errs.length === 0, mon.errs.join("|"));
  check("file:// zero CSP violations", (await mon.csp()).length === 0, (await mon.csp()).join("|"));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  check("mobile 390px: no horizontal overflow",
    !await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth));
  await ctx.close();
}

/* ---- hosted mode (real http server over dist/) ---- */
{
  const server = createServer((req, res) => {
    try {
      const f = req.url === "/" ? "/index.html" : req.url.split("?")[0];
      const body = readFileSync(join(ROOT, "dist", f));
      const type = f.endsWith(".html") ? "text/html" : f.endsWith(".js") ? "text/javascript"
        : f.endsWith(".webmanifest") ? "application/manifest+json"
        : f.endsWith(".png") ? "image/png" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(body);
    } catch (e) { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const mon = await audit(page, "hosted");
  await page.goto(`http://127.0.0.1:${port}/arcade.html`);
  await page.waitForTimeout(700);
  const hosted = await page.evaluate(() => ({
    cards: document.querySelectorAll(".game").length,
    imgs: [...document.querySelectorAll(".art img")].every(i => i.complete && i.naturalWidth > 0),
  }));
  check("hosted mode: seven cards, art decodes", hosted.cards === 7 && hosted.imgs, JSON.stringify(hosted));
  check("hosted zero console/page errors", mon.errs.length === 0, mon.errs.join("|"));
  check("hosted zero CSP violations", (await mon.csp()).length === 0, (await mon.csp()).join("|"));
  await ctx.close();
  server.close();
}

await browser.close();
console.log(failures.length ? `\narcade: ${failures.length} FAILURE(S)` : "\narcade: PASS");
process.exit(failures.length ? 1 : 0);
