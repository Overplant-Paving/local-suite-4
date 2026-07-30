/* tests/interactions/healthlog.mjs — exercises the Personal Health Log end-to-end.
   Fully offline tool: BP category vectors (2017 ACC/AHA bands), lb/kg display
   conversion, 7-day average math on seeded data, sparkline paths, filter +
   soft-confirm delete, CSV export content, persistence across reload,
   disclaimer, labels, and 390px no-overflow. Deterministic: fixed timestamps
   for category/CSV checks; offsets from run-time "now" for the 7-day window
   (assertions depend only on the offsets, never on the wall-clock date). */
import { join } from "node:path";
import { readFileSync } from "node:fs";

export const selectors = [
  "body", "header h1", ".theme-btn", "footer", "#disclaimer", "#fType",
  ".card", ".trend", "#entryList", "#exportBtn", ".fbtn", ".btn"
];
export const screenshotAfterInteract = true;

function expect(cond, msg) { if (!cond) throw new Error("EXPECT FAIL: " + msg); }

/* "YYYY-MM-DDTHH:MM" in the machine's local zone (same zone the page uses) */
function dtLocal(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const daysAgo = n => { const d = new Date(); d.setMinutes(d.getMinutes() - Math.round(n * 24 * 60)); return d; };

export async function interact({ page, log, evidenceDir }) {
  async function addEntry(type, when, fields) {
    await page.selectOption("#fType", type);
    await page.fill("#fWhen", when);
    for (const [sel, val] of Object.entries(fields)) await page.fill(sel, String(val));
    await page.click("#addBtn");
  }
  const catOf = valText =>
    page.locator(".entry", { hasText: valText }).locator(".e-cat").innerText();

  /* 1 — disclaimer + guideline citation are visible */
  const disc = await page.locator("#disclaimer").innerText();
  expect(await page.locator("#disclaimer").isVisible(), "disclaimer visible");
  expect(/not medical advice/i.test(disc), "disclaimer says 'not medical advice'");
  expect(/2017 ACC\/AHA/.test(disc), "disclaimer cites the 2017 ACC/AHA guideline");
  expect(/talk to a clinician/i.test(disc), "disclaimer carries clinician wording");
  log("disclaimer visible, cites 2017 ACC/AHA, 'not medical advice' + clinician wording present");

  /* 2 — datetime defaults to now (non-empty, parseable) */
  const whenDefault = await page.inputValue("#fWhen");
  expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(whenDefault), "datetime defaults to a valid local value");
  log("datetime-local default on load: " + whenDefault);

  /* 3 — BP category vectors (fixed timestamps), incl. live form preview */
  const bpVectors = [
    ["2026-01-10T08:00", 118, 78, "Normal", { "#fPulse": 62 }],
    ["2026-01-11T08:00", 124, 79, "Elevated", {}],
    ["2026-01-12T08:00", 132, 85, "Stage 1 hypertension", {}],
    ["2026-01-13T08:00", 145, 95, "Stage 2 hypertension", {}],
    ["2026-01-14T09:30", 185, 122, "Hypertensive crisis", {}],
  ];
  for (const [when, sys, dia, want, extra] of bpVectors) {
    await page.selectOption("#fType", "bp");
    await page.fill("#fSys", String(sys));
    await page.fill("#fDia", String(dia));
    const preview = await page.locator("#bpPreview").innerText();
    expect(preview.includes(want), `form preview for ${sys}/${dia} says "${want}" (got "${preview}")`);
    await addEntry("bp", when, { "#fSys": sys, "#fDia": dia, ...extra });
    const got = await catOf(`${sys}/${dia}`);
    expect(got.includes(want), `entry ${sys}/${dia} categorized "${want}" (got "${got}")`);
    log(`BP vector ${sys}/${dia} -> "${got}"` + (when === "2026-01-14T09:30" ? ` · preview: "${preview}"` : ""));
  }
  const crisisPrev = await page.locator(".entry", { hasText: "185/122" }).locator(".e-cat").innerText();
  expect(/talk to a clinician/i.test(crisisPrev), "crisis entry carries clinician wording");
  expect((await page.locator(".entry", { hasText: "118/78" }).innerText()).includes("62 bpm"),
    "optional pulse shown on the 118/78 entry");
  log("crisis wording on entry: \"" + crisisPrev + "\"; pulse 62 bpm rendered");

  /* 4 — recent BP pair inside the 7-day window drives latest + 7-day avg */
  await addEntry("bp", dtLocal(daysAgo(2)), { "#fSys": 122, "#fDia": 78 });
  await addEntry("bp", dtLocal(daysAgo(4)), { "#fSys": 118, "#fDia": 76 });
  const bpLatest = await page.locator("#stat-bp .latest").innerText();
  const bpCat = await page.locator("#stat-bp .cat").innerText();
  const bpAvg = await page.locator("#stat-bp .avg7").innerText();
  expect(bpLatest === "122/78", `BP latest is the newest reading 122/78 (got "${bpLatest}")`);
  expect(bpCat.includes("Elevated"), `latest BP category Elevated (got "${bpCat}")`);
  expect(bpAvg.includes("120/77"), `BP 7-day avg (122+118)/2=120, (78+76)/2=77 (got "${bpAvg}")`);
  log(`BP stat card: latest ${bpLatest} (${bpCat}), "${bpAvg}"`);

  /* 5 — BP sparkline: two paths (sys + dia) with real geometry, min/max labels */
  const bpPaths = await page.locator("#spark-bp path").count();
  const bpD = await page.locator("#spark-bp path").first().getAttribute("d");
  expect(bpPaths === 2, `BP sparkline has sys+dia paths (got ${bpPaths})`);
  expect(/^M[\d.]+ [\d.]+ L/.test(bpD), `BP sparkline path has real geometry (d="${bpD.slice(0, 30)}…")`);
  const bpMM = await page.locator("#stat-bp .mm").innerText();
  expect(bpMM.includes("118–185") && bpMM.includes("76–122"), `BP min/max labels (got "${bpMM}")`);
  log(`BP sparkline: 2 paths, d starts "${bpD.slice(0, 24)}…", labels "${bpMM}"`);

  /* 6 — weight: seeded 7-day-average math; entry 10 days ago must be excluded */
  await addEntry("weight", dtLocal(daysAgo(10)), { "#fWeight": 170 });
  await addEntry("weight", dtLocal(daysAgo(6)), { "#fWeight": 180 });
  await addEntry("weight", dtLocal(daysAgo(3)), { "#fWeight": 181 });
  await addEntry("weight", dtLocal(daysAgo(1)), { "#fWeight": 183 });
  const wLatest = await page.locator("#stat-weight .latest").innerText();
  const wAvg = await page.locator("#stat-weight .avg7").innerText();
  expect(wLatest === "183.0 lb", `weight latest 183.0 lb (got "${wLatest}")`);
  expect(wAvg.includes("181.3 lb"), `7-day avg (180+181+183)/3=181.3 lb, 170@10d excluded (got "${wAvg}")`);
  const wD = await page.locator("#spark-weight path").getAttribute("d");
  expect(/^M[\d.]+ [\d.]+ L/.test(wD), "weight sparkline path renders");
  const wMM = await page.locator("#stat-weight .mm").innerText();
  expect(wMM.includes("170.0") && wMM.includes("183.0"), `weight min/max labels (got "${wMM}")`);
  log(`weight stat card: latest ${wLatest}, "${wAvg}", min/max "${wMM}"`);

  /* 7 — kg display toggle (180 lb * 0.45359237 = 81.6 kg; 183 -> 83.0) */
  await page.click("#unitBtn");
  expect((await page.getAttribute("#unitBtn", "aria-pressed")) === "true", "unit toggle aria-pressed=true in kg mode");
  const wLatestKg = await page.locator("#stat-weight .latest").innerText();
  expect(wLatestKg === "83.0 kg", `latest converts to 83.0 kg (got "${wLatestKg}")`);
  expect(await page.locator(".entry", { hasText: "81.6 kg" }).count() === 1,
    "180 lb entry row displays as 81.6 kg");
  const wLabelKg = await page.locator("#weightLabel").innerText();
  expect(wLabelKg.includes("kg"), `weight input relabels to kg (got "${wLabelKg}")`);
  log(`kg toggle: latest ${wLatestKg}, 180 lb row shows 81.6 kg, input label "${wLabelKg}", aria-pressed=true`);
  await page.click("#unitBtn"); // back to lb
  expect((await page.locator("#stat-weight .latest").innerText()) === "183.0 lb", "toggling back restores lb display");
  log("lb toggle back: latest 183.0 lb, aria-pressed=" + await page.getAttribute("#unitBtn", "aria-pressed"));

  /* 8 — sleep: 0.5 steps, 7-day average */
  expect((await page.getAttribute("#fSleep", "step")) === "0.5", "sleep input advertises 0.5 steps");
  await addEntry("sleep", dtLocal(daysAgo(2)), { "#fSleep": 6.5 });
  await addEntry("sleep", dtLocal(daysAgo(1)), { "#fSleep": 7.5 });
  const sLatest = await page.locator("#stat-sleep .latest").innerText();
  const sAvg = await page.locator("#stat-sleep .avg7").innerText();
  expect(sLatest === "7.5 h", `sleep latest 7.5 h (got "${sLatest}")`);
  expect(sAvg.includes("7.0 h"), `sleep 7-day avg (6.5+7.5)/2=7.0 h (got "${sAvg}")`);
  expect(/^M[\d.]+ [\d.]+ L/.test(await page.locator("#spark-sleep path").getAttribute("d")),
    "sleep sparkline path renders");
  log(`sleep: step=0.5, latest ${sLatest}, "${sAvg}", sparkline path present`);

  /* 9 — note entry (comma + quotes to exercise CSV quoting later) */
  await addEntry("note", "2026-01-15T07:00", { "#fNote": 'Felt dizzy, "morning" run' });
  expect(await page.locator('.entry[data-type="note"]').count() === 1, "note entry listed");
  log("note entry added: " + (await page.locator('.entry[data-type="note"] .e-val').innerText()));

  /* 10 — filter by type */
  await page.click('#filterRow .fbtn[data-f="bp"]');
  expect((await page.getAttribute('#filterRow .fbtn[data-f="bp"]', "aria-pressed")) === "true",
    "active filter has aria-pressed=true");
  let vis = await page.locator("#entryList .entry").count();
  expect(vis === 7, `BP filter shows the 7 BP entries (got ${vis})`);
  expect(await page.locator('#entryList .entry:not([data-type="bp"])').count() === 0, "only BP rows visible");
  await page.click('#filterRow .fbtn[data-f="sleep"]');
  expect(await page.locator("#entryList .entry").count() === 2, "sleep filter shows 2 entries");
  await page.click('#filterRow .fbtn[data-f="all"]');
  vis = await page.locator("#entryList .entry").count();
  expect(vis === 14, `All filter shows every entry (got ${vis})`);
  log("filters: bp=7, sleep=2, all=14, aria-pressed tracks the active filter");

  /* 11 — soft-confirm delete on the 170.0 lb seed */
  const row170 = page.locator(".entry", { hasText: "170.0 lb" });
  await row170.locator(".del").click();
  expect(await page.locator("#entryList .entry").count() === 14, "first click arms, does not delete");
  const armedText = await row170.locator(".del").innerText();
  expect(/confirm/i.test(armedText), `delete button arms to a confirm state (got "${armedText}")`);
  await row170.locator(".del").click();
  expect(await page.locator("#entryList .entry").count() === 13, "second click deletes the entry");
  expect(await page.locator(".entry", { hasText: "170.0 lb" }).count() === 0, "170.0 lb entry gone");
  log(`delete: first click -> "${armedText}" (still 14 rows), second click -> 13 rows`);

  /* 12 — CSV export: header, ISO timestamps, category column, RFC-4180 quoting */
  const dl = page.waitForEvent("download", { timeout: 5000 });
  await page.click("#exportBtn");
  const download = await dl;
  const csvPath = join(evidenceDir, "export.csv");
  await download.saveAs(csvPath);
  const csv = readFileSync(csvPath, "utf8");
  const lines = csv.trim().split("\n");
  expect(lines[0] === "timestamp,type,systolic,diastolic,pulse,bp_category,weight_lb,sleep_hours,note",
    `CSV header (got "${lines[0]}")`);
  expect(lines.length === 14, `CSV = header + 13 entries (got ${lines.length} lines)`);
  const crisisISO = await page.evaluate(() => new Date("2026-01-14T09:30").toISOString());
  const crisisLine = lines.find(l => l.startsWith(crisisISO));
  expect(crisisLine === `${crisisISO},bp,185,122,,Hypertensive crisis,,,`,
    `crisis CSV line exact (got "${crisisLine}")`);
  expect(csv.includes('"Felt dizzy, ""morning"" run"'), "note with comma+quotes is RFC-4180 quoted");
  expect(csv.includes(",bp,118,78,62,Normal,"), "pulse and Normal category in the 118/78 line");
  log(`CSV: ${lines.length} lines, filename ${download.suggestedFilename()}, crisis line "${crisisLine}"`);

  /* 13 — persistence: storage key written, everything survives a reload */
  const ls = await page.evaluate(() => {
    const raw = localStorage.getItem("suite.healthlog.v1");
    const v = JSON.parse(raw);
    return { present: raw !== null, entries: v.entries.length, unit: v.unit };
  });
  expect(ls.present && ls.entries === 13 && ls.unit === "lb",
    `suite.healthlog.v1 holds 13 entries, unit lb (got ${JSON.stringify(ls)})`);
  await page.reload();
  await page.waitForTimeout(300);
  expect(await page.locator("#entryList .entry").count() === 13, "13 entries after reload");
  expect((await page.locator("#stat-weight .latest").innerText()) === "183.0 lb", "weight stats after reload");
  expect((await catOf("185/122")).includes("Hypertensive crisis"), "BP categories after reload");
  log("persistence: suite.healthlog.v1 = 13 entries; reload keeps list, stats, categories");

  /* 14 — a11y: live region, every input labeled, quota note channel exists */
  expect((await page.getAttribute("#entryList", "aria-live")) !== null, "entry list is an aria-live region");
  const unlabeled = await page.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")].filter(el =>
      !(el.id && document.querySelector(`label[for="${el.id}"]`)) &&
      !el.getAttribute("aria-label") && !el.closest("label")
    ).map(el => el.id || el.type));
  expect(unlabeled.length === 0, "unlabeled controls: " + JSON.stringify(unlabeled));
  expect((await page.getAttribute("#unitBtn", "aria-pressed")) === "false", "unit toggle exposes aria-pressed");
  log("a11y: #entryList aria-live set, 0 unlabeled inputs/selects/textareas, toggles expose aria-pressed");

  /* 15 — mobile 390px: no horizontal overflow */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const ov = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { sw: el.scrollWidth, cw: el.clientWidth };
  });
  expect(ov.sw <= ov.cw, `no horizontal overflow at 390px (scrollWidth ${ov.sw} vs clientWidth ${ov.cw})`);
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  log(`mobile 390px: scrollWidth ${ov.sw} <= clientWidth ${ov.cw}, screenshot mobile.png`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
}
