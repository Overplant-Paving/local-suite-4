/* verify-tool.mjs — generic per-tool Definition-of-Done evidence (MIGRATION.md §1 step 10).
   Verifies the SOURCE file (tools/<tool>.html runs from file:// via relative core links);
   the dist build of the same markup is covered by the staleness gate + smoke.mjs.

   Run (from tests/):  node verify-tool.mjs <tool>        e.g. node verify-tool.mjs qr

   Per-tool interactions live in tests/interactions/<tool>.mjs:
     export const selectors = ["body", ".btn", ...];      // computed-style diff targets
     export async function interact({ page, log, evidenceDir }) { ... }   // exercised on v2
     export async function v1Interact({ page, log }) { ... }              // optional, for
       // localStorage parity: perform the SAME state-writing actions on the v1 original
     export const screenshotAfterInteract = false;         // optional: shoot post-interaction too
     export const printShots = false;                      // optional: print-media screenshots   */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const V1 = resolve(ROOT, "..", "Local Suite");
const tool = process.argv[2];
if (!tool) { console.error("usage: node verify-tool.mjs <tool>"); process.exit(1); }
const EV = join(ROOT, "tests", "evidence", tool);
mkdirSync(EV, { recursive: true });

// tools born in v2 (settings.html, future --new scaffolds) have no v1 original:
// the v1 capture, style diff, and localStorage parity sections go N/A, explicitly.
const hasV1 = existsSync(join(V1, `${tool}.html`));
const v1Url = pathToFileURL(join(V1, `${tool}.html`)).href;
const v2Url = pathToFileURL(join(ROOT, "tools", `${tool}.html`)).href;
const VIEWPORT = { width: 1280, height: 900 };

const mod = await import(`./interactions/${tool}.mjs`);
const selectors = mod.selectors || ["body", "header h1", ".theme-btn", "footer"];

let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
} catch (e) {
  if (!String(e).includes("distribution 'chrome' is not found")) throw e;
  console.warn("installed Chrome not found; using Playwright Chromium for local verification");
  browser = await chromium.launch();
}

async function newPage(theme) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const issues = [];
  page.on("console", m => { if (m.type() === "error") issues.push(`console.error: ${m.text().slice(0, 200)}`); });
  page.on("pageerror", e => issues.push(`pageerror: ${String(e).slice(0, 200)}`));
  await page.addInitScript(t => {
    try { t ? localStorage.setItem("suite.theme", t) : localStorage.removeItem("suite.theme"); } catch (e) {}
  }, theme);
  return { ctx, page, issues };
}

async function computedStyles(page) {
  return page.evaluate(sels => {
    const res = {};
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { res[sel] = null; continue; }
      const cs = getComputedStyle(el); const map = {};
      for (const prop of cs) map[prop] = cs.getPropertyValue(prop);
      res[sel] = map;
    }
    return res;
  }, selectors);
}

async function lsSnapshot(page) {
  return page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), v = localStorage.getItem(k);
      o[k] = v.length > 150 ? v.slice(0, 150) + `…(${v.length} chars)` : v;
    }
    return o;
  });
}

/* screenshots + styles, both themes, one version */
async function capture(url, prefix) {
  const styles = {};
  for (const theme of ["light", "dark"]) {
    const { ctx, page } = await newPage(theme);
    await page.goto(url);
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(EV, `${prefix}-${theme}.png`), fullPage: true });
    styles[theme] = await computedStyles(page);
    if (mod.printShots && theme === "light") {
      await page.emulateMedia({ media: "print" });
      await page.screenshot({ path: join(EV, `${prefix}-print.png`), fullPage: true });
      await page.emulateMedia({ media: "screen" });
    }
    await ctx.close();
  }
  return styles;
}

const v1Styles = hasV1 ? await capture(v1Url, "v1") : null;
const v2Styles = await capture(v2Url, "v2");

let styleReport = hasV1 ? "" :
  "(new-in-v2 tool — no v1 original; parity N/A. Both-theme captures are in v2-*.png.)\n";
for (const theme of hasV1 ? ["light", "dark"] : []) {
  const lines = [];
  for (const sel of selectors) {
    const a = v1Styles[theme][sel], b = v2Styles[theme][sel];
    if (!a && !b) continue;
    if (!a || !b) { lines.push(`${sel}: present in only one version (v1=${!!a} v2=${!!b})`); continue; }
    for (const prop of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[prop] !== b[prop]) lines.push(`${sel} { ${prop}: v1=${a[prop]} | v2=${b[prop]} }`);
    }
  }
  styleReport += `== computed-style diff, ${theme} (${lines.length} differing values) ==\n` +
    (lines.length ? lines.join("\n") : "(none)") + "\n\n";
}
writeFileSync(join(EV, "computed-style-diff.txt"), styleReport);

/* interaction pass on v2 (light theme), collecting console issues */
const log = [];
const { ctx, page, issues } = await newPage("light");
if (mod.beforeGoto) await mod.beforeGoto({ page });
await page.goto(v2Url);
await page.waitForTimeout(400);
await mod.interact({ page, log: s => log.push(s), evidenceDir: EV });
// theme toggle probe (every tool)
const btn = page.locator("#themeBtn, .theme-btn").first();
const before = await page.evaluate(() => document.documentElement.dataset.theme || "unset");
await btn.click();
const after = await page.evaluate(() => document.documentElement.dataset.theme || "unset");
log.push(`theme toggle: ${before} -> ${after}, aria-pressed=${await btn.getAttribute("aria-pressed")}`);
if (mod.screenshotAfterInteract) {
  await page.screenshot({ path: join(EV, "v2-after-interaction.png"), fullPage: true });
}
const v2ls = await lsSnapshot(page);
log.push(issues.length ? `CONSOLE ISSUES:\n  ${issues.join("\n  ")}` : "console: clean (no errors)");
writeFileSync(join(EV, "interaction.txt"), log.join("\n") + "\n");
await ctx.close();

/* localStorage parity vs v1 */
let v1ls = {};
if (hasV1) {
  const p = await newPage("light");
  await p.page.goto(v1Url);
  await p.page.waitForTimeout(400);
  if (mod.v1Interact) await mod.v1Interact({ page: p.page, log: () => {} });
  await p.page.locator("#themeBtn, .theme-btn").first().click(); // v1 theme write
  v1ls = await lsSnapshot(p.page);
  await p.ctx.close();
}
writeFileSync(join(EV, "localstorage.json"), JSON.stringify(hasV1 ? {
  v1: v1ls, v2: v2ls,
  keysOnlyInV1: Object.keys(v1ls).filter(k => !(k in v2ls)),
  keysOnlyInV2: Object.keys(v2ls).filter(k => !(k in v1ls)),
} : { note: "new-in-v2 tool — no v1 original; parity N/A", v2: v2ls }, null, 2));

await browser.close();
console.log(`evidence written to tests/evidence/${tool}/`);
const hardIssues = issues.filter(s => !s.includes("net::ERR"));
if (hardIssues.length) { console.error("CONSOLE ISSUES FOUND — fix before claiming done"); process.exit(2); }
