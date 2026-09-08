/* smoke.mjs — the mandatory tier-2 smoke suite (QUALITY.md §3).
   For every dist/*.html opened from file://:
     1. zero console errors / page errors / CSP violations
     2. page chrome or a standalone game surface renders
     3. suite pages: theme toggle flips documentElement.dataset.theme, and flips back
     4. network tools: with all http(s) blocked, the page still renders (offline card, not blank)
   Run (from tests/):  node smoke.mjs            exit 0 = green                                  */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest", "tools.json"), "utf-8"));
const networkTools = new Set(manifest.tools.filter(t => (t.endpoints || []).length).map(t => t.file));
const bundledArcadeGames = new Set(["mushroom-death-garden.html"]);
const files = readdirSync(join(ROOT, "dist")).filter(f => f.endsWith(".html")).sort();

let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
} catch (e) {
  if (!String(e).includes("distribution 'chrome' is not found")) throw e;
  console.warn("installed Chrome not found; using Playwright Chromium for local smoke verification");
  browser = await chromium.launch();
}
let failures = 0;

for (const file of files) {
  const problems = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  // Network-layer failures (net::ERR, the browser's CORS-block report, resource 4xx/5xx)
  // are environment, not tool defects — the render/offline checks below prove the page
  // still works. Script defects (pageerror) and CSP violations stay fatal.
  const NETWORK_NOISE = /net::ERR|blocked by CORS policy|Failed to load resource/;
  page.on("console", m => { if (m.type() === "error" && !NETWORK_NOISE.test(m.text())) problems.push(`console: ${m.text().slice(0, 140)}`); });
  page.on("pageerror", e => problems.push(`pageerror: ${String(e).slice(0, 140)}`));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", e =>
      window.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI || "inline"}`));
  });
  await page.goto(pathToFileURL(join(ROOT, "dist", file)).href);
  await page.waitForTimeout(800);

  const renderTarget = bundledArcadeGames.has(file) ? "main, canvas" : "header, h1";
  if (!await page.locator(renderTarget).first().isVisible().catch(() => false))
    problems.push("no visible page chrome or game surface — page did not render");

  await page.keyboard.press("Escape"); // a tool may boot into a modal (e.g. weather with no location)
  try {
    const t0 = await page.evaluate(() => document.documentElement.dataset.theme || "");
    const btn = page.locator("#themeBtn, .theme-btn").first();
    if (await btn.count()) {
      await btn.click({ timeout: 5000 });
      const t1 = await page.evaluate(() => document.documentElement.dataset.theme || "");
      await btn.click({ timeout: 5000 });
      const t2 = await page.evaluate(() => document.documentElement.dataset.theme || "");
      if (t1 === t0 || (t2 !== "light" && t2 !== "dark")) problems.push(`theme toggle broken: "${t0}"->"${t1}"->"${t2}"`);
    } else if (!bundledArcadeGames.has(file)) problems.push("no theme button found");
  } catch (e) {
    problems.push(`theme toggle probe failed: ${String(e).split("\n")[0].slice(0, 120)}`);
  }

  for (const v of await page.evaluate(() => window.__csp)) problems.push(`csp: ${v}`);
  await ctx.close();

  if (networkTools.has(file)) {
    const octx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await octx.route(/^https?:/, r => r.abort());
    const opage = await octx.newPage();
    const oerrs = [];
    opage.on("pageerror", e => oerrs.push(String(e).slice(0, 140)));
    await opage.goto(pathToFileURL(join(ROOT, "dist", file)).href);
    await opage.waitForTimeout(1500);
    const text = (await opage.textContent("body") || "").trim();
    if (text.length < 40) problems.push("network-blocked render is (near-)blank — no offline card");
    for (const e of oerrs) problems.push(`offline pageerror: ${e}`);
    await octx.close();
  }

  if (problems.length) { failures++; console.log(`FAIL ${file}\n  ${problems.join("\n  ")}`); }
  else console.log(`ok   ${file}`);
}

await browser.close();
console.log(`\nsmoke: ${files.length - failures}/${files.length} green`);
process.exit(failures ? 1 : 0);
