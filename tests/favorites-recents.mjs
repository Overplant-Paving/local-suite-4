/* Focused v4 contract: suite-wide favorites + recently used.
   Deterministic (no network): built pages from file://, one context = shared
   localStorage + real cross-tab storage events. Run from tests/:
   node favorites-recents.mjs                                    exit 0 = green */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const url = f => pathToFileURL(join(ROOT, "dist", f)).href;
let browser;
try { browser = await chromium.launch({ channel: "chrome" }); }
catch (e) {
  if (!String(e).includes("distribution 'chrome' is not found")) throw e;
  browser = await chromium.launch();
}
const failures = [];
const check = (name, ok, detail = "") => {
  console.log((ok ? "ok   " : "FAIL ") + name + (ok || !detail ? "" : "  — " + detail));
  if (!ok) failures.push(name);
};

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const errs = [];
const hub = await ctx.newPage();
hub.on("pageerror", e => errs.push("hub: " + e));
hub.on("console", m => { if (m.type() === "error") errs.push("hub console: " + m.text()); });

/* seed: a retired/unknown id must be ignored everywhere, never an error */
await hub.addInitScript(() => {
  localStorage.setItem("suite.hub.favorites", JSON.stringify(["ghost-retired-tool", "weather"]));
  localStorage.setItem("suite.hub.recents", JSON.stringify([{ id: "no-such-tool", t: Date.now() }]));
});
await hub.goto(url("index.html"));
await hub.waitForTimeout(400);

const seeded = await hub.evaluate(() => ({
  favCards: [...document.querySelectorAll("#favGrid .card h3 a")].map(a => a.textContent),
  favHidden: document.getElementById("favSec").hidden,
  recHidden: document.getElementById("recSec").hidden,
}));
check("unknown favorite id ignored, known one renders",
  !seeded.favHidden && seeded.favCards.join(",") === "Weather Station", JSON.stringify(seeded));
check("recents with only unknown ids stays hidden", seeded.recHidden);

/* hub card star: toggle + aria-pressed + persistence */
const star = hub.locator('#cats .fav-btn[data-tool="convert"]');
check("hub card star has aria-label", /Favorite Unit & Kitchen Converter/.test(await star.getAttribute("aria-label") || ""));
await star.click();
let s = await hub.evaluate(() => ({
  favs: JSON.parse(localStorage.getItem("suite.hub.favorites")),
  pressed: document.querySelector('#cats .fav-btn[data-tool="convert"]').getAttribute("aria-pressed"),
  inFavGrid: [...document.querySelectorAll("#favGrid .card h3 a")].map(a => a.textContent),
}));
check("hub star toggles storage + pressed state",
  s.favs.includes("convert") && s.pressed === "true" && s.inFavGrid.includes("Unit & Kitchen Converter"),
  JSON.stringify(s));
await hub.locator('#favGrid .fav-btn[data-tool="convert"]').click();
s = await hub.evaluate(() => ({
  favs: JSON.parse(localStorage.getItem("suite.hub.favorites")),
  pressed: document.querySelector('#cats .fav-btn[data-tool="convert"]').getAttribute("aria-pressed"),
}));
check("unfavoriting from the Favorites section works", !s.favs.includes("convert") && s.pressed === "false", JSON.stringify(s));

/* filters hide quick access; clearing restores it */
await hub.fill("#q", "weather");
let vis = await hub.evaluate(() => ({ fav: document.getElementById("favSec").hidden, rec: document.getElementById("recSec").hidden }));
check("search hides the quick-access sections", vis.fav && vis.rec);
await hub.fill("#q", "");
vis = await hub.evaluate(() => document.getElementById("favSec").hidden);
check("clearing the search restores Favorites", vis === false);

/* tool page: recents recorded, chrome star injected, keyboard-activatable */
const tool = await ctx.newPage();
tool.on("pageerror", e => errs.push("tool: " + e));
await tool.goto(url("qr.html"));
await tool.waitForTimeout(200);
const chrome = await tool.evaluate(() => {
  const b = document.querySelector(".fav-btn");
  return {
    present: !!b, tag: b && b.tagName, pressed: b && b.getAttribute("aria-pressed"),
    label: b && b.getAttribute("aria-label"),
    recents: JSON.parse(localStorage.getItem("suite.hub.recents") || "[]").map(r => r.id),
  };
});
check("tool chrome star is a native button with aria-pressed",
  chrome.present && chrome.tag === "BUTTON" && chrome.pressed === "false" && /Favorite/.test(chrome.label || ""));
check("opening a tool records it first in recents", chrome.recents[0] === "qr", JSON.stringify(chrome.recents));
await tool.focus(".fav-btn");
await tool.keyboard.press("Enter");
const kbd = await tool.evaluate(() => ({
  pressed: document.querySelector(".fav-btn").getAttribute("aria-pressed"),
  favs: JSON.parse(localStorage.getItem("suite.hub.favorites")),
}));
check("keyboard Enter toggles the chrome star", kbd.pressed === "true" && kbd.favs.includes("qr"), JSON.stringify(kbd));

/* cross-tab: the hub hears the storage events without a reload.
   Wait for the observable state rather than assuming CI dispatches both storage
   events inside a fixed sleep. */
await hub.waitForFunction(() =>
  [...document.querySelectorAll("#favGrid .card h3 a")].some(a => a.textContent === "QR Code Maker") &&
  [...document.querySelectorAll("#recRow a")].some(a => a.textContent === "QR Code Maker"),
  null,
  { timeout: 5000 });
const cross = await hub.evaluate(() => ({
  favCards: [...document.querySelectorAll("#favGrid .card h3 a")].map(a => a.textContent),
  recChips: [...document.querySelectorAll("#recRow a")].map(a => a.textContent),
}));
check("cross-tab: hub favorites updated live", cross.favCards.includes("QR Code Maker"), JSON.stringify(cross.favCards));
check("cross-tab: hub recents updated live", cross.recChips.includes("QR Code Maker"), JSON.stringify(cross.recChips));

/* dedupe + order: revisiting moves to front, no duplicate */
await tool.goto(url("convert.html"));
await tool.waitForTimeout(200);
await tool.goto(url("qr.html"));
await tool.waitForTimeout(200);
const order = await tool.evaluate(() => JSON.parse(localStorage.getItem("suite.hub.recents")).map(r => r.id));
check("recents dedupe + most-recent-first", order[0] === "qr" && order[1] === "convert" &&
  order.filter(x => x === "qr").length === 1, JSON.stringify(order));

/* bounded list */
await tool.evaluate(() => localStorage.setItem("suite.hub.recents", JSON.stringify(
  Array.from({ length: 10 }, (_, i) => ({ id: "tool" + i, t: Date.now() - i * 1000 })))));
await tool.goto(url("text.html"));
await tool.waitForTimeout(200);
const bounded = await tool.evaluate(() => JSON.parse(localStorage.getItem("suite.hub.recents")).map(r => r.id));
check("recents bounded at 10, newest kept", bounded.length === 10 && bounded[0] === "text" && !bounded.includes("tool9"),
  JSON.stringify(bounded));

/* exclusions: hub and settings never enter recents; settings still favoritable */
await tool.goto(url("settings.html"));
await tool.waitForTimeout(300);
await tool.goto(url("index.html"));
await tool.waitForTimeout(300);
const excl = await tool.evaluate(() => JSON.parse(localStorage.getItem("suite.hub.recents")).map(r => r.id));
check("hub + settings excluded from recents", !excl.includes("settings") && !excl.includes("index"), JSON.stringify(excl));

/* clear button announces and empties */
const clear = await tool.evaluate(() => {
  document.getElementById("recClear").click();
  return {
    stored: localStorage.getItem("suite.hub.recents"),
    hidden: document.getElementById("recSec").hidden,
    status: document.getElementById("resStatus").textContent,
  };
});
check("clear empties recents + hides section + announces",
  clear.stored === null && clear.hidden && /cleared/i.test(clear.status), JSON.stringify(clear));

/* mobile: populated quick access must not overflow horizontally */
const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mpage = await mob.newPage();
await mpage.addInitScript(() => {
  localStorage.setItem("suite.hub.favorites", JSON.stringify(["weather", "qr", "notes"]));
  localStorage.setItem("suite.hub.recents", JSON.stringify(
    ["convert", "text", "color", "loan"].map((id, i) => ({ id, t: Date.now() - i * 60000 }))));
});
await mpage.goto(url("index.html"));
await mpage.waitForTimeout(400);
const mobile = await mpage.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  favCards: document.querySelectorAll("#favGrid .card").length,
  recChips: document.querySelectorAll("#recRow a").length,
}));
check("mobile 390px: sections render, no horizontal overflow",
  !mobile.overflow && mobile.favCards === 3 && mobile.recChips === 4, JSON.stringify(mobile));
await mob.close();

check("zero console/page errors", errs.length === 0, errs.join(" | "));
await ctx.close();
await browser.close();
console.log(failures.length ? `\nfavorites-recents: ${failures.length} FAILURE(S)` : "\nfavorites-recents: PASS");
process.exit(failures.length ? 1 : 0);
