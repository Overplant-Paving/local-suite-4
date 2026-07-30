/* tests/interactions/metronome.mjs — exercises Metronome & Practice Tones.
   Offline tool. Asserts scheduling via the documented test-only hook
   window.__metronome (beatCount / running / bpm / scheduled accents / tone
   counters) instead of listening to audio; tap-tempo math with stubbed
   performance.now timestamps; two-way BPM binding; Space toggle; persistence
   round-trip; aria-pressed on toggles; mobile no-overflow. */
import { join } from "node:path";

export const selectors = [
  "body", ".wrap", "header h1", ".theme-btn", ".card", ".play",
  "#bpmSlider", "#bpmNum", "#tapBtn", "#meterPick", ".dots", "#vol",
  "#tones", "footer"
];
export const screenshotAfterInteract = true;

function expect(cond, msg) { if (!cond) throw new Error("EXPECT FAILED: " + msg); }
const dbg = (page) => page.evaluate(() => {
  const d = window.__metronome;
  return { running: d.running, bpm: d.bpm, beatsPerBar: d.beatsPerBar,
           beatCount: d.beatCount, scheduled: d.scheduled.slice(-24),
           toneStarts: d.toneStarts, toneStops: d.toneStops,
           activeToneFreq: d.activeToneFreq };
});

export async function interact({ page, log, evidenceDir }) {
  /* 1 — initial state: stopped, defaults, dots rendered for 4/4 */
  let d = await dbg(page);
  expect(d.running === false && d.beatCount === 0, "starts stopped with no beats");
  expect(await page.locator("#startBtn").getAttribute("aria-pressed") === "false", "start aria-pressed=false");
  log(`initial: running=${d.running} bpm=${d.bpm} beatsPerBar=${d.beatsPerBar} dots=` +
      (await page.locator(".dot").count()));

  /* 2 — BPM two-way binding: slider -> number, number -> slider, clamping */
  await page.locator("#bpmSlider").fill("180");
  expect(await page.inputValue("#bpmNum") === "180", "slider updates number input");
  await page.fill("#bpmNum", "96");
  await page.dispatchEvent("#bpmNum", "input");
  expect(await page.inputValue("#bpmSlider") === "96", "number input updates slider");
  await page.fill("#bpmNum", "999");
  await page.dispatchEvent("#bpmNum", "change");
  d = await dbg(page);
  expect(d.bpm === 250 && await page.inputValue("#bpmNum") === "250", "out-of-range BPM clamps to 250");
  log(`bpm binding: slider->num 180 ok, num->slider 96 ok, 999 clamped to ${d.bpm}`);
  await page.fill("#bpmNum", "120");
  await page.dispatchEvent("#bpmNum", "change");

  /* 3 — start: scheduler runs, beats accumulate, no drift stall */
  await page.click("#startBtn");
  expect(await page.locator("#startBtn").getAttribute("aria-pressed") === "true", "start aria-pressed=true");
  await page.waitForTimeout(900);
  d = await dbg(page);
  expect(d.running === true, "hook reports running");
  expect(d.beatCount >= 2, `beats scheduled after 900ms at 120 BPM (got ${d.beatCount})`);
  const countA = d.beatCount;
  await page.waitForTimeout(700);
  d = await dbg(page);
  expect(d.beatCount > countA, "scheduler keeps advancing");
  const litDots = await page.locator(".dot.hit").count();
  log(`scheduling: running=true, beatCount ${countA} -> ${d.beatCount} at 120 BPM, lit dots=${litDots}`);

  /* 4 — accent pattern per signature, via scheduled accent flags (not audio).
     Crank to 240 BPM so enough beats land in a short window. */
  await page.locator("#bpmSlider").fill("240");
  await page.click('#meterPick button[data-m="3/4"]');
  expect(await page.locator('#meterPick button[data-m="3/4"]').getAttribute("aria-pressed") === "true",
    "3/4 aria-pressed");
  expect(await page.locator(".dot").count() === 3, "3 dots in 3/4");
  await page.evaluate(() => { window.__metronome.scheduled.length = 0; });
  await page.waitForTimeout(1600);
  d = await dbg(page);
  const tri = d.scheduled;
  expect(tri.length >= 4, `collected 3/4 beats (got ${tri.length})`);
  for (const s of tri) expect(s.accent === (s.beat === 0), `3/4 accent only on beat 1 (beat ${s.beat})`);
  for (let i = 1; i < tri.length; i++)
    expect(tri[i].beat === (tri[i - 1].beat + 1) % 3, "3/4 beats cycle 0,1,2");
  log(`accents 3/4: ${tri.length} scheduled beats, sequence ` +
      tri.map(s => s.beat + (s.accent ? "*" : "")).join(" ") + " (accent * only on beat 0)");

  await page.click('#meterPick button[data-m="6/8"]');
  expect(await page.locator(".dot").count() === 6, "6 dots in 6/8");
  await page.evaluate(() => { window.__metronome.scheduled.length = 0; });
  await page.waitForTimeout(2200);
  d = await dbg(page);
  const six = d.scheduled;
  expect(six.length >= 6, `collected 6/8 beats (got ${six.length})`);
  for (const s of six) {
    const want = s.beat === 0 ? 2 : s.beat === 3 ? 1 : 0;
    expect(s.level === want, `6/8 level: beat ${s.beat} expected ${want} got ${s.level}`);
  }
  log(`accents 6/8: ${six.length} beats, levels ` + six.map(s => s.level).join("") +
      " (2=strong beat 1, 1=secondary beat 4)");

  /* 5 — Space toggle from body focus; ignored when typing in an input */
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Space");
  d = await dbg(page);
  expect(d.running === false, "Space stops the metronome");
  expect(await page.locator("#startBtn").getAttribute("aria-pressed") === "false", "aria-pressed follows Space stop");
  await page.focus("#bpmNum");
  await page.keyboard.press("Space");
  d = await dbg(page);
  expect(d.running === false, "Space inside an input does NOT toggle");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Space");
  d = await dbg(page);
  expect(d.running === true, "Space starts again from body");
  log("Space toggle: stop from body ok, ignored inside #bpmNum, restart from body ok");
  await page.keyboard.press("Space"); // leave stopped for the tap-tempo math

  /* 6 — tap tempo: deterministic timestamps via stubbed performance.now.
     500ms intervals -> 120 BPM exactly; then a 1500ms outlier is ignored. */
  await page.evaluate(() => {
    window.__now = 50000;
    performance.now = () => window.__now;
  });
  const tapAt = async (t) => {
    await page.evaluate(v => { window.__now = v; }, t);
    await page.click("#tapBtn");
  };
  await tapAt(50000); await tapAt(50500); await tapAt(51000); await tapAt(51500);
  d = await dbg(page);
  expect(d.bpm === 120, `tap 4x @500ms -> 120 BPM (got ${d.bpm})`);
  log("tap tempo: 4 taps at 500ms intervals -> " + d.bpm + " BPM; status: " +
      (await page.locator("#tapStatus").innerText()));
  await tapAt(53000);  // 1500ms gap = outlier among 500ms intervals
  d = await dbg(page);
  expect(d.bpm === 120, `outlier interval ignored, still 120 (got ${d.bpm})`);
  log("tap tempo outlier: extra tap after 1500ms ignored -> still " + d.bpm +
      " BPM; status: " + (await page.locator("#tapStatus").innerText()));

  /* 7 — practice tones: hook counters prove oscillator create/stop; exclusivity */
  await page.click('#tones button[aria-label^="A4"]');
  d = await dbg(page);
  expect(d.toneStarts === 1 && d.activeToneFreq === 440, "A4 tone started at 440 Hz");
  expect(await page.locator('#tones button[aria-pressed="true"]').count() === 1, "one tone pressed");
  await page.click('#tones button[aria-label^="E4"]');
  d = await dbg(page);
  expect(d.toneStarts === 2 && d.toneStops === 1, "switching tones stops the previous oscillator");
  expect(Math.abs(d.activeToneFreq - 329.63) < 0.01, `E4 = 329.63 Hz (got ${d.activeToneFreq})`);
  expect(await page.locator('#tones button[aria-pressed="true"]').count() === 1, "still exactly one pressed");
  log(`tones: A4 start (440 Hz) then E4 (${d.activeToneFreq.toFixed(2)} Hz); ` +
      `starts=${d.toneStarts} stops=${d.toneStops}, exactly one aria-pressed`);
  await page.click('#tones button[aria-label^="E4"]');   // toggle same tone off
  d = await dbg(page);
  expect(d.toneStops === 2 && d.activeToneFreq === null, "toggling the active tone stops it");
  await page.click('#tones button[aria-label^="A4"]');
  await page.click("#stopTones");
  d = await dbg(page);
  expect(d.toneStops === 3 && d.activeToneFreq === null, "stop-all silences the tone");
  expect(await page.locator('#tones button[aria-pressed="true"]').count() === 0, "no tone pressed after stop-all");
  log(`tones: toggle-off ok, stop-all ok (starts=${d.toneStarts} stops=${d.toneStops})`);

  /* octave shift updates labels/frequencies */
  await page.click("#octUp");
  log("octave up: center label now '" + (await page.locator("#octLabel").innerText()) + "'");
  expect((await page.locator("#octLabel").innerText()).includes("A5 = 880.0 Hz"), "octave up -> A5 = 880 Hz");
  await page.click("#octDown"); await page.click("#octDown");
  expect((await page.locator("#octLabel").innerText()).includes("A3 = 220.0 Hz"), "octave down x2 -> A3 = 220 Hz");
  log("octave down x2: center label '" + (await page.locator("#octLabel").innerText()) + "'");
  await page.click("#octUp");   // back to A4

  /* 8 — persistence round-trip: set values, reload, assert restored */
  await page.locator("#bpmSlider").fill("144");
  await page.click('#meterPick button[data-m="3/4"]');
  await page.locator("#vol").fill("40");
  const stored = await page.evaluate(() => localStorage.getItem("suite.metronome.v1"));
  expect(!!stored, "suite.metronome.v1 written");
  log("stored suite.metronome.v1: " + stored);
  await page.reload();
  await page.waitForTimeout(300);
  expect(await page.inputValue("#bpmNum") === "144", "bpm restored after reload");
  expect(await page.locator('#meterPick button[data-m="3/4"]').getAttribute("aria-pressed") === "true",
    "meter restored after reload");
  expect(await page.inputValue("#vol") === "40", "volume restored after reload");
  expect(await page.locator(".dot").count() === 3, "3/4 dots restored");
  log("persistence round-trip: reload restored bpm=144, meter=3/4, volume=40");

  /* 9 — mobile: 390px wide, no horizontal overflow */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const ov = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(ov.sw <= ov.cw, `no horizontal overflow at 390px (scrollWidth ${ov.sw} vs ${ov.cw})`);
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  log(`mobile 390px: scrollWidth ${ov.sw} <= clientWidth ${ov.cw}, screenshot mobile.png`);
  await page.setViewportSize({ width: 1280, height: 900 });

  /* leave the metronome running so the after-interaction shot shows a lit dot */
  await page.click("#startBtn");
  await page.waitForTimeout(400);
  d = await dbg(page);
  log(`final state: running=${d.running} bpm=${d.bpm} beatsPerBar=${d.beatsPerBar} beatCount=${d.beatCount}`);
}
