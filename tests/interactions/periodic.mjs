/* tests/interactions/periodic.mjs — exercises the Periodic Table end-to-end.
   Fully offline embedded-data tool: asserts all 118 element buttons, spot-checks
   dataset accuracy for 8 elements across the table (symbol / number / weight /
   category via the detail panel), search narrowing, category-chip filtering with
   aria-pressed, the aria-live detail region, keyboard activation, the derived
   phase-at-room-temperature facts line, and that at 390 px only the table
   container scrolls sideways — never the page body. Deterministic, no network. */
import { join } from "node:path";

export const selectors = [
  "body", ".wrap", "header h1", ".theme-btn", "#q", ".legend", ".lchip",
  ".ptwrap", ".ptable", ".cell", "#detail", "footer"
];
export const screenshotAfterInteract = true;

function assert(cond, msg) { if (!cond) throw new Error("ASSERT FAILED: " + msg); }

export async function interact({ page, log, evidenceDir }) {
  /* 1 — all 118 elements render as native buttons in the grid */
  const cells = await page.locator("button.cell").count();
  assert(cells === 118, `expected 118 element buttons, got ${cells}`);
  log(`element buttons rendered: ${cells} (all native <button>)`);

  /* 2 — dataset accuracy spot-checks across the table (IUPAC 2021 abridged weights) */
  const checks = [
    { z: 1,   sym: "H",  name: "Hydrogen",  weight: "1.008",  cat: "Reactive nonmetal" },
    { z: 26,  sym: "Fe", name: "Iron",      weight: "55.845", cat: "Transition metal" },
    { z: 79,  sym: "Au", name: "Gold",      weight: "196.97", cat: "Transition metal" },
    { z: 92,  sym: "U",  name: "Uranium",   weight: "238.03", cat: "Actinide" },
    { z: 14,  sym: "Si", name: "Silicon",   weight: "28.085", cat: "Metalloid" },
    { z: 10,  sym: "Ne", name: "Neon",      weight: "20.180", cat: "Noble gas" },
    { z: 55,  sym: "Cs", name: "Caesium",   weight: "132.91", cat: "Alkali metal" },
    { z: 118, sym: "Og", name: "Oganesson", weight: "[294]",  cat: "Noble gas" },
  ];
  for (const c of checks) {
    const cell = page.locator(`.cell[data-z="${c.z}"]`);
    const cellText = (await cell.innerText()).replace(/\s+/g, " ");
    assert(cellText.includes(c.sym) && cellText.includes(String(c.z)),
      `cell ${c.z} should show number + symbol, got "${cellText}"`);
    await cell.click();
    const d = (await page.locator("#detail").innerText()).replace(/\s+/g, " ");
    for (const needle of [c.name, c.sym, String(c.z), c.weight, c.cat]) {
      assert(d.includes(needle), `detail for ${c.sym} missing "${needle}" — got: ${d.slice(0, 300)}`);
    }
    log(`spot-check ${c.sym} (${c.z}): cell "${cellText}" → detail has ${c.name} · ${c.weight} · ${c.cat}`);
  }

  /* 3 — derived phase-at-room-temperature facts line */
  await page.locator('.cell[data-z="26"]').click();
  let d = await page.locator("#detail").innerText();
  assert(d.includes("Solid at room temperature"), "Fe should read as solid at room temperature");
  await page.locator('.cell[data-z="80"]').click();
  d = await page.locator("#detail").innerText();
  assert(d.includes("Liquid at room temperature"), "Hg should read as liquid at room temperature");
  await page.locator('.cell[data-z="1"]').click();
  d = await page.locator("#detail").innerText();
  assert(d.includes("Gas at room temperature"), "H should read as gas at room temperature");
  await page.locator('.cell[data-z="118"]').click();
  d = await page.locator("#detail").innerText();
  assert(d.includes("not established"), "Og phase should be honestly unknown");
  log("phase facts line: Fe solid, Hg liquid, H gas, Og honestly unknown — all derived correctly");

  /* 4 — search narrows: non-matching cells dim but keep their grid position */
  await page.fill("#q", "iron");
  let shown = await page.locator(".cell:not(.dim)").count();
  assert(shown === 1, `search "iron" should leave 1 element, got ${shown}`);
  let z = await page.locator(".cell:not(.dim)").first().getAttribute("data-z");
  assert(z === "26", `search "iron" should match Fe (26), got z=${z}`);
  const dimmed = await page.locator(".cell.dim").count();
  assert(dimmed === 117, `expected 117 dimmed cells, got ${dimmed}`);
  log(`search "iron": 1 match (Fe, z=26), 117 dimmed in place — status: "${await page.locator("#count").innerText()}"`);

  await page.fill("#q", "55");
  shown = await page.locator(".cell:not(.dim)").count();
  z = await page.locator(".cell:not(.dim)").first().getAttribute("data-z");
  assert(shown === 1 && z === "55", `numeric search "55" should match only Cs, got ${shown} (z=${z})`);
  log(`numeric search "55": 1 match (Cs) — status: "${await page.locator("#count").innerText()}"`);

  await page.fill("#q", "");
  shown = await page.locator(".cell:not(.dim)").count();
  assert(shown === 118, `clearing search should restore all 118, got ${shown}`);
  log("search cleared: all 118 cells undimmed");

  /* 5 — category legend chips filter and expose aria-pressed */
  const chipCount = await page.locator(".lchip").count();
  assert(chipCount === 10, `expected 10 category chips, got ${chipCount}`);
  const ngChip = page.locator('.lchip[data-cat="ng"]');
  await ngChip.click();
  assert((await ngChip.getAttribute("aria-pressed")) === "true", "active chip must have aria-pressed=true");
  shown = await page.locator(".cell:not(.dim)").count();
  assert(shown === 7, `noble-gas filter should leave 7 elements, got ${shown}`);
  const nobles = [];
  for (const el of await page.locator(".cell:not(.dim) .sym").all()) nobles.push(await el.innerText());
  assert(nobles.join(",") === "He,Ne,Ar,Kr,Xe,Rn,Og", `noble gases wrong: ${nobles.join(",")}`);
  log(`category chip "Noble gas": aria-pressed=true, 7 shown (${nobles.join(", ")})`);

  /* chip + search combine */
  await page.fill("#q", "neon");
  shown = await page.locator(".cell:not(.dim)").count();
  assert(shown === 1, `chip+search "neon" should leave 1, got ${shown}`);
  log(`chip + search combine: noble gas ∩ "neon" → 1 match — status: "${await page.locator("#count").innerText()}"`);
  await page.fill("#q", "");

  await ngChip.click();
  assert((await ngChip.getAttribute("aria-pressed")) === "false", "chip toggle off must set aria-pressed=false");
  shown = await page.locator(".cell:not(.dim)").count();
  assert(shown === 118, `clearing chip should restore all 118, got ${shown}`);
  const pressedVals = new Set();
  for (const c of await page.locator(".lchip").all()) pressedVals.add(await c.getAttribute("aria-pressed"));
  assert(!pressedVals.has(null), "every legend chip must carry aria-pressed");
  log("chip toggled off: aria-pressed=false, all 118 restored; all 10 chips expose aria-pressed");

  /* 6 — a11y: detail is a live region, controls are labelled */
  assert((await page.locator("#detail").getAttribute("aria-live")) === "polite",
    "detail panel must be an aria-live=polite region");
  assert((await page.locator("#q").getAttribute("aria-label") || "").includes("Search"),
    "search input needs an aria-label");
  const cellLabel = await page.locator('.cell[data-z="79"]').getAttribute("aria-label");
  assert(cellLabel === "Gold, element 79", `cell aria-label wrong: "${cellLabel}"`);
  log(`a11y: #detail aria-live=polite; search labelled; cell aria-label "${cellLabel}"`);

  /* 7 — keyboard activation: focus a cell, press Enter, detail updates */
  await page.locator('.cell[data-z="47"]').focus();
  await page.keyboard.press("Enter");
  d = (await page.locator("#detail").innerText()).replace(/\s+/g, " ");
  assert(d.includes("Silver") && d.includes("107.87"), "Enter on focused Ag cell should open its detail");
  log("keyboard: focused Ag (47), pressed Enter → detail shows Silver · 107.87");

  /* 8 — mobile 390 px: body must not scroll sideways; the table container may */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => ({
    docSW: document.documentElement.scrollWidth,
    docCW: document.documentElement.clientWidth,
    wrapSW: document.querySelector(".ptwrap").scrollWidth,
    wrapCW: document.querySelector(".ptwrap").clientWidth,
  }));
  assert(m.docSW <= m.docCW, `page body overflows at 390px: scrollWidth ${m.docSW} > clientWidth ${m.docCW}`);
  assert(m.wrapSW > m.wrapCW, `table should scroll inside its container at 390px (got ${m.wrapSW} <= ${m.wrapCW})`);
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  log(`mobile 390px: document ${m.docCW}/${m.docSW} (no body overflow); .ptwrap ${m.wrapCW}→${m.wrapSW} scrolls internally — mobile.png`);

  /* leave a selection visible for the after-interaction screenshot */
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.cell[data-z="79"]').click();
  log("final state: Gold (79) selected for the after-interaction screenshot");
}
