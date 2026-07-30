/* tests/interactions/skyevents.mjs — exercises Eclipses & Meteor Showers end-to-end.
   Fully offline embedded-data tool: verifies the curated eclipse canon (2026-08-12 and
   2027-08-02 flagship totals), all ten showers with ZHR, merged soonest-first ordering,
   runtime day-granularity countdowns (computed, never hardcoded), filter chips with
   aria-pressed, the collapsed "already happened" section, the almanac cross-link, the
   dataset-vintage banner, storage discipline, and mobile no-overflow. No network. */
import { join } from "node:path";

export const selectors = [
  "body", ".wrap", "header h1", ".theme-btn", "#banner", "#filters button",
  "#featured .ev", "#upcoming", "#past", "footer"
];
export const screenshotAfterInteract = true;

function assert(cond, msg) { if (!cond) throw new Error("ASSERT FAILED: " + msg); }

export async function interact({ page, log, evidenceDir }) {
  /* 1 — dataset-vintage banner */
  const banner = await page.locator("#banner").innerText();
  assert(/2026-07/.test(banner) && /[Cc]urated/.test(banner), "banner must state curated 2026-07 vintage");
  assert(/[Pp]enumbral/.test(banner), "banner must state penumbral-eclipse policy");
  log("banner (vintage + penumbral policy): " + banner.replace(/\s+/g, " ").slice(0, 140) + "…");

  /* 2 — flagship eclipse cards, wherever they live (upcoming vs already-happened
        depends on the wall clock; textContent works inside the closed <details>) */
  const flagship = await page.evaluate(() => {
    /* note: data-date alone is ambiguous — the 2026 total solar eclipse falls on the
       Perseids peak night (Aug 12), so qualify by kind */
    const grab = iso => {
      const el = document.querySelector(`.ev[data-date="${iso}"][data-kind="eclipse"]`);
      return el ? { text: el.textContent.replace(/\s+/g, " "), kind: el.dataset.kind } : null;
    };
    return { aug2026: grab("2026-08-12"), aug2027: grab("2027-08-02") };
  });
  assert(flagship.aug2026, "2026-08-12 card exists");
  for (const kw of ["Total solar eclipse", "Greenland", "Iceland", "Spain", "Arctic"])
    assert(flagship.aug2026.text.includes(kw), `2026-08-12 card mentions "${kw}"`);
  log("2026-08-12 total solar card: type + Arctic/Greenland/Iceland/Spain visibility verified");
  assert(flagship.aug2027, "2027-08-02 card exists");
  for (const kw of ["Total solar eclipse", "Spain", "Egypt", "Luxor", "longest"])
    assert(flagship.aug2027.text.includes(kw), `2027-08-02 card mentions "${kw}"`);
  log("2027-08-02 total solar card: type + Spain/N-Africa/Luxor + longest-of-century note verified");

  /* 3 — all ten showers present, each with a ZHR, a peak-night line, and the honest label */
  const SHOWERS = ["Quadrantids", "Lyrids", "Eta Aquariids", "Delta Aquariids", "Perseids",
    "Draconids", "Orionids", "Leonids", "Geminids", "Ursids"];
  const showers = await page.evaluate(() =>
    [...document.querySelectorAll('.ev[data-kind="shower"]')].map(el => ({
      name: el.dataset.name, text: el.textContent.replace(/\s+/g, " "),
    })));
  assert(showers.length === 10, `exactly 10 shower cards (got ${showers.length})`);
  for (const name of SHOWERS) {
    const c = showers.find(s => s.name === name);
    assert(c, `shower card for ${name}`);
    assert(/ZHR\s*(~\d+|variable)/.test(c.text), `${name} card shows a ZHR value`);
    assert(/Peak night \d{4}/.test(c.text), `${name} card has a current-year peak-night line`);
    assert(c.text.includes("typical peak — exact night varies by year"), `${name} peak line is honestly labeled`);
    assert(/Active [A-Z][a-z]{2} \d+ – [A-Z][a-z]{2} \d+/.test(c.text), `${name} shows its active range`);
    assert(/parent:/.test(c.text), `${name} names its parent body`);
  }
  log("all 10 showers present with ZHR, active range, parent body, and labeled peak-night lines");

  /* 4 — totals and split: 23 eclipses + 10 showers = 33 cards; past holds only bygone eclipses */
  const split = await page.evaluate(() => {
    const now = new Date();
    const todayU = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const t = sel => [...document.querySelectorAll(sel)].map(el => Number(el.dataset.t));
    return {
      featured: t("#featured .ev"), upcoming: t("#upcoming .ev"), past: t("#pastList .ev"),
      pastKinds: [...document.querySelectorAll("#pastList .ev")].map(el => el.dataset.kind),
      todayU,
    };
  });
  const total = split.featured.length + split.upcoming.length + split.past.length;
  assert(total === 33, `33 cards total (23 eclipses + 10 showers), got ${total}`);
  assert(split.featured.length === 1, "exactly one featured 'next up' card");
  assert(split.featured[0] >= split.todayU, "featured event is not in the past");
  assert(split.upcoming.every(t => t >= split.todayU), "every upcoming card is today or later");
  assert(split.past.every(t => t < split.todayU), "every past card is strictly before today");
  assert(split.pastKinds.every(k => k === "eclipse"), "past section holds only eclipses (showers are annual)");
  log(`split: 1 featured + ${split.upcoming.length} upcoming + ${split.past.length} already-happened = 33; past holds eclipses only`);

  /* 5 — soonest-first ordering: featured <= first upcoming, list non-decreasing */
  assert(split.upcoming.length === 0 || split.featured[0] <= split.upcoming[0],
    "featured card is the soonest event");
  for (let i = 1; i < split.upcoming.length; i++)
    assert(split.upcoming[i - 1] <= split.upcoming[i],
      `upcoming order broken at index ${i}: ${split.upcoming[i - 1]} > ${split.upcoming[i]}`);
  log(`upcoming ordering verified non-decreasing across ${split.upcoming.length + 1} cards (featured first)`);

  /* 6 — countdowns: day-granularity text computed at runtime; expected value derived
        from Date INSIDE the page (same clock), never hardcoded */
  const cds = await page.evaluate(() => {
    const now = new Date();
    const todayU = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return [...document.querySelectorAll("#featured .ev, #upcoming .ev")].slice(0, 5).map(el => ({
      name: el.dataset.name,
      expectedDays: Math.round((Number(el.dataset.t) - todayU) / 86400000),
      cd: [...el.querySelectorAll(".cd .n, .cd .u")].map(s => s.textContent.trim()).join(" "),
    }));
  });
  for (const c of cds) {
    if (c.expectedDays === 0) assert(/now|today|tonight/i.test(c.cd), `${c.name}: zero-day countdown says now/today/tonight ("${c.cd}")`);
    else assert(new RegExp(`\\b${c.expectedDays}\\b`).test(c.cd) && /day/.test(c.cd),
      `${c.name}: countdown shows ${c.expectedDays} days ("${c.cd}")`);
    assert(!/second|minute|hour|:\d\d/.test(c.cd), `${c.name}: no false sub-day precision ("${c.cd}")`);
    log(`countdown ${c.name}: expected ${c.expectedDays}d, shown "${c.cd}"`);
  }

  /* 7 — filter chips: aria-pressed flips, cards filter, featured follows the filter */
  const pressed = () => page.$$eval("#filters button",
    bs => bs.map(b => `${b.dataset.f}=${b.getAttribute("aria-pressed")}`).join(" "));
  assert((await pressed()) === "all=true eclipse=false shower=false", "initial chip state: All pressed");
  await page.click('#filters button[data-f="eclipse"]');
  assert((await pressed()) === "all=false eclipse=true shower=false", "Eclipses chip pressed after click");
  let kinds = await page.$$eval("#featured .ev, #upcoming .ev, #pastList .ev", els => els.map(e => e.dataset.kind));
  assert(kinds.length > 0 && kinds.every(k => k === "eclipse"), "eclipse filter shows only eclipse cards");
  log(`filter Eclipses: aria-pressed correct, ${kinds.length} eclipse-only cards`);
  await page.click('#filters button[data-f="shower"]');
  assert((await pressed()) === "all=false eclipse=false shower=true", "Showers chip pressed after click");
  kinds = await page.$$eval("#featured .ev, #upcoming .ev", els => els.map(e => e.dataset.kind));
  assert(kinds.length === 10 && kinds.every(k => k === "shower"), "shower filter shows exactly the 10 showers");
  /* textContent, not innerText — the past list lives inside a collapsed <details> */
  const showerPastNote = await page.$eval("#pastList", el => el.textContent.replace(/\s+/g, " ").trim());
  assert(/annual/.test(showerPastNote), "shower filter past section explains showers are annual");
  log(`filter Meteor showers: aria-pressed correct, 10 shower cards; past note: "${showerPastNote.slice(0, 90)}"`);
  await page.click('#filters button[data-f="all"]');
  assert((await pressed()) === "all=true eclipse=false shower=false", "All chip restored");
  log("filter All restored");

  /* 8 — "already happened" is honest but collapsed by default */
  assert(!(await page.$eval("#past", d => d.open)), "past <details> starts collapsed");
  const summary = await page.locator("#past summary").innerText();
  assert(/[Aa]lready happened/.test(summary), "past summary says 'Already happened'");
  await page.click("#past summary");
  assert(await page.$eval("#past", d => d.open), "past section expands on click");
  log(`past section: collapsed by default, expands on click, summary "${summary.trim()}"`);
  await page.click("#past summary"); // collapse again for the screenshot

  /* 9 — almanac cross-link on every card, relative href, no external links */
  const links = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".ev")];
    return {
      cards: cards.length,
      withLink: cards.filter(c => c.querySelector('.alink a[href="almanac.html"]')).length,
      external: [...document.querySelectorAll('a[href^="http"]')].length,
    };
  });
  assert(links.withLink === links.cards, `every card cross-links almanac.html (${links.withLink}/${links.cards})`);
  assert(links.external === 0, "no external links — fully offline tool");
  log(`almanac cross-link: ${links.withLink}/${links.cards} cards link href="almanac.html"; 0 external links`);

  /* 10 — a11y labels + storage discipline */
  const a11y = await page.evaluate(() => ({
    group: document.getElementById("filters").getAttribute("aria-label"),
    chipsAreButtons: [...document.querySelectorAll("#filters button")].every(b => b.tagName === "BUTTON"),
    live: document.getElementById("upcoming").getAttribute("aria-live"),
    themeTitle: document.getElementById("themeBtn").getAttribute("title"),
    lsKeys: Object.keys(localStorage),
  }));
  assert(a11y.group && a11y.group.length > 3, "filter group has an aria-label");
  assert(a11y.chipsAreButtons, "filter chips are native <button>s");
  assert(a11y.live === "polite", "upcoming list is a polite live region");
  /* suite.hub.recents is written automatically by core/suite.js (hub recents tracking);
     the tool itself only ever touches suite.theme (its manifest storage list) */
  const CORE_KEYS = ["suite.theme", "suite.hub.recents"];
  assert(a11y.lsKeys.every(k => CORE_KEYS.includes(k)),
    `no storage beyond suite.theme + core-owned keys (got ${a11y.lsKeys.join(",")})`);
  log(`a11y: group aria-label="${a11y.group}", native buttons, aria-live=${a11y.live}; localStorage keys: [${a11y.lsKeys.join(", ")}]`);

  /* 11 — mobile: 390px wide, no horizontal overflow */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const mob = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
  }));
  assert(mob.sw <= mob.cw, `no horizontal overflow at 390px (scrollWidth ${mob.sw} > clientWidth ${mob.cw})`);
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  log(`mobile 390x844: scrollWidth ${mob.sw} <= clientWidth ${mob.cw}, screenshot mobile.png`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(100);
}
