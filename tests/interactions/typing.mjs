/* Typing Speed Trainer: deterministic timing, accuracy/WPM, passage completion,
   duration controls, persistence/history bounds, keyboard restart, a11y, and mobile. */
export const selectors = [
  "body", ".wrap", "header h1", ".theme-btn", ".card", "#durations",
  ".metrics", "#prompt", "#typingInput", "#history", "footer"
];
export const screenshotAfterInteract = true;

function expect(value, message) {
  if (!value) throw new Error("EXPECT FAILED: " + message);
}

export async function interact({page, log}) {
  const passage = await page.evaluate(() => window.__typing.passage);
  expect(passage.length > 100, "embedded passage is substantial");
  expect(await page.locator("#prompt span").count() === passage.length, "one safe span per passage character");
  expect(await page.getAttribute("#typingStatus", "aria-live") === "polite", "result status is a live region");
  log(`initial passage: ${passage.length} characters; safe character spans=${await page.locator("#prompt span").count()}`);

  await page.evaluate(() => { window.__typing.elapsedOverride = 1000; });
  await page.fill("#typingInput", passage.slice(0, 24));
  await page.evaluate(() => window.__typing.setElapsed(61000));
  await page.waitForTimeout(50);
  let result = await page.locator("#typingStatus").innerText();
  expect(result.includes("Complete") && result.includes("100% accuracy"), "timed result completes with exact accuracy");
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("suite.typing.stats")));
  expect(saved.length === 1 && saved[0].accuracy === 100 && saved[0].chars === 24, "completed result persisted");
  expect(await page.locator("#typingInput").isDisabled(), "input disabled after completion");
  log(`timed completion: ${result}; persisted chars=${saved[0].chars}`);

  await page.click("#restart");
  const sample = passage.slice(0, 12);
  const wrong = "X" + sample.slice(1);
  await page.evaluate(() => { window.__typing.elapsedOverride = 2000; });
  await page.fill("#typingInput", wrong);
  await page.evaluate(() => window.__typing.setElapsed(33000));
  result = await page.locator("#typingStatus").innerText();
  const metrics = await page.evaluate(() => window.__typing.metrics);
  expect(Math.round(metrics.accuracy) === 92, `one error in 12 chars is 92% (got ${metrics.accuracy})`);
  expect(await page.locator("#prompt .wrong").count() === 1, "wrong character is visibly marked");
  expect(await page.locator("#history li").count() === 2, "second result added to history");
  log(`error accounting: ${result}; wrong spans=1; accuracy=${metrics.accuracy.toFixed(1)}%`);

  await page.click('#durations button[data-seconds="15"]');
  expect(await page.getAttribute('#durations button[data-seconds="15"]', "aria-pressed") === "true", "15-second control pressed");
  expect(await page.getAttribute('#durations button[data-seconds="30"]', "aria-pressed") === "false", "only one duration pressed");
  expect(await page.locator("#time").innerText() === "15", "duration change resets clock");
  await page.fill("#typingInput", "abc");
  await page.press("#typingInput", "Control+Enter");
  expect(await page.inputValue("#typingInput") === "", "Ctrl+Enter restarts");
  expect((await page.locator("#typingStatus").innerText()).startsWith("Ready"), "keyboard restart restores ready status");
  log("duration controls: 15 seconds selected with native pressed state; Ctrl+Enter restart works");

  const before = await page.evaluate(() => window.__typing.passage);
  await page.click("#newPassage");
  const after = await page.evaluate(() => window.__typing.passage);
  expect(after !== before, "new passage changes prompt");
  expect(await page.locator("#prompt span").count() === after.length, "new passage rendered safely");
  log(`new passage: ${before.length} -> ${after.length} characters`);

  await page.evaluate(() => {
    const rows = Array.from({length: 25}, (_, i) => ({
      at: Date.now() - i * 1000, wpm: 20 + i, accuracy: 90, duration: 15, chars: 50
    }));
    localStorage.setItem("suite.typing.stats", JSON.stringify(rows));
  });
  await page.reload();
  expect(await page.locator("#history li").count() === 20, "history display is bounded at 20");
  expect((await page.locator("#best").innerText()).includes("39 WPM"), "best score derives from retained rows");
  await page.click("#clearHistory");
  expect(await page.evaluate(() => localStorage.getItem("suite.typing.stats")) === null, "clear removes storage key");
  expect((await page.locator("#history").innerText()).includes("Completed tests"), "designed empty state");
  log("history: malformed/excess-safe bounded display=20; best score visible; clear removes suite.typing.stats");

  await page.setViewportSize({width: 390, height: 844});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(!overflow, "390px layout has no horizontal overflow");
  log(`mobile 390px horizontal overflow: ${overflow}`);
}
