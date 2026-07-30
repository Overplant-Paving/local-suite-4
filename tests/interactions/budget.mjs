/* budget.mjs — interaction module for verify-tool.mjs.
   Fully offline tool. Exercises: starter categories, the math vectors
   (income 5000 → remaining / over-allocation flip), exact 50/30/20 percentages,
   add / rename / retag / delete rows, persistence across reload, export/import
   JSON round-trip, reset-to-starter (confirm), a11y labels + text alternatives
   for every bar, and 390px no-overflow. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const selectors = [
  "body", "header h1", ".theme-btn", "footer",
  "#inc1", ".stats", ".catrow", ".c-name", ".c-tag",
  ".split-row", ".track", "#verdict", ".btn",
];

export const screenshotAfterInteract = true;

const LS_KEY = "suite.budget.v1";
const STARTER_NAMES = ["Housing", "Utilities", "Groceries", "Transportation", "Insurance",
  "Health", "Debt payments", "Savings", "Dining & fun", "Subscriptions", "Misc"];
const STARTER_TAGS = ["need", "need", "need", "need", "need",
  "need", "savings", "savings", "want", "want", "want"];

function ok(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  return "ok: " + msg;
}

async function rowValues(page, cls) {
  return page.$$eval(".catrow ." + cls, els => els.map(e => e.value));
}
async function setAmt(page, i, v) {
  await page.locator(".catrow").nth(i).locator(".c-amt").fill(String(v));
}
async function txt(page, sel) {
  return (await page.locator(sel).innerText()).replace(/\s+/g, " ").trim();
}

export async function interact({ page, log, evidenceDir }) {
  const dialogs = [];
  page.on("dialog", async d => { dialogs.push(d.type() + ": " + d.message()); await d.accept(); });

  /* ---- 1. starter categories render on first run ---- */
  const names = await rowValues(page, "c-name");
  const tags = await rowValues(page, "c-tag");
  log(ok(names.length === 11, "starter renders 11 category rows"));
  log(ok(JSON.stringify(names) === JSON.stringify(STARTER_NAMES),
    "starter names exact: " + names.join(", ")));
  log(ok(JSON.stringify(tags) === JSON.stringify(STARTER_TAGS),
    "starter tags exact (6 need, 2 savings, 3 want); Debt payments tagged " + tags[6]));
  log("empty-state split panel: " + await txt(page, "#valNeed") + " | verdict: " + await txt(page, "#verdict"));

  /* ---- 2. math vectors: income 4000 + 1000 (two earners) = 5000 ---- */
  await page.fill("#inc1", "4000");
  await page.fill("#inc2", "1000");
  log(ok(await txt(page, "#statIncome") === "$5,000", "two earner incomes sum: statIncome = $5,000"));
  // needs 1500+300+500+200 = 2500 (50%) · savings 400+600 = 1000 (20%) · wants 750+300+200 = 1250 (25%)
  const amounts = [1500, 300, 500, 200, 0, 0, 400, 600, 750, 300, 200];
  for (let i = 0; i < amounts.length; i++) if (amounts[i]) await setAmt(page, i, amounts[i]);
  log(ok(await txt(page, "#statPlanned") === "$4,750", "total planned = $4,750"));
  log(ok(await txt(page, "#statRemaining") === "$250", "remaining unallocated = $250"));
  const remClass = await page.locator("#statRemaining").getAttribute("class");
  log(ok(remClass.includes("ok") && !remClass.includes("over"), "remaining ≥ 0 carries the green .ok state"));
  log(ok(!(await page.locator("#overNote").isVisible()), "over-allocation sentence hidden while under budget"));
  log("Housing row share text: " + await txt(page, ".catrow >> nth=0 >> .c-pct"));
  log(ok(await txt(page, ".catrow >> nth=0 >> .c-pct") === "30% of income", "per-category share bar text exact (1500/5000)"));

  /* ---- 3. 50/30/20 percentages exact from tags ---- */
  log(ok(await txt(page, "#valNeed") === "50% · $2,500 — guideline 50%", "needs split exact: " + await txt(page, "#valNeed")));
  log(ok(await txt(page, "#valWant") === "25% · $1,250 — guideline 30%", "wants split exact: " + await txt(page, "#valWant")));
  log(ok(await txt(page, "#valSave") === "20% · $1,000 — guideline 20%", "savings split exact: " + await txt(page, "#valSave")));
  log(ok(await txt(page, "#unalloc") === "Unallocated: 5% of income ($250).", "unallocated line: " + await txt(page, "#unalloc")));
  const verdict1 = await txt(page, "#verdict");
  log(ok(verdict1.includes("close to the 50/30/20 guideline"), "verdict (balanced): " + verdict1));

  /* ---- 4. over-allocation state flips ---- */
  await setAmt(page, 10, 800);                       // Misc 200 -> 800: planned 5350
  log(ok(await txt(page, "#statRemaining") === "-$350", "over-allocated remaining = -$350"));
  const overClass = await page.locator("#statRemaining").getAttribute("class");
  log(ok(overClass.includes("over"), "remaining < 0 flips to the .over alert state"));
  log(ok(await page.locator("#overNote").isVisible(), "over-allocation sentence visible"));
  const overNote = await txt(page, "#overNote");
  log(ok(overNote === "You've planned $350 more than you bring in — trim a category or add income.",
    "plain over-allocation sentence: " + overNote));
  const verdict2 = await txt(page, "#verdict");
  log(ok(verdict2.startsWith("Wants take 37%"), "verdict tracks the biggest deviation: " + verdict2));
  await setAmt(page, 10, 200);                       // restore
  log(ok((await page.locator("#statRemaining").getAttribute("class")).includes("ok"), "state flips back to .ok after restore"));

  /* ---- 5. add / rename / retag / delete ---- */
  await page.click("#addCat");
  log(ok(await page.locator(".catrow").count() === 12, "add: 12 rows after + Add category"));
  await page.locator(".catrow").nth(11).locator(".c-name").fill("Pets");
  await setAmt(page, 11, 100);
  log(ok(await txt(page, "#valWant") === "27% · $1,350 — guideline 30%", "new want row shifts wants to 27%"));
  await page.locator(".catrow").nth(11).locator(".c-tag").selectOption("need");
  log(ok(await page.locator(".catrow").nth(11).getAttribute("data-tag") === "need", "retag updates the row's bucket color tag"));
  log(ok(await txt(page, "#valNeed") === "52% · $2,600 — guideline 50%", "retag moves Pets into needs: 52%"));
  await page.locator(".catrow").nth(11).locator(".c-del").click();
  log(ok(await page.locator(".catrow").count() === 11, "delete: back to 11 rows"));
  log(ok(await txt(page, "#valNeed") === "50% · $2,500 — guideline 50%", "needs back to exactly 50% after delete"));
  await page.locator(".catrow").nth(10).locator(".c-name").fill("Everything else");
  log(ok(await page.locator(".catrow").nth(10).locator(".c-amt").getAttribute("aria-label")
    === "Planned monthly amount for Everything else", "rename updates the amount input's aria-label"));

  /* ---- 6. persistence across reload ---- */
  await page.reload();
  await page.waitForTimeout(400);
  log(ok(await page.locator("#inc1").inputValue() === "4000" && await page.locator("#inc2").inputValue() === "1000",
    "incomes persist across reload (4000 + 1000)"));
  const namesR = await rowValues(page, "c-name");
  log(ok(namesR.length === 11 && namesR[10] === "Everything else", "rows + rename persist across reload"));
  log(ok(await txt(page, "#statRemaining") === "$250", "math recomputed from storage after reload: remaining $250"));
  const ls = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), LS_KEY);
  log(ok(ls && ls.income1 === 4000 && ls.cats.length === 11, "localStorage " + LS_KEY + " holds income1=4000 and 11 cats"));

  /* ---- 7. export / import JSON round-trip ---- */
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#exportBtn")]);
  const exportedPath = join(evidenceDir, "exported-budget.json");
  await download.saveAs(exportedPath);
  const exported = JSON.parse(readFileSync(exportedPath, "utf8"));
  log(ok(download.suggestedFilename() === "household-budget.json"
    && exported.income1 === 4000 && exported.income2 === 1000 && exported.cats.length === 11
    && exported.cats[0].name === "Housing" && exported.cats[0].amt === 1500 && exported.cats[0].tag === "need",
    "export payload complete (incomes + 11 cats, Housing $1,500 need)"));
  await page.fill("#inc1", "100");                   // tamper, then restore via import
  await setAmt(page, 0, 7);
  await page.setInputFiles("#importFile", exportedPath);
  await page.waitForTimeout(300);
  log(ok(await page.locator("#inc1").inputValue() === "4000"
    && await page.locator(".catrow").nth(0).locator(".c-amt").inputValue() === "1500",
    "import restores tampered income and amount"));
  log(ok(await txt(page, "#ioStatus") === "Imported budget — 11 categories.", "import status: " + await txt(page, "#ioStatus")));
  log(ok(await txt(page, "#statRemaining") === "$250", "round-trip math intact: remaining $250"));

  /* ---- 8. reset to starter (confirm dialog) ---- */
  await page.click("#resetBtn");
  await page.waitForTimeout(200);
  log(ok(dialogs.length > 0 && dialogs[dialogs.length - 1].startsWith("confirm:"),
    "reset asks for confirmation: " + dialogs[dialogs.length - 1]));
  const namesReset = await rowValues(page, "c-name");
  log(ok(JSON.stringify(namesReset) === JSON.stringify(STARTER_NAMES)
    && await txt(page, "#statPlanned") === "$0" && await page.locator("#inc1").inputValue() === "",
    "reset returns starter categories with cleared amounts and income"));
  log("post-reset verdict (designed empty state): " + await txt(page, "#verdict"));

  /* re-import so the after-interaction screenshot shows a populated budget */
  await page.setInputFiles("#importFile", exportedPath);
  await page.waitForTimeout(300);
  log(ok(await txt(page, "#statRemaining") === "$250", "re-imported for final state"));

  /* ---- 9. a11y: labels + text alternatives for bars ---- */
  log(ok(await page.locator(".catrow").nth(0).locator(".c-amt").getAttribute("aria-label")
    === "Planned monthly amount for Housing", "amount inputs carry per-category aria-labels"));
  log(ok((await page.locator(".catrow").nth(0).locator(".c-tag").getAttribute("aria-label")).includes("Housing"),
    "tag selects carry per-category aria-labels"));
  log(ok(await page.locator(".catrow").nth(0).locator(".c-del").getAttribute("aria-label") === "Delete Housing",
    "icon-only delete buttons carry aria-labels"));
  const tracksHidden = await page.$$eval(".track", els => els.every(e => e.getAttribute("aria-hidden") === "true"));
  log(ok(tracksHidden, "all bars are aria-hidden — values carried by adjacent text"));
  log(ok(await txt(page, "#valNeed") === "50% · $2,500 — guideline 50%"
    && await txt(page, ".catrow >> nth=0 >> .c-pct") === "30% of income",
    "text alternatives state the same percentages the bars draw"));
  log(ok(await page.locator("#stats").getAttribute("aria-live") === "polite"
    && await page.locator("#verdict").getAttribute("aria-live") === "polite",
    "stats and verdict are polite live regions"));
  log(ok(await page.locator("#themeBtn").getAttribute("aria-pressed") !== null, "theme button exposes aria-pressed"));

  /* ---- 10. mobile 390px: no horizontal overflow ---- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  log(ok(overflow.doc <= 0 && overflow.body <= 0,
    "no horizontal overflow at 390px (doc delta " + overflow.doc + ", body delta " + overflow.body + ")"));
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  log("mobile screenshot: mobile.png");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200);
}
