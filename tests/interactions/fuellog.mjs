/* tests/interactions/fuellog.mjs — exercises the Fuel & Mileage Log end-to-end.
   Fully offline tool: seeds a deterministic fill-up sequence (incl. a partial fill)
   and asserts the exact tank-to-tank MPG math, lifetime stats and cost/mile;
   odometer validation; edit/delete recompute; CSV export content + import
   round-trip + two designed import-error paths; sparkline SVG paths; vehicle
   add/rename/delete-with-confirm; persistence across reload; a11y labels; and
   390px mobile with no horizontal overflow. No fixture depends on the wall clock:
   seeded dates are fixed in the past, and "today" is read from the page's own
   clock, never hardcoded. */
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

export const selectors = [
  "body", "header h1", ".theme-btn", "footer", ".card", "#vehSel",
  ".tile", "table", ".btn", "#emptyCard"
];
export const screenshotAfterInteract = true;

/* Deterministic seed — Civic. Expected tank-to-tank MPG (see the tool's algorithm
   comment): a tank is measured between consecutive FULL fills; partial-fill gallons
   fold into the next full tank.
     seg1: (20330-20000)/11        = 330/11 = 30.0
     seg2: (20780-20330)/(4+8)     = 450/12 = 37.5   (partial folded in)
     seg3: (21080-20780)/10        = 300/10 = 30.0
   lifetime = 1080/33 = 32.727…  -> "32.7"
   avg $/gal = 157.10/44 = 3.5704… -> "$3.57"
   cost/mile = 118.60/1080 = 0.10981… -> "$0.110"  (cost after the baseline fill) */
const SEED = [
  ["2025-01-05", 20000, 11, "38.50", false, "first fill"],
  ["2025-01-12", 20330, 11, "39.60", false, ""],
  ["2025-01-19", 20450, 4, "15.00", true, 'topped up, "half tank"'],
  ["2025-01-26", 20780, 8, "30.00", false, ""],
  ["2025-02-02", 21080, 10, "34.00", false, ""],
];

const EXPECTED_CSV =
  "date,odometer_mi,gallons,total_cost,partial,note\n" +
  "2025-01-05,20000,11,38.50,no,first fill\n" +
  "2025-01-12,20330,11,39.60,no,\n" +
  '2025-01-19,20450,4,15.00,yes,"topped up, ""half tank"""\n' +
  "2025-01-26,20780,8,30.00,no,\n" +
  "2025-02-02,21080,10,34.00,no,\n";

export async function interact({ page, log, evidenceDir }) {
  const ok = (cond, msg) => {
    if (!cond) throw new Error("ASSERT FAILED: " + msg);
    log("ok: " + msg);
  };
  const txt = async sel => (await page.locator(sel).innerText()).trim();
  const rowCount = () => page.locator("#rows tr").count();

  /* offline guarantee: record any non-file:// request made during the whole run */
  const netRequests = [];
  page.on("request", r => { if (!r.url().startsWith("file://")) netRequests.push(r.url()); });

  async function addFill([date, odo, gal, cost, partial, note]) {
    if (date) await page.fill("#fDate", date);
    await page.fill("#fOdo", String(odo));
    await page.fill("#fGal", String(gal));
    await page.fill("#fCost", String(cost));
    await page.locator("#fPartial").setChecked(partial);
    await page.fill("#fNote", note);
    await page.click("#entrySave");
  }
  async function makeVehicle(name) {
    await page.click("#vehNew");
    await page.fill("#vehInput", name);
    await page.click("#vehSave");
  }

  /* 1 — designed empty state, then create the first vehicle */
  ok(await page.locator("#emptyCard").isVisible(), "empty state card visible before any vehicle");
  ok(!(await page.locator("#entryCard").isVisible()), "entry form hidden before any vehicle");
  await makeVehicle("Civic");
  ok((await txt("#vehMsg")) === "Added Civic.", "vehicle created: " + (await txt("#vehMsg")));
  ok(await page.locator("#entryCard").isVisible(), "entry form visible after vehicle creation");

  /* 2 — date defaults to today (compared against the page's own clock) */
  const pageToday = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
  const dateVal = await page.locator("#fDate").inputValue();
  ok(dateVal === pageToday, `date defaults to today (${dateVal})`);

  /* 3 — seed the deterministic sequence (incl. one partial fill) */
  for (const f of SEED) await addFill(f);
  ok((await rowCount()) === 5, "5 seeded fill-ups in the table");
  ok((await page.locator("#rows tr").first().getAttribute("data-odo")) === "21080",
    "table is newest-first (first row odo 21080)");

  /* 4 — exact per-tank MPG in the table (newest-first) */
  const mpgCells = [];
  for (let i = 0; i < 5; i++) mpgCells.push(await page.locator("#rows tr").nth(i).locator("td.mpg").innerText());
  ok(mpgCells[0].trim() === "30.0", "tank MPG (2025-02-02) = 30.0 (300 mi / 10 gal)");
  ok(mpgCells[1].trim() === "37.5", "tank MPG (2025-01-26) = 37.5 (450 mi / 12 gal, partial folded in)");
  ok(mpgCells[2].includes("—") && mpgCells[2].includes("partial"), "partial fill shows — with 'partial' hint");
  ok(mpgCells[3].trim() === "30.0", "tank MPG (2025-01-12) = 30.0 (330 mi / 11 gal)");
  ok(mpgCells[4].includes("—") && mpgCells[4].includes("first fill"), "first fill shows — with 'first fill' hint");
  const partialTitle = await page.locator('#rows tr[data-odo="20450"] td.mpg').getAttribute("title");
  ok(partialTitle.includes("roll into the next full tank"), "partial-fill title explains the method: " + partialTitle);
  const baseTitle = await page.locator('#rows tr[data-odo="20000"] td.mpg').getAttribute("title");
  ok(baseTitle.includes("baseline"), "first-fill title explains the baseline: " + baseTitle);
  ok((await txt("#mpgHint")).includes("between full fills"), "table hint states the between-full-fills method");

  /* 5 — exact lifetime stats */
  ok((await txt("#stLife")) === "32.7", "lifetime MPG = 32.7 (1080 mi / 33 gal)");
  ok((await txt("#stBest")) === "37.5", "best tank = 37.5");
  ok((await txt("#stBestSub")) === "2025-01-26", "best tank dated 2025-01-26");
  ok((await txt("#stWorst")) === "30.0", "worst tank = 30.0");
  ok((await txt("#stPpg")) === "$3.57", "avg price/gal = $3.57 (157.10 / 44 gal)");
  ok((await txt("#stCpm")) === "$0.110", "cost/mile = $0.110 (118.60 / 1080 mi)");
  ok((await txt("#st30")) === "$0.00", "last-30-days spend = $0.00 (all seeded fills are old)");

  /* 6 — sparklines render real SVG paths */
  const mpgD = await page.locator("#sparkMpg svg path.spark-line").getAttribute("d");
  ok(/^M[\d. ]+L[\d. ]+L[\d. ]+$/.test(mpgD), "MPG sparkline path has 3 points: " + mpgD);
  ok((await page.locator("#sparkMpg circle.spark-dot").count()) === 3, "MPG sparkline has 3 dots (one per tank)");
  ok((await page.locator("#sparkPrice circle.spark-dot").count()) === 5, "price sparkline has 5 dots (one per fill)");
  const mpgAria = await page.locator("#sparkMpg svg").getAttribute("aria-label");
  ok(mpgAria === "MPG per tank — 3 points from 30.0 to 37.5, latest 30.0", "MPG sparkline aria: " + mpgAria);
  const priceAria = await page.locator("#sparkPrice svg").getAttribute("aria-label");
  ok(priceAria === "Price per gallon — 5 points from $3.40 to $3.75, latest $3.40", "price sparkline aria: " + priceAria);

  /* 7 — odometer validation: a later-dated fill may not read lower */
  await addFill(["2025-02-10", 21000, 5, "20.00", false, ""]);
  const vErr = await txt("#formMsg");
  ok(vErr.includes("Odometer must increase") && vErr.includes("21,080"),
    "designed inline odometer error: " + vErr);
  ok((await rowCount()) === 5, "invalid entry was not added");
  await page.click("#entryReset");
  ok((await page.locator("#fDate").inputValue()) === pageToday, "Clear resets the form date to today");

  /* 8 — a fill dated today lands in last-30-days spend; recompute is exact */
  await addFill([null, 21380, 10, "33.00", false, ""]); // keep the default (today) date
  ok((await rowCount()) === 6, "today's fill added (6 rows)");
  ok((await page.locator("#rows tr").first().getAttribute("data-odo")) === "21380", "today's fill sorts newest-first");
  ok((await page.locator("#rows tr").first().locator("td.mpg").innerText()).trim() === "30.0",
    "today's tank MPG = 30.0 (300 mi / 10 gal)");
  ok((await txt("#stLife")) === "32.1", "lifetime recomputed = 32.1 (1380 / 43)");
  ok((await txt("#st30")) === "$33.00", "last-30-days spend = $33.00 (only today's fill)");
  log("avg $/gal with 6 fills: " + (await txt("#stPpg")) + " (190.10 / 54 gal)");

  /* 9 — delete recomputes */
  await page.locator('#rows tr[data-odo="21380"] .btn-del').click();
  ok((await rowCount()) === 5, "deleted today's fill (back to 5 rows)");
  ok((await txt("#stLife")) === "32.7", "lifetime back to 32.7 after delete");
  ok((await txt("#st30")) === "$0.00", "last-30-days spend back to $0.00 after delete");

  /* 10 — edit recomputes (gal 8 -> 10 on the 2025-01-26 full fill), then revert */
  await page.locator('#rows tr[data-odo="20780"] .btn-edit').click();
  const formTitle = (await page.locator("#formTitle").textContent()).trim();
  ok(formTitle === "Edit fill-up · 2025-01-26", "edit mode: " + formTitle);
  ok((await txt("#entrySave")) === "Save changes", "submit button switches to Save changes");
  await page.fill("#fGal", "10");
  await page.click("#entrySave");
  ok((await page.locator('#rows tr[data-odo="20780"] td.mpg').innerText()).trim() === "32.1",
    "edited tank MPG = 32.1 (450 / 14)");
  ok((await txt("#stLife")) === "30.9", "lifetime after edit = 30.9 (1080 / 35)");
  ok((await txt("#stBest")) === "32.1", "best tank after edit = 32.1");
  await page.locator('#rows tr[data-odo="20780"] .btn-edit').click();
  await page.fill("#fGal", "8");
  await page.click("#entrySave");
  ok((await txt("#stLife")) === "32.7", "edit reverted: lifetime back to 32.7");
  ok((await txt("#stBest")) === "37.5", "edit reverted: best tank back to 37.5");

  /* 11 — CSV export: exact content incl. proper quoting of comma + quotes in a note */
  const dlPromise = page.waitForEvent("download");
  await page.click("#csvExport");
  const dl = await dlPromise;
  ok(dl.suggestedFilename() === "fuellog-civic.csv", "download filename: " + dl.suggestedFilename());
  const exportPath = join(evidenceDir, "export.csv");
  await dl.saveAs(exportPath);
  const csv = readFileSync(exportPath, "utf8");
  ok(csv === EXPECTED_CSV, "exported CSV matches expected content byte-for-byte (quoted note included)");
  log("exported CSV:\n" + csv.trimEnd());

  /* 12 — CSV import round-trip into a second vehicle */
  await makeVehicle("Truck");
  ok((await txt("#stLife")) === "—", "new vehicle starts with no stats (lifetime —)");
  ok(await page.locator("#tableEmpty").isVisible(), "new vehicle shows the designed empty-table state");
  await page.setInputFiles("#csvFile", exportPath);
  await page.waitForFunction(() => document.querySelector("#csvMsg").textContent.includes("Imported"));
  ok((await txt("#csvMsg")) === "Imported 5 fill-ups into Truck.", "import message: " + (await txt("#csvMsg")));
  ok((await rowCount()) === 5, "round-trip: 5 rows imported");
  ok((await txt("#stLife")) === "32.7", "round-trip: identical lifetime MPG 32.7");
  ok((await txt("#stCpm")) === "$0.110", "round-trip: identical cost/mile $0.110");
  const noteBack = (await page.locator('#rows tr[data-odo="20450"] td.note').innerText()).trim();
  ok(noteBack === 'topped up, "half tank"', "round-trip preserves quoted note: " + noteBack);

  /* 13 — designed import errors: malformed row, then non-increasing odometer */
  const badPath = join(evidenceDir, "malformed.csv");
  writeFileSync(badPath,
    "date,odometer_mi,gallons,total_cost,partial,note\n" +
    "2026-03-01,30000,10,30.00,no,ok\n" +
    "not-a-date,30100,x,abc,maybe,bad\n");
  await page.setInputFiles("#csvFile", badPath);
  await page.waitForFunction(() => document.querySelector("#csvMsg").textContent.includes("Import failed"));
  const badMsg = await txt("#csvMsg");
  ok(badMsg.includes("Row 3") && badMsg.includes("nothing was added"), "malformed-row error: " + badMsg);
  ok((await rowCount()) === 5, "malformed import added nothing (all-or-nothing)");
  const decPath = join(evidenceDir, "decreasing.csv");
  writeFileSync(decPath,
    "date,odometer_mi,gallons,total_cost,partial,note\n" +
    "2026-03-01,30000,10,30.00,no,\n" +
    "2026-03-08,29900,9,27.00,no,\n");
  await page.setInputFiles("#csvFile", decPath);
  await page.waitForFunction(() => document.querySelector("#csvMsg").textContent.includes("increase over time"));
  log("decreasing-odometer import error: " + (await txt("#csvMsg")));
  ok((await rowCount()) === 5, "decreasing-odometer import added nothing");

  /* 14 — picker switches between vehicles */
  await page.selectOption("#vehSel", { label: "Civic" });
  ok((await rowCount()) === 5, "picker: Civic still has its 5 fills");
  await page.selectOption("#vehSel", { label: "Truck" });
  ok((await rowCount()) === 5, "picker: Truck keeps its imported fills");

  /* 15 — rename, then delete with two-step confirm */
  await page.click("#vehRename");
  ok((await page.locator("#vehInput").inputValue()) === "Truck", "rename form prefilled with current name");
  await page.fill("#vehInput", "Work Truck");
  await page.click("#vehSave");
  const selLabel = await page.evaluate(() => {
    const s = document.querySelector("#vehSel");
    return s.options[s.selectedIndex].textContent;
  });
  ok(selLabel === "Work Truck", "vehicle renamed in the picker: " + selLabel);
  await page.click("#vehDelete");
  ok((await txt("#vehDelete")) === "Confirm delete", "delete arms to a confirm step");
  ok((await txt("#vehMsg")).includes('Delete "Work Truck" and its 5 fill-ups?'),
    "confirm message names the vehicle: " + (await txt("#vehMsg")));
  await page.click("#vehDelete");
  ok((await page.locator("#vehSel option").count()) === 1, "vehicle deleted after confirm (1 option left)");
  ok((await txt("#vehMsg")) === "Deleted Work Truck.", "deletion confirmed: " + (await txt("#vehMsg")));
  ok((await rowCount()) === 5, "active vehicle fell back to Civic with its 5 fills");

  /* 16 — a11y bits */
  ok((await page.locator(".theme-btn").getAttribute("aria-label")) === "Toggle light/dark theme",
    "theme button has aria-label");
  ok((await page.locator('label[for="fPartial"]').count()) === 1, "partial-fill checkbox has a visible label");
  ok((await page.locator('label[for="csvFile"]').count()) === 1, "CSV file input is labeled");
  const editAria = await page.locator("#rows tr").first().locator(".btn-edit").getAttribute("aria-label");
  ok(/^Edit fill-up \d{4}-\d{2}-\d{2} at [\d,]+ mi$/.test(editAria), "row edit button aria-label: " + editAria);
  const delAria = await page.locator("#rows tr").first().locator(".btn-del").getAttribute("aria-label");
  ok(delAria.startsWith("Delete fill-up "), "icon-only delete button aria-label: " + delAria);
  ok((await page.locator("#stats").getAttribute("aria-live")) === "polite", "stats container is a live region");
  ok((await page.locator("#formMsg").getAttribute("aria-live")) === "polite", "inline form error is a live region");

  /* 17 — storage + persistence across reload */
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("suite.")).sort());
  log("suite.* keys written: " + keys.join(", "));
  ok(keys.includes("suite.fuellog.v1"), "manifest storage key suite.fuellog.v1 is written");
  await page.reload();
  await page.waitForTimeout(400);
  ok((await rowCount()) === 5, "persistence: 5 fills after reload");
  ok((await txt("#stLife")) === "32.7", "persistence: lifetime MPG 32.7 after reload");
  ok((await txt("#stCpm")) === "$0.110", "persistence: cost/mile $0.110 after reload");
  const selAfter = await page.evaluate(() => {
    const s = document.querySelector("#vehSel");
    return s.options[s.selectedIndex].textContent;
  });
  ok(selAfter === "Civic", "persistence: active vehicle Civic after reload");

  /* 18 — offline guarantee */
  ok(netRequests.length === 0, "no network requests during the entire run (file:// only)");

  /* 19 — mobile 390px: no horizontal overflow, table collapses to cards */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    bsw: document.body.scrollWidth
  }));
  ok(overflow.sw <= overflow.cw, `no horizontal overflow at 390px (scrollWidth ${overflow.sw} <= clientWidth ${overflow.cw})`);
  ok(overflow.bsw <= overflow.cw, `body does not overflow at 390px (${overflow.bsw} <= ${overflow.cw})`);
  const theadDisplay = await page.evaluate(() => getComputedStyle(document.querySelector("thead")).display);
  ok(theadDisplay === "none", "table header hidden at 390px (rows collapse to labeled cards)");
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  log("mobile screenshot: mobile.png");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
}
