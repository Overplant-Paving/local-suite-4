/* tests/interactions/savings.mjs — Savings & Compound Interest Planner (fully offline).
   Verifies the compounding math against closed-form vectors, the goal-month scan,
   the inflation deflator, the 0%-rate linear case, the SVG chart, the year-by-year
   table, persistence to suite.savings.v1, reset, a11y bits, and mobile layout. */
import { join } from "node:path";

export const selectors = [
  "body", ".wrap", "header h1", ".theme-btn", ".card", ".inputs", ".stats",
  "#goalOut", "#chartBox", "#chartSummary", "#tableBtn", ".btn", "footer"
];
export const screenshotAfterInteract = true;

const money = s => Number(String(s).replace(/[^0-9.-]/g, ""));
const near = (a, b, tol, what) => {
  if (Math.abs(a - b) > tol) throw new Error(`${what}: got ${a}, expected ${b} (tol ${tol})`);
};

/* Closed form for the tool's model (end-of-month contributions):
   FV = P(1+r)^n + C[((1+r)^n − 1)/r], r = APY/100/12; r = 0 → P + Cn. */
function fv(P, C, apyPct, years) {
  const r = apyPct / 100 / 12, n = years * 12;
  if (r === 0) return P + C * n;
  const g = Math.pow(1 + r, n);
  return P * g + C * (g - 1) / r;
}
/* Independent goal-month scan with the same recurrence. */
function goalMonth(P, C, apyPct, goal, years) {
  const r = apyPct / 100 / 12;
  let bal = P;
  if (bal >= goal) return 0;
  for (let m = 1; m <= years * 12; m++) {
    bal = bal * (1 + r) + C;
    if (bal >= goal) return m;
  }
  return null;
}

export async function interact({ page, log, evidenceDir }) {
  const stat = async id => money(await page.locator("#" + id).innerText());

  /* 1 — default scenario IS the closed-form vector: 10,000 + 500/mo @ 6% APY, 10 y */
  const expFinal = fv(10000, 500, 6, 10);        // 10000·1.005^120 + 500·[(1.005^120−1)/0.005]
  let final = await stat("finalBal");
  near(final, expFinal, 2, "final balance vs closed form");
  const contrib = await stat("totContrib");
  near(contrib, 70000, 0.5, "total contributed (10,000 + 120×500)");
  near(await stat("totGrowth"), expFinal - 70000, 2, "total growth");
  log(`closed-form vector: final=${final} (expected ${expFinal.toFixed(2)} ±$2), contributed=${contrib}, growth ok`);
  log("model note visible: " + (await page.locator(".modelnote").innerText()).slice(0, 90) + "…");

  /* 2 — goal-month math, cross-checked against an independent scan */
  await page.fill("#goal", "50000");
  const expMonth = goalMonth(10000, 500, 6, 50000, 10);
  let goalTxt = await page.locator("#goalOut").innerText();
  const m = goalTxt.match(/month (\d+)/);
  if (!m || Number(m[1]) !== expMonth) throw new Error(`goal month: "${goalTxt}" vs expected month ${expMonth}`);
  log(`goal $50,000 reached at month ${m[1]} (independent scan says ${expMonth}): "${goalTxt}"`);

  /* honest not-reached state */
  await page.fill("#goal", "10000000");
  goalTxt = await page.locator("#goalOut").innerText();
  if (!/not reached in 10 years/.test(goalTxt)) throw new Error("not-reached wording missing: " + goalTxt);
  log(`unreachable goal is honest: "${goalTxt}"`);

  /* already-met state (month 0) */
  await page.fill("#goal", "5000");
  goalTxt = await page.locator("#goalOut").innerText();
  if (!/already|month 0/.test(goalTxt)) throw new Error("month-0 goal state wrong: " + goalTxt);
  log(`goal below starting balance: "${goalTxt}"`);
  await page.fill("#goal", "50000");

  /* 3 — inflation-adjusted ("today's dollars") = nominal / (1+infl)^years */
  await page.fill("#infl", "2.5");
  const expReal = expFinal / Math.pow(1.025, 10);
  const real = await stat("realBal");
  near(real, expReal, 2, "inflation-adjusted final");
  log(`today's dollars @2.5%: ${real} (expected ${expReal.toFixed(2)} ±$2)`);
  if (await page.locator('#chart path[data-series="real"]').count() !== 1)
    throw new Error("real (today's dollars) chart line missing when inflation is set");
  log("chart: real line present with inflation set; legend: " + (await page.locator("#legend").innerText()));

  /* 4 — 0% rate: exact linear case, growth $0 */
  await page.fill("#apy", "0");
  near(await stat("finalBal"), 70000, 0.5, "0% APY final (exact linear)");
  near(await stat("totGrowth"), 0, 0.5, "0% APY growth");
  log("0% APY: final=$70,000 exactly, growth=$0; summary: " +
    (await page.locator("#chartSummary").innerText()).slice(0, 120));
  await page.fill("#apy", "6");

  /* 0-contribution edge: pure compounding */
  await page.fill("#monthly", "0");
  near(await stat("finalBal"), 10000 * Math.pow(1.005, 120), 2, "0-contribution pure compound");
  log("0 contribution: final matches 10000×1.005^120; summary mentions compounding alone: " +
    /compounding alone/.test(await page.locator("#chartSummary").innerText()));
  await page.fill("#monthly", "500");

  /* 5 — SVG chart internals: nominal path renders, y-axis $k labels, aria-hidden + text alt */
  const d = await page.locator('#chart path[data-series="nominal"]').getAttribute("d");
  if (!d || !d.startsWith("M ") || d.length < 300) throw new Error("nominal path not rendered: " + String(d).slice(0, 40));
  const axisTexts = await page.evaluate(() =>
    [...document.querySelectorAll("#chart text")].map(t => t.textContent));
  if (!axisTexts.some(t => /\$\d+k/.test(t))) throw new Error("no $k y-axis labels: " + axisTexts.join(","));
  if (await page.locator('#chartBox[aria-hidden="true"]').count() !== 1) throw new Error("chart not aria-hidden");
  log(`chart: nominal path d has ${d.split("L").length} points, axis labels include ${axisTexts.filter(t => t.includes("$")).join(" ")}`);
  log("accessible alternative: visible summary = " + (await page.locator("#chartSummary").innerText()));

  /* 6 — year-by-year table: toggle, row count = years, year-1 sanity */
  if (await page.locator("#tableWrap").isVisible()) throw new Error("table should start hidden");
  await page.click("#tableBtn");
  if (await page.locator("#tableBtn").getAttribute("aria-pressed") !== "true") throw new Error("tableBtn aria-pressed not true");
  const rowsN = await page.locator("#yearly tbody tr").count();
  if (rowsN !== 10) throw new Error("expected 10 year rows, got " + rowsN);
  const y1 = await page.locator("#yearly tbody tr").first().locator("td").allInnerTexts();
  near(money(y1[1]), 16000, 0.5, "year-1 contributed to date (10,000 + 12×500)");
  near(money(y1[3]), fv(10000, 500, 6, 1), 2, "year-1 balance vs closed form");
  log(`table: 10 rows for 10 years; year 1 = [${y1.join(" | ")}]`);

  /* years horizon drives row count */
  await page.fill("#years", "25");
  log("table rows at 25 years: " + (await page.locator("#yearly tbody tr").count()));
  if (await page.locator("#yearly tbody tr").count() !== 25) throw new Error("year rows != 25");
  await page.fill("#years", "10");

  /* 7 — persistence: suite.savings.v1 written, survives reload, reset clears it */
  await page.fill("#monthly", "750");
  const lsRaw = await page.evaluate(() => localStorage.getItem("suite.savings.v1"));
  if (!lsRaw || !lsRaw.includes('"monthly":"750"')) throw new Error("suite.savings.v1 not saved: " + lsRaw);
  await page.reload();
  await page.waitForTimeout(300);
  const restored = {
    monthly: await page.inputValue("#monthly"), goal: await page.inputValue("#goal"),
    infl: await page.inputValue("#infl"), tableOpen: await page.locator("#tableWrap").isVisible(),
  };
  if (restored.monthly !== "750" || restored.goal !== "50000" || restored.infl !== "2.5" || !restored.tableOpen)
    throw new Error("restore failed: " + JSON.stringify(restored));
  log("persistence: reload restored " + JSON.stringify(restored) + " from suite.savings.v1");

  await page.click("#resetBtn");
  if (await page.inputValue("#monthly") !== "500" || await page.inputValue("#goal") !== "")
    throw new Error("reset did not restore defaults");
  if (await page.evaluate(() => localStorage.getItem("suite.savings.v1")) !== null)
    throw new Error("reset did not remove suite.savings.v1");
  log("reset: defaults restored (monthly=500, goal empty, table hidden) and suite.savings.v1 removed");

  /* 8 — a11y: every input labelled, live regions, empty-goal hint designed */
  const unlabelled = await page.evaluate(() =>
    [...document.querySelectorAll("input")].filter(i => !document.querySelector(`label[for="${i.id}"]`)).map(i => i.id));
  if (unlabelled.length) throw new Error("inputs without <label for>: " + unlabelled.join(","));
  const live = await page.evaluate(() =>
    ["stats", "goalOut"].map(id => id + "=" + document.getElementById(id).getAttribute("aria-live")).join(", "));
  if (!/stats=polite, goalOut=polite/.test(live)) throw new Error("live regions wrong: " + live);
  log("a11y: all 6 inputs have label[for]; aria-live " + live + "; theme-btn aria-label=" +
    (await page.locator("#themeBtn").getAttribute("aria-label")));
  log("empty-goal designed hint: \"" + (await page.locator("#goalOut").innerText()) + "\"");

  /* 9 — mobile 390px: no horizontal overflow */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (ov.sw > ov.cw) throw new Error(`mobile overflow: scrollWidth ${ov.sw} > clientWidth ${ov.cw}`);
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  log(`mobile 390px: scrollWidth ${ov.sw} <= clientWidth ${ov.cw}, screenshot mobile.png`);
  await page.setViewportSize({ width: 1280, height: 900 });

  /* leave a feature-rich state for the after-interaction screenshot */
  await page.fill("#infl", "2.5");
  await page.fill("#goal", "100000");
  await page.click("#tableBtn");
  await page.waitForTimeout(150);
  log("final state: inflation 2.5%, goal $100,000 (" + (await page.locator("#goalOut").innerText()) + "), table open");
}
