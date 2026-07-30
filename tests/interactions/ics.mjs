/* tests/interactions/ics.mjs — exercises the Calendar Event & ICS Maker end-to-end.
   Offline tool. The generated iCalendar text is parsed IN THE TEST from the actual
   download blob: CRLF endings, 75-octet folding + continuation space, TEXT escaping,
   all-day exclusive DTEND, weekly BYDAY with COUNT and UNTIL variants, VALARM,
   UID/DTSTAMP, the end<start validation state, draft persistence across reload,
   blob MIME, labels on every control, and mobile no-overflow.
   Deterministic: all event dates are frozen in 2027; the only wall-clock value,
   DTSTAMP, is asserted by format alone. */
import { join } from "node:path";

export const selectors = [
  "body", ".wrap", "header h1", ".theme-btn", ".card", "#fTitle",
  "#summary", "#preview", "#download", ".btn.ghost", "footer"
];
export const screenshotAfterInteract = true;

function ok(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }

/* pull the real downloadable artifact out of the object URL */
async function grabICS(page) {
  return page.evaluate(async () => {
    const a = document.getElementById("download");
    const href = a.getAttribute("href") || "";
    if (!href) return { href, type: "", download: "", text: "" };
    const b = await (await fetch(href)).blob();
    return { href, type: b.type, download: a.getAttribute("download"), text: await b.text() };
  });
}

/* strict physical-line checks, then RFC 5545 §3.1 unfolding */
function physicalLines(text) {
  ok(text.endsWith("\r\n"), "ICS must end with CRLF");
  ok(!text.replace(/\r\n/g, "").includes("\n"), "bare LF found outside CRLF pairs");
  ok(!text.replace(/\r\n/g, "").includes("\r"), "bare CR found outside CRLF pairs");
  const lines = text.split("\r\n");
  ok(lines.pop() === "", "text after final CRLF");
  for (const l of lines) {
    ok(Buffer.byteLength(l, "utf8") <= 75, `physical line over 75 octets: "${l}"`);
  }
  return lines;
}
function unfold(lines) {
  const out = [];
  for (const l of lines) {
    if (l.startsWith(" ")) out[out.length - 1] += l.slice(1);
    else out.push(l);
  }
  return out;
}
/* same TEXT escaping the page must apply (RFC 5545 §3.3.11) */
const rfcEsc = s => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;")
                     .replace(/,/g, "\\,").replace(/\n/g, "\\n");

export async function interact({ page, log, evidenceDir }) {
  const LONG_DESC = "a, b; c\nnewline — " + "folding filler ".repeat(12) + "café ✓";

  /* 1 — full timed weekly event with COUNT, reminder, and text needing escaping */
  await page.fill("#fTitle", "Team sync");
  await page.fill("#fLoc", "Room 4; West wing");
  await page.fill("#fDesc", LONG_DESC);
  await page.fill("#fUrl", "https://example.com/agenda?id=42");
  await page.fill("#fStartDate", "2027-03-01");
  await page.fill("#fStartTime", "09:00");
  await page.fill("#fEndDate", "2027-03-01");
  await page.fill("#fEndTime", "10:00");
  await page.selectOption("#fAlarm", "15");
  await page.selectOption("#fFreq", "weekly");
  await page.check("#bdMO");
  await page.check("#bdWE");
  await page.selectOption("#fEnds", "count");
  await page.fill("#fCount", "10");
  await page.waitForTimeout(100);

  let g = await grabICS(page);
  ok(g.href.startsWith("blob:"), "download href is not a blob URL: " + g.href);
  ok(g.type.startsWith("text/calendar"), "blob MIME is not text/calendar: " + g.type);
  ok(g.download.endsWith(".ics"), "download filename lacks .ics: " + g.download);
  log(`download: href=${g.href.slice(0, 30)}… type=${g.type} filename=${g.download}`);

  let phys = physicalLines(g.text);
  ok(phys.some(l => l.startsWith(" ")), "long DESCRIPTION did not fold (no continuation line)");
  log(`CRLF + folding: ${phys.length} physical lines, all <=75 octets, ` +
      `${phys.filter(l => l.startsWith(" ")).length} continuation line(s) start with a space`);

  let u = unfold(phys);
  ok(u[0] === "BEGIN:VCALENDAR" && u[u.length - 1] === "END:VCALENDAR", "VCALENDAR envelope broken");
  ok(u.includes("VERSION:2.0"), "VERSION:2.0 missing");
  ok(u.some(l => l.startsWith("PRODID:")), "PRODID missing");
  ok(u.includes("DTSTART:20270301T090000"), "floating local DTSTART wrong");
  ok(u.includes("DTEND:20270301T100000"), "floating local DTEND wrong");
  ok(u.includes("SUMMARY:Team sync"), "SUMMARY wrong");
  ok(u.includes("LOCATION:Room 4\\; West wing"), "LOCATION semicolon not escaped");
  ok(u.includes("DESCRIPTION:" + rfcEsc(LONG_DESC)),
     "DESCRIPTION escaping/folding round-trip failed");
  ok(u.includes("URL:https://example.com/agenda?id=42"), "URL missing");
  ok(u.includes("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10"), "weekly BYDAY+COUNT RRULE wrong");
  const uid = u.find(l => l.startsWith("UID:"));
  ok(/^UID:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@local-suite$/.test(uid),
     "UID not randomUUID@local-suite: " + uid);
  const stamp = u.find(l => l.startsWith("DTSTAMP:"));
  ok(/^DTSTAMP:\d{8}T\d{6}Z$/.test(stamp), "DTSTAMP not UTC basic format: " + stamp);
  const ai = u.indexOf("BEGIN:VALARM");
  ok(ai > -1 && u.indexOf("END:VALARM") > ai, "VALARM block missing");
  ok(u.includes("TRIGGER:-PT15M") && u.includes("ACTION:DISPLAY"), "VALARM trigger/action wrong");
  log("VEVENT verified: DTSTART/DTEND floating local, escaped SUMMARY/LOCATION/DESCRIPTION, " +
      "RRULE=FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10, TRIGGER:-PT15M, " + uid + ", " + stamp);
  const summary1 = await page.locator("#summary").innerText();
  log("human summary (count variant): " + summary1);
  ok(summary1.includes("Weekly on Mon, Wed") && summary1.includes("10 times") &&
     summary1.includes("reminder 15 min before"), "summary sentence wrong: " + summary1);

  /* 2 — UNTIL variant: floating local end-of-day matches floating DTSTART */
  await page.selectOption("#fEnds", "until");
  await page.fill("#fUntil", "2027-06-30");
  await page.waitForTimeout(100);
  u = unfold(physicalLines((await grabICS(page)).text));
  ok(u.includes("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20270630T235959"),
     "UNTIL (timed) RRULE wrong: " + u.find(l => l.startsWith("RRULE:")));
  ok(!u.some(l => l.includes("COUNT=")), "COUNT leaked into UNTIL variant");
  log("UNTIL variant: " + u.find(l => l.startsWith("RRULE:")) +
      " · summary: " + (await page.locator("#summary").innerText()));

  /* 3 — all-day: DATE values, exclusive DTEND = day after last day, DATE-typed UNTIL */
  await page.check("#fAllDay");
  await page.fill("#fEndDate", "2027-03-03");
  await page.waitForTimeout(100);
  u = unfold(physicalLines((await grabICS(page)).text));
  ok(u.includes("DTSTART;VALUE=DATE:20270301"), "all-day DTSTART wrong");
  ok(u.includes("DTEND;VALUE=DATE:20270304"),
     "all-day DTEND not exclusive day-after-last-day: " + u.find(l => l.startsWith("DTEND")));
  ok(u.includes("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20270630"),
     "all-day UNTIL must be a DATE value: " + u.find(l => l.startsWith("RRULE:")));
  log("all-day Mar 1–3: DTSTART;VALUE=DATE:20270301, DTEND;VALUE=DATE:20270304 (exclusive), " +
      "UNTIL=20270630 (DATE)");
  await page.fill("#fEndDate", "2027-03-01");
  await page.waitForTimeout(100);
  u = unfold(physicalLines((await grabICS(page)).text));
  ok(u.includes("DTEND;VALUE=DATE:20270302"), "single-day all-day DTEND should be next day");
  log("single-day all-day: DTEND;VALUE=DATE:20270302");

  /* 4 — validation error state: end before start */
  await page.uncheck("#fAllDay");
  await page.fill("#fEndDate", "2027-02-28");
  await page.waitForTimeout(100);
  ok(await page.locator("#err").isVisible(), "error card not shown for end<start");
  const errText = await page.locator("#err").innerText();
  ok((await page.locator("#download").getAttribute("href")) === null,
     "download still enabled during validation error");
  ok((await page.locator("#download").getAttribute("aria-disabled")) === "true",
     "download not aria-disabled during error");
  ok((await page.locator("#preview").innerText()).trim() === "",
     "preview not cleared during error");
  log(`validation end<start: err="${errText}", download href removed, aria-disabled=true, ` +
      "preview cleared");

  /* 5 — hostile/non-web URI schemes never enter the downloadable artifact */
  await page.fill("#fEndDate", "2027-03-01");
  await page.fill("#fUrl", "javascript:alert(document.domain)");
  await page.waitForTimeout(100);
  ok(await page.locator("#err").isVisible(), "javascript: URL did not show a validation error");
  ok(/http:\/\/ or https:\/\//.test(await page.locator("#err").innerText()),
    "scheme error does not explain the http/https restriction");
  ok((await page.locator("#download").getAttribute("href")) === null,
    "download still enabled for javascript: URL");
  ok((await page.locator("#preview").innerText()).trim() === "",
    "preview retained content for javascript: URL");
  await page.fill("#fUrl", "data:text/html,<script>alert(1)</script>");
  await page.waitForTimeout(100);
  ok(await page.locator("#err").isVisible(), "data: URL did not show a validation error");
  ok((await page.locator("#download").getAttribute("href")) === null,
    "download still enabled for data: URL");
  log("URL scheme guard: javascript: and data: rejected; download disabled and preview cleared");
  await page.fill("#fUrl", "https://example.com/agenda?id=42");

  /* 6 — zero-duration timed event legally omits DTEND */
  await page.fill("#fEndDate", "2027-03-01");
  await page.fill("#fEndTime", "09:00");
  await page.waitForTimeout(100);
  u = unfold(physicalLines((await grabICS(page)).text));
  ok(!u.some(l => l.startsWith("DTEND")), "zero-duration event must omit DTEND");
  log("zero-duration event: DTEND omitted (RFC 5545 §3.6.1)");
  await page.fill("#fEndDate", "2027-03-05");
  await page.fill("#fEndTime", "10:00");
  await page.waitForTimeout(100);

  /* 7 — draft persists across reload (suite.ics.draft) */
  ok(await page.evaluate(() => localStorage.getItem("suite.ics.draft") !== null),
     "suite.ics.draft not written");
  await page.reload();
  await page.waitForTimeout(500);
  const restored = await page.evaluate(() => ({
    title: document.getElementById("fTitle").value,
    freq: document.getElementById("fFreq").value,
    mo: document.getElementById("bdMO").checked,
    we: document.getElementById("bdWE").checked,
    tu: document.getElementById("bdTU").checked,
    ends: document.getElementById("fEnds").value,
    until: document.getElementById("fUntil").value,
    endDate: document.getElementById("fEndDate").value
  }));
  ok(restored.title === "Team sync" && restored.freq === "weekly" && restored.mo &&
     restored.we && !restored.tu && restored.ends === "until" &&
     restored.until === "2027-06-30" && restored.endDate === "2027-03-05",
     "draft not restored after reload: " + JSON.stringify(restored));
  log("draft restored after reload: " + JSON.stringify(restored));
  ok((await page.locator("#preview").innerText()).includes("BEGIN:VCALENDAR"),
     "preview not regenerated from restored draft");
  log("preview regenerated from restored draft on load");

  /* 7 — a11y: every control has an associated label (or aria-label) */
  const unlabeled = await page.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")]
      .filter(el => !(el.labels && el.labels.length) && !el.getAttribute("aria-label"))
      .map(el => el.id || el.outerHTML.slice(0, 60)));
  ok(unlabeled.length === 0, "unlabeled controls: " + unlabeled.join(", "));
  const nControls = await page.locator("input, select, textarea").count();
  log(`a11y: all ${nControls} form controls have labels; theme button aria-pressed=` +
      (await page.locator("#themeBtn").getAttribute("aria-pressed")));

  /* 8 — mobile 390px: no horizontal overflow */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth
  }));
  ok(m.sw <= m.cw, `mobile horizontal overflow: scrollWidth ${m.sw} > clientWidth ${m.cw}`);
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  log(`mobile 390px: scrollWidth ${m.sw} <= clientWidth ${m.cw}, screenshot mobile.png`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);

  /* 9 — clear draft */
  await page.click("#clearDraft");
  await page.waitForTimeout(100);
  ok((await page.locator("#fTitle").inputValue()) === "", "title not cleared by clear-draft");
  ok(await page.evaluate(() => localStorage.getItem("suite.ics.draft") === null),
     "suite.ics.draft not removed by clear-draft");
  log("clear draft: form reset to defaults, suite.ics.draft removed");

  /* leave a populated state so the after-interaction screenshot shows the feature */
  await page.fill("#fTitle", "Team sync");
  await page.fill("#fStartDate", "2027-03-01");
  await page.fill("#fStartTime", "09:00");
  await page.fill("#fEndDate", "2027-03-01");
  await page.fill("#fEndTime", "10:00");
  await page.selectOption("#fAlarm", "15");
  await page.selectOption("#fFreq", "weekly");
  await page.check("#bdMO");
  await page.check("#bdWE");
  await page.selectOption("#fEnds", "count");
  await page.fill("#fCount", "10");
  await page.waitForTimeout(100);
  log("final state: weekly Mon/Wed event re-filled · summary: " +
      (await page.locator("#summary").innerText()));
}
