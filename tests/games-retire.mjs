/* Evidence for the Meteor Patrol retirement (ROADMAP, 2026-07-25).
   Proves: the Meteor Patrol prototype and its work-in-progress card are gone from the built
   hub in both themes, every category still renders with its count, and the un-built
   source-hub guard card — the other user of .card.wip — still works.
   v4 note: the games category deliberately reopened with The Arcade, so this script no
   longer asserts the word "Games" is absent — only the retired prototype's remnants. */
import { chromium } from "playwright";
import { writeFileSync } from "fs";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const OUT = REPO + "/tests/evidence/games-retire";
const lines = [];
const say = s => { lines.push(s); console.log(s); };

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push("pageerror: " + e.message));

await page.goto("file://" + REPO + "/dist/index.html");
await page.waitForTimeout(400);

/* both palettes explicitly, rather than trusting the headless default */
const setTheme = t => page.evaluate(t => { document.documentElement.dataset.theme = t; }, t);
const theme = () => page.evaluate(() => document.documentElement.dataset.theme || "(system)");
await setTheme("light");
say("built hub, theme=" + await theme());
await page.screenshot({ path: OUT + "/hub-light.png", fullPage: true });
await setTheme("dark");
say("built hub, theme=" + await theme());
await page.screenshot({ path: OUT + "/hub-dark.png", fullPage: true });
/* the toggle itself still works after the games block was removed */
await page.click("#themeBtn");
await page.waitForTimeout(200);
say("theme button click → " + await theme() + " (flips)");

const cats = await page.evaluate(() =>
  [...document.querySelectorAll("#cats h2")].map(h => h.textContent.replace(/\s+/g, " ").trim()));
say("");
say("categories rendered (" + cats.length + "):");
cats.forEach(c => say("  " + c));

const body = await page.evaluate(() => document.body.innerText);
const total = cats.reduce((n, c) => n + (+(c.match(/(\d+) tools?/) || [0, 0])[1]), 0);
say("");
say("sum of per-category counts: " + total + "  (manifest: 100 tools + hub)");
for (const needle of ["Meteor Patrol", "work in progress", "in the workshop"]) {
  say(`absent from built hub — ${JSON.stringify(needle)}: ${!body.includes(needle) ? "YES" : "NO ***"}`);
}
say("console errors on the built hub: " + errors.length);

/* the other .card.wip user: opening the un-built source hub must still explain itself */
const guardErrors = [];
const p2 = await b.newPage({ viewport: { width: 1280, height: 700 } });
p2.on("console", m => { if (m.type() === "error") guardErrors.push(m.text()); });
await p2.goto("file://" + REPO + "/tools/index.html");
await p2.waitForTimeout(300);
const guard = await p2.evaluate(() => {
  const el = document.querySelector(".card.wip");
  return { present: !!el, dashed: el ? getComputedStyle(el).borderStyle : null, text: el ? el.innerText.split("\n")[0] : null };
});
say("");
say("source-hub guard card present: " + guard.present + "  border-style: " + guard.dashed);
say("source-hub guard heading: " + JSON.stringify(guard.text));
say("console errors on the source hub: " + guardErrors.length);
await p2.screenshot({ path: OUT + "/source-hub-guard.png", fullPage: true });

await b.close();
writeFileSync(OUT + "/verification.txt", lines.join("\n") + "\n");
