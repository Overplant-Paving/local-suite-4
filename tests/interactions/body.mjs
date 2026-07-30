/* tests/interactions/body.mjs — exercises the Body Metrics Calculator end-to-end.
   Offline tool: known-vector math (male 30y 180cm 80kg → BMI 24.7, Mifflin BMR 1780,
   TDEE ×1.55 = 2759), imperial round-trip (5'11" + 176 lb ≈ same outputs), Karvonen
   vs %HRmax zone bounds and method-label switching, persistence reload, clear,
   disclaimer visibility, a11y labels/aria-pressed, and 390 px no-overflow. */
import { join } from "node:path";

export const selectors = [
  "body", ".wrap", "header h1", ".theme-btn", ".disclaimer", ".card",
  ".seg", "#stats", "#zones", "#empty", "footer"
];
export const screenshotAfterInteract = true;

function expect(cond, msg) { if (!cond) throw new Error("EXPECT FAILED: " + msg); }
const numOf = s => parseFloat(String(s).replace(/,/g, ""));

async function zoneRow(page, i) {
  const cells = await page.locator(`#zoneBody tr:nth-child(${i}) td`).allInnerTexts();
  return cells.map(c => c.trim());
}

export async function interact({ page, log, evidenceDir }) {
  /* 1 — designed empty state + prominent disclaimer on load */
  expect(await page.locator("#empty").isVisible(), "empty state visible on load");
  expect(!(await page.locator("#results").isVisible()), "results hidden with no inputs");
  const disc = (await page.locator("#disclaimer").innerText()).trim();
  expect(await page.locator("#disclaimer").isVisible(), "disclaimer visible");
  expect(/not medical advice/i.test(disc), "disclaimer says not medical advice");
  log("empty state on load: visible; disclaimer visible: " + JSON.stringify(disc.slice(0, 90) + "…"));

  /* 2 — known metric vector: male, 30 y, 180 cm, 80 kg, moderate */
  await page.fill("#age", "30");
  await page.selectOption("#sex", "male");
  await page.fill("#hcm", "180");
  await page.fill("#wkg", "80");
  await page.selectOption("#act", "1.55");
  const bmi = await page.locator("#bmiVal").innerText();
  const bmr = await page.locator("#bmrVal").innerText();
  const tdee = await page.locator("#tdeeVal").innerText();
  expect(bmi === "24.7", `BMI 24.7 for 80kg/180cm (got ${bmi})`);
  expect(numOf(bmr) === 1780, `Mifflin BMR 1780 (10·80 + 6.25·180 − 5·30 + 5) (got ${bmr})`);
  expect(numOf(tdee) === 2759, `TDEE 1780 × 1.55 = 2759 (got ${tdee})`);
  log(`metric vector male/30y/180cm/80kg/moderate → BMI ${bmi}, BMR ${bmr} kcal, TDEE ${tdee} kcal`);
  const cat = await page.locator("#bmiCat").innerText();
  expect(/Healthy range/.test(cat), "24.7 classified WHO Healthy range");
  log("WHO category line: " + cat);
  const range = await page.locator("#rangeVal").innerText();
  expect(range.includes("59.9") && range.includes("80.7") && range.includes("kg"),
    `healthy range 59.9–80.7 kg for 180 cm (got ${range})`);
  log("healthy-weight range (BMI 18.5–24.9) at 180 cm: " + range);
  expect(/muscle and fat weigh the same/i.test(await page.locator("#results").innerText()),
    "BMI composition caveat rendered");

  /* 3 — zones without resting HR: straight % of HRmax = 190 */
  let method = await page.locator("#zoneMethod").innerText();
  expect(/straight % of HRmax/.test(method), "method label says % of HRmax with no resting HR");
  expect(/220 − age = 190 bpm/.test(method), "HRmax 220−30=190 named in label");
  expect(/population estimate/.test(method), "label admits 220−age is a population estimate");
  let z1 = await zoneRow(page, 1), z5 = await zoneRow(page, 5);
  expect(z1[3] === "95 – 114 bpm", `%max zone 1 = 95–114 bpm (got ${z1[3]})`);
  expect(z5[3] === "171 – 190 bpm", `%max zone 5 = 171–190 bpm (got ${z5[3]})`);
  log(`zones without resting HR (% of HRmax): method="${method.slice(0, 60)}…", z1=${z1[3]}, z5=${z5[3]}`);

  /* 4 — Karvonen with resting 60: target = 60 + %·(190−60) */
  await page.fill("#rhr", "60");
  method = await page.locator("#zoneMethod").innerText();
  expect(/Karvonen/.test(method), "method label switched to Karvonen with resting HR");
  z1 = await zoneRow(page, 1);
  const z4 = await zoneRow(page, 4); z5 = await zoneRow(page, 5);
  expect(z1[3] === "125 – 138 bpm", `Karvonen zone 1 = 125–138 (60+0.5·130 … 60+0.6·130) (got ${z1[3]})`);
  expect(z4[3] === "164 – 177 bpm", `Karvonen zone 4 = 164–177 (got ${z4[3]})`);
  expect(z5[3] === "177 – 190 bpm", `Karvonen zone 5 = 177–190 (got ${z5[3]})`);
  log(`zones with resting 60 (Karvonen): z1=${z1[3]}, z4=${z4[3]}, z5=${z5[3]}; label="${method.slice(0, 70)}…"`);

  /* 5 — unit toggle converts, imperial round-trip ≈ same outputs */
  await page.click("#uImperial");
  expect(await page.getAttribute("#uImperial", "aria-pressed") === "true", "imperial aria-pressed=true");
  expect(await page.getAttribute("#uMetric", "aria-pressed") === "false", "metric aria-pressed=false");
  log(`toggle → imperial: 180 cm / 80 kg converted to ${await page.inputValue("#hft")}'` +
      `${await page.inputValue("#hin")}" and ${await page.inputValue("#wlb")} lb`);
  await page.fill("#hft", "5");
  await page.fill("#hin", "11");
  await page.fill("#wlb", "176");
  const iBmi = numOf(await page.locator("#bmiVal").innerText());
  const iBmr = numOf(await page.locator("#bmrVal").innerText());
  const iTdee = numOf(await page.locator("#tdeeVal").innerText());
  expect(Math.abs(iBmi - 24.7) <= 0.3, `imperial BMI ≈ 24.7 (got ${iBmi})`);
  expect(Math.abs(iBmr - 1780) <= 6, `imperial BMR ≈ 1780 (got ${iBmr})`);
  expect(Math.abs(iTdee - 2759) <= 10, `imperial TDEE ≈ 2759 (got ${iTdee})`);
  const iRange = await page.locator("#rangeVal").innerText();
  expect(iRange.includes("lb"), "healthy range shown in lb under imperial");
  log(`imperial vector 5'11" + 176 lb → BMI ${iBmi}, BMR ${iBmr}, TDEE ${iTdee}, range ${iRange}`);

  /* 6 — persistence: suite.body.v1 written; reload restores everything */
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("suite.body.v1")));
  expect(stored && stored.unit === "imperial" && stored.age === "30" && stored.wlb === "176" &&
    stored.rhr === "60", "suite.body.v1 holds unit + inputs");
  log("suite.body.v1 after edits: " + JSON.stringify(stored));
  await page.reload();
  await page.waitForTimeout(300);
  expect(await page.inputValue("#age") === "30", "age restored after reload");
  expect(await page.inputValue("#wlb") === "176", "weight (lb) restored after reload");
  expect(await page.getAttribute("#uImperial", "aria-pressed") === "true", "imperial unit restored");
  const rBmr = numOf(await page.locator("#bmrVal").innerText());
  expect(Math.abs(rBmr - 1780) <= 6, "results recomputed from restored inputs");
  log(`reload: unit + inputs restored, BMR recomputed = ${rBmr} kcal`);

  /* 7 — clear button empties fields, removes the key, returns to empty state */
  await page.click("#clearBtn");
  expect(await page.inputValue("#age") === "", "age cleared");
  expect(await page.locator("#empty").isVisible(), "empty state back after clear");
  expect(await page.evaluate(() => localStorage.getItem("suite.body.v1")) === null,
    "suite.body.v1 removed by clear");
  expect(await page.getAttribute("#uMetric", "aria-pressed") === "true", "clear resets to metric");
  log("clear: fields emptied, suite.body.v1 removed, empty state visible, unit back to metric");

  /* 8 — a11y: every visible input labeled, live regions marked */
  const unlabeled = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("input, select")) {
      const byFor = el.id && document.querySelector(`label[for="${el.id}"]`);
      if (!byFor && !el.getAttribute("aria-label")) bad.push(el.id || el.name || el.type);
    }
    return bad;
  });
  expect(unlabeled.length === 0, "unlabeled controls: " + unlabeled.join(","));
  expect(await page.getAttribute("#stats", "aria-live") === "polite", "#stats is a live region");
  expect(await page.getAttribute("#zoneMethod", "aria-live") === "polite", "#zoneMethod is a live region");
  log("a11y: all inputs/selects labeled (label[for] or aria-label); #stats + #zoneMethod aria-live=polite; unit toggle uses aria-pressed");

  /* 9 — refill the metric vector (female variant logged too), then mobile 390px */
  await page.fill("#age", "30");
  await page.fill("#hcm", "180");
  await page.fill("#wkg", "80");
  await page.fill("#rhr", "60");
  await page.selectOption("#sex", "female");
  const fBmr = numOf(await page.locator("#bmrVal").innerText());
  expect(fBmr === 1614, `female Mifflin −161 → 1614 (got ${fBmr})`); /* 1780 − 166 */
  log("sex switch to female: BMR 1780 → " + fBmr + " (Mifflin −161 constant)");
  await page.selectOption("#sex", "male");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const ov = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(ov.sw <= ov.cw, `no horizontal overflow at 390px (scrollWidth ${ov.sw} > clientWidth ${ov.cw})`);
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  log(`mobile 390px: scrollWidth ${ov.sw} <= clientWidth ${ov.cw}, screenshot mobile.png`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200);
}
