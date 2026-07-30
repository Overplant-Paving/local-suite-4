/* tests/interactions/calc.mjs — exercises the Calculator & Percentage Workbench.
   Fully offline tool: parser correctness (precedence, percent forms, fractions, ÷0),
   ans chaining, tape persistence across reload, tip & split with odd-cent
   reconciliation (equal + unequal shares), unit-price verdict, number-base
   round-trip + two's complement + bitwise ops, duration totals with $/hour,
   aria-pressed mode buttons, and 390px no-overflow in every mode. */
import { join } from "node:path";

export const selectors = [
  "body", ".wrap", "header h1", ".theme-btn", "#modes", ".mode",
  "#sec-tape", "#tape", ".texp", "#sec-tip", "#sec-base", ".panel", "footer"
];
export const screenshotAfterInteract = true;

function expect(cond, msg) {
  if (!cond) throw new Error("EXPECT FAILED: " + msg);
}

export async function interact({ page, log, evidenceDir }) {
  const line = i => page.locator("#tape .trow").nth(i);
  const result = async i => (await line(i).locator(".tres").innerText()).trim();

  /* 1 — parser correctness on the first tape line (12 cases) */
  const cases = [
    ["2+3*4", "= 14"],            // precedence
    ["(2+3)*4", "= 20"],          // parentheses
    ["2^3^2", "= 512"],           // right-assoc power
    ["-3^2", "= -9"],             // unary minus vs power (math convention)
    ["2^-2", "= 0.25"],           // signed exponent
    ["18% of 64.50", "= 11.61"],  // percent-of
    ["64.50 + 18%", "= 76.11"],   // percent-of-left-operand +
    ["200 - 25%", "= 150"],       // percent-of-left-operand -
    ["120 * 15%", "= 18"],        // percent as multiplier
    ["50%", "= 0.5"],             // bare percent
    ["1 1/2 + 1/4", "= 1.75"],    // mixed fraction + plain fraction
    ["1,200 / 4", "= 300"],       // comma grouping in input
    ["10/0", "÷ 0 — undefined"],  // designed divide-by-zero state, never NaN
  ];
  for (const [expr, want] of cases) {
    await line(0).locator(".texp").fill(expr);
    const got = await result(0);
    log(`parser: ${expr}  ->  ${got}`);
    expect(got === want, `${expr}: got "${got}" want "${want}"`);
  }

  /* 2 — ans chaining: Enter opens a new line, ans = previous result */
  await line(0).locator(".texp").fill("6*7");
  await line(0).locator(".texp").press("Enter");
  await line(1).locator(".texp").fill("ans/2 + 1");
  log(`ans chain: line1 "6*7" ${await result(0)}, line2 "ans/2 + 1" ${await result(1)}`);
  expect((await result(1)) === "= 22", "ans chain should give = 22");

  /* broken line breaks the ans chain honestly */
  await line(0).locator(".texp").fill("10/0");
  log(`ans after ÷0 upstream: line1 "${await result(0)}", line2 "${await result(1)}"`);
  expect((await result(1)) === "ans unavailable", "ans should be unavailable after ÷0 line");
  await line(0).locator(".texp").fill("6*7");
  expect((await result(1)) === "= 22", "ans chain restored");

  /* a11y on the tape */
  const lineLabel = await line(0).locator(".texp").getAttribute("aria-label");
  const delLabel = await line(0).locator(".tdel").getAttribute("aria-label");
  log(`tape a11y: input aria-label="${lineLabel}", delete aria-label="${delLabel}"`);
  expect(lineLabel === "Expression line 1" && delLabel === "Delete line 1", "tape aria-labels");

  /* 3 — persistence: suite.calc.tape survives a reload and recomputes */
  const tapeStored = await page.evaluate(() => localStorage.getItem("suite.calc.tape"));
  log("suite.calc.tape before reload: " + tapeStored);
  expect(JSON.parse(tapeStored)[0] === "6*7", "tape persisted to suite.calc.tape");
  await page.reload();
  await page.waitForTimeout(400);
  const restored0 = await line(0).locator(".texp").inputValue();
  const restored1 = await result(1);
  log(`tape after reload: line1="${restored0}", line2 result "${restored1}"`);
  expect(restored0 === "6*7" && restored1 === "= 22", "tape restored + recomputed after reload");

  /* 4 — mode buttons: aria-pressed toggles, one section visible, mode persisted */
  await page.click('.mode[data-m="tip"]');
  const pressed = await page.$$eval("#modes .mode",
    bs => bs.map(b => b.dataset.m + ":" + b.getAttribute("aria-pressed")).join(" "));
  log("mode aria-pressed after Tip click: " + pressed);
  expect(pressed === "tape:false tip:true unit:false base:false dur:false", "exactly one mode pressed");
  const visible = await page.$$eval("section.panel",
    ss => ss.filter(s => !s.hidden).map(s => s.id).join(","));
  log("visible section: " + visible);
  expect(visible === "sec-tip", "only the tip section is visible");
  const storedMode = await page.evaluate(() => localStorage.getItem("suite.calc.mode"));
  log("suite.calc.mode = " + storedMode);
  expect(storedMode === "tip", "mode persisted");

  /* 5 — tip & split, equal: $100 + 18% across 3 → odd-cent reconciliation */
  await page.fill("#tipBill", "100");
  await page.fill("#tipPct", "18");
  await page.fill("#tipPeople", "3");
  let tipText = (await page.locator("#tipOut").innerText()).replace(/\s+/g, " ");
  log("tip equal split: " + tipText);
  expect(tipText.includes("$118.00"), "total $118.00 shown");
  expect(tipText.includes("$39.34") && tipText.includes("$39.33"), "per-person 39.34/39.33 shown");
  expect(tipText.includes("Person 1 absorbs the odd cent"), "reconciliation names who absorbs the odd cent");
  expect(tipText.includes("sum exactly to $118.00"), "reconciliation restates the exact total");

  /* tip rounding shown when the tip doesn't land on a cent */
  await page.fill("#tipBill", "20.21");
  tipText = (await page.locator("#tipOut").innerText()).replace(/\s+/g, " ");
  log("tip rounding note (bill 20.21 @ 18%): " + tipText.slice(0, 120));
  expect(tipText.includes("rounded to the cent from $3.6378"), "explicit rounding note");

  /* 6 — tip & split, unequal shares: $10, weights 1,2 → 3.33 / 6.67, Person 2 absorbs */
  await page.fill("#tipBill", "10");
  await page.fill("#tipPct", "0");
  await page.check("#tipUnequal");
  await page.fill("#tipWeights", "1,2");
  tipText = (await page.locator("#tipOut").innerText()).replace(/\s+/g, " ");
  log("tip unequal split: " + tipText);
  expect(tipText.includes("$3.33") && tipText.includes("$6.67"), "weighted shares 3.33/6.67");
  expect(tipText.includes("Person 2 absorbs the odd cent"), "largest fractional part absorbs the cent");
  await page.uncheck("#tipUnequal");

  /* 7 — unit price: cheapest highlighted with a plain-language verdict */
  await page.click('.mode[data-m="unit"]');
  await page.fill('[aria-label="Option A price"]', "3.49");
  await page.fill('[aria-label="Option A quantity"]', "12");
  await page.fill('[aria-label="Option A unit"]', "oz");
  await page.fill('[aria-label="Option B price"]', "5.29");
  await page.fill('[aria-label="Option B quantity"]', "20");
  await page.fill('[aria-label="Option B unit"]', "oz");
  let verdict = await page.locator("#upVerdict").innerText();
  const perA = await page.locator("#upRows .uprow").nth(0).locator(".upres").innerText();
  const perB = await page.locator("#upRows .uprow").nth(1).locator(".upres").innerText();
  log(`unit price: A ${perA}, B ${perB} — verdict: ${verdict}`);
  expect(verdict.startsWith("Option B is the better deal"), "B is cheapest");
  expect(verdict.includes("% cheaper than Option A"), "verdict quantifies the savings");
  const bestIsB = await page.$eval("#upRows .uprow:nth-child(2)", el => el.classList.contains("best"));
  expect(bestIsB, "cheapest row visually highlighted");
  /* third row + mismatched-unit caution */
  await page.click("#upAdd");
  await page.fill('[aria-label="Option C price"]', "2.99");
  await page.fill('[aria-label="Option C quantity"]', "8");
  await page.fill('[aria-label="Option C unit"]', "lb");
  verdict = await page.locator("#upVerdict").innerText();
  log("unit price with 3rd option in lb: " + verdict);
  expect(verdict.includes("units differ"), "mismatched units get a caution");
  await page.fill('[aria-label="Option C unit"]', "oz");

  /* 8 — number base: conversions, round-trip, two's complement, bitwise ops */
  await page.click('.mode[data-m="base"]');
  await page.fill("#nbVal", "255");
  const b255 = await page.$$eval("#nbOut .v", vs => vs.map(v => v.textContent).join(" | "));
  log("base 255 -> " + b255);
  expect(b255 === "255 | 0xFF | 0b11111111 | 0o377", "255 in all four bases");
  await page.fill("#nbVal", "0xff"); /* round-trip via auto prefix detection */
  const rt = await page.locator("#nbDec").innerText();
  log("round-trip 0xff -> dec " + rt);
  expect(rt === "255", "hex→dec round trip");
  await page.fill("#nbVal", "-26");
  const tc8 = await page.locator("#tc8").innerText();
  const tc16 = await page.locator("#tc16").innerText();
  log(`two's complement of -26: 8-bit ${tc8}, 16-bit ${tc16}`);
  expect(tc8 === "0xE6 · 0b11100110", "-26 as 8-bit two's complement");
  expect(tc16.startsWith("0xFFE6"), "-26 as 16-bit two's complement");
  await page.fill("#nbVal", "0b1100");
  await page.selectOption("#nbOp", "and");
  await page.fill("#nbB", "0b1010");
  const andRes = await page.locator("#opDec").innerText();
  const andBin = await page.locator("#opBin").innerText();
  log(`0b1100 AND 0b1010 = dec ${andRes}, ${andBin}`);
  expect(andRes === "8" && andBin === "0b1000", "bitwise AND");
  await page.selectOption("#nbOp", "shl");
  await page.fill("#nbB", "4");
  const shlRes = await page.locator("#opDec").innerText();
  log("0b1100 << 4 = " + shlRes);
  expect(shlRes === "192", "shift left");
  /* designed error state for garbage input */
  await page.fill("#nbVal", "0xGG");
  const nbErr = await page.locator("#nbErr").innerText();
  const nbDecDash = await page.locator("#nbDec").innerText();
  log(`base error state for 0xGG: "${nbErr}" (dec shows "${nbDecDash}")`);
  expect(nbErr.includes("not a valid hex number") && nbDecDash === "—", "designed invalid-input state");
  await page.fill("#nbVal", "255");

  /* 9 — duration: hh:mm entries, subtraction, running total, $/hour */
  await page.click('.mode[data-m="dur"]');
  const dRow = i => page.locator("#durRows .drow").nth(i);
  await dRow(0).locator("input").fill("1:30");
  await dRow(1).locator("input").fill("0:45");
  await page.click("#durAdd");
  await dRow(2).locator("select").selectOption("-");
  await dRow(2).locator("input").fill("0:15");
  const run1 = await dRow(1).locator(".drun").innerText();
  const total = await page.locator("#durTotal").innerText();
  log(`duration: 1:30 + 0:45 - 0:15, running total after row2 = ${run1}, ${total}`);
  expect(run1 === "2:15", "running total per row");
  expect(total.includes("2:00") && total.includes("2 h 0 m"), "grand total 2:00");
  await page.fill("#durRate", "20");
  const moneyLine = await page.locator("#durMoney").innerText();
  log("duration at $20/hour: " + moneyLine);
  expect(moneyLine.includes("At $20.00/hour") && moneyLine.includes("$40.00"), "total at rate");
  /* unreadable entry is excluded, and says so */
  await dRow(2).locator("input").fill("abc");
  const skippedNote = await page.locator("#durTotal").innerText();
  log("duration with unreadable entry: " + skippedNote);
  expect(skippedNote.includes("not counted"), "unreadable entries flagged, not silently zeroed");
  await dRow(2).locator("input").fill("0:15");

  /* 10 — storage hygiene: only the manifest keys are written */
  const keys = await page.evaluate(() => Object.keys(localStorage).sort().join(","));
  log("localStorage keys: " + keys);
  /* suite.hub.recents is written by the shared core tool chrome, not by calc */
  expect(keys.split(",").every(k =>
    ["suite.calc.mode", "suite.calc.tape", "suite.theme", "suite.hub.recents"].includes(k)),
    "no tool keys beyond suite.calc.tape and suite.calc.mode");
  expect(keys.includes("suite.calc.tape") && keys.includes("suite.calc.mode"), "manifest keys present");

  /* 11 — mobile 390px: every mode fits with no horizontal overflow */
  await page.setViewportSize({ width: 390, height: 844 });
  for (const m of ["tape", "tip", "unit", "base", "dur"]) {
    await page.click(`.mode[data-m="${m}"]`);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    log(`mobile 390px, mode ${m}: horizontal overflow = ${over}px`);
    expect(over <= 0, `no horizontal overflow in ${m} mode at 390px`);
  }
  await page.click('.mode[data-m="tape"]');
  /* tape results must stay readable (not ellipsis-clipped) on mobile */
  const resClip = await line(0).locator(".tres").evaluate(el => el.scrollWidth - el.clientWidth);
  const resText = await result(0);
  log(`mobile tape result: "${resText}", clipped by ${resClip}px`);
  expect(resClip <= 0 && resText === "= 42", "tape result fully visible at 390px");
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  log("mobile screenshot: mobile.png (tape mode at 390x844)");

  /* restore desktop + tape mode for the after-interaction shot */
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('.mode[data-m="tape"]');
}
