/* ChromaLink built-page browser gate: the self-contained dist/chromalink.html
   must boot from file:// under its generated CSP with zero errors, run the
   RaptorQ wasm, stream sender frames on an exact-white canvas, honor
   ?mode=, surface the exact camera-permission message when denied, and run
   the camera->worker receive loop against a fake camera device.
   Run: node tests/chromalink-built.mjs */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const URL = pathToFileURL(join(ROOT, "dist", "chromalink.html")).href;
const EVIDENCE = join(ROOT, "tests", "evidence", "chromalink");
mkdirSync(EVIDENCE, { recursive: true });

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
};

/* ---------------- built bundle carries the exact status contract strings ---------------- */
{
  const html = readFileSync(join(ROOT, "dist", "chromalink.html"), "utf8");
  check("built page carries the exact search status string",
    html.includes("Searching for code…"));
  check("built page carries the exact first-mismatch corruption string",
    html.includes("Transfer corrupted — restarting collection"));
  check("built page carries the unlocked-mismatch fresh-sync string",
    html.includes("Transfer corrupted — restarting collection. Listening for a fresh transfer."));
  check("built page carries the exact camera-permission string",
    html.includes("Camera permission required"));
}

const launch = async (extraArgs = []) => {
  const options = { args: extraArgs };
  try { return await chromium.launch({ channel: "chrome", ...options }); }
  catch (error) {
    if (!String(error).includes("distribution 'chrome' is not found")) throw error;
    return await chromium.launch(options);
  }
};

const instrument = async (context) => {
  let escaped = 0;
  await context.route(/^https?:/, route => { escaped++; route.abort(); });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(`page: ${String(error)}`));
  page.on("console", message => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", event =>
      window.__csp.push(`${event.violatedDirective}:${event.blockedURI}`));
  });
  return { page, errors, escapedCount: () => escaped };
};

/* ---------------- desktop: chooser, theme, sender stream ---------------- */
{
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, errors, escapedCount } = await instrument(context);
  await page.goto(URL);
  await page.waitForTimeout(300);

  check("chooser shows the two full-width mode buttons",
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll(".cl-mode-btn")].map(b => b.textContent);
      return buttons.length === 2 && buttons.includes("Send") && buttons.includes("Receive");
    }));

  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme || "unset");
  await page.click("#themeBtn");
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme || "unset");
  check("suite theme toggle flips", themeBefore !== themeAfter, `${themeBefore} -> ${themeAfter}`);
  await page.click("#themeBtn");
  await page.screenshot({ path: join(EVIDENCE, "built-desktop-chooser.png") });

  // Send flow: fountain wasm init under CSP, then a real streaming session.
  await page.click(".cl-mode-btn:has-text('Send')");
  await page.waitForSelector(".cl-sender", { timeout: 15000 });
  check("sender mounts after fountain init (wasm under CSP)", true);

  const payload = Buffer.alloc(200000);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 7) & 0xff;
  await page.setInputFiles("input[type=file]", {
    name: "gate-sample.bin", mimeType: "application/octet-stream", buffer: payload,
  });
  await page.click("button:has-text('Start')");
  await page.waitForSelector(".cl-stage canvas", { timeout: 20000 });

  const hintOk = await page.evaluate(() =>
    [...document.querySelectorAll(".cl-stage-meta")].some(el =>
      el.textContent === "Prop both phones against something for best speed. Set screen brightness to max."));
  check("stream shows the exact propping/brightness hint", hintOk);

  const frameA = await page.evaluate(() => {
    const counter = [...document.querySelectorAll(".cl-stage-meta span")][0];
    return counter ? counter.textContent : null;
  });
  await page.waitForTimeout(700);
  const frameB = await page.evaluate(() => {
    const counter = [...document.querySelectorAll(".cl-stage-meta span")][0];
    return counter ? counter.textContent : null;
  });
  check("frame counter advances while streaming", frameA !== null && frameB !== null && frameA !== frameB,
    `${frameA} -> ${frameB}`);

  const canvasInfo = await page.evaluate(() => {
    const canvas = document.querySelector(".cl-stage canvas");
    const ctx = canvas.getContext("2d");
    const corner = ctx.getImageData(0, 0, 1, 1).data;
    // sample a band through the data region — the top rows are quiet zone
    const bandY = Math.floor(canvas.height / 2);
    const before = ctx.getImageData(0, bandY, canvas.width, 4).data.join(",");
    return new Promise(resolveInner => setTimeout(() => {
      const after = ctx.getImageData(0, bandY, canvas.width, 4).data.join(",");
      resolveInner({
        quietWhite: corner[0] === 255 && corner[1] === 255 && corner[2] === 255,
        integer: canvas.width % 1 === 0 && canvas.width === canvas.height,
        changed: before !== after,
      });
    }, 400));
  });
  check("quiet zone renders exact white", canvasInfo.quietWhite);
  check("canvas is square with integer device pixels", canvasInfo.integer);
  check("frames actually change on the canvas", canvasInfo.changed);

  const controlsLocked = await page.evaluate(() =>
    [...document.querySelectorAll("select")].every(sel => sel.disabled));
  check("grid/fps selects are locked while streaming", controlsLocked);
  await page.screenshot({ path: join(EVIDENCE, "built-desktop-sender-stream.png") });

  await page.click(".cl-stage button:has-text('Stop')");
  await page.waitForTimeout(200);
  check("stop tears the stage down", await page.evaluate(() => !document.querySelector(".cl-stage")));
  check("selects unlock after stop", await page.evaluate(() =>
    [...document.querySelectorAll("select")].every(sel => !sel.disabled)));

  check("desktop run made no HTTP(S) request", escapedCount() === 0, String(escapedCount()));
  check("desktop run had no console/page errors", errors.length === 0, errors.join(" | "));
  const csp = await page.evaluate(() => window.__csp);
  check("desktop run had no CSP violations", csp.length === 0, csp.join(" | "));
  await browser.close();
}

/* ---------------- receive: denied camera surfaces the exact message ---------------- */
{
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, errors } = await instrument(context);
  // deterministic denial stub (headless denial surfaces as NotSupported/
  // NotFound depending on device presence, so stub the permission path)
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await page.goto(`${URL}?mode=receive`);
  await page.waitForSelector(".cl-receive-stage", { timeout: 15000 });
  await page.waitForFunction(() =>
    document.querySelector(".cl-overlay-status")?.textContent !== "Starting camera…", null, { timeout: 15000 });
  const overlay = await page.evaluate(() => document.querySelector(".cl-overlay-status")?.textContent);
  check("denied camera shows the exact permission message", overlay === "Camera permission required", overlay);
  check("denied camera offers a retry control",
    await page.evaluate(() => {
      const btn = document.querySelector(".cl-btn-primary");
      return !!btn && !btn.hidden && btn.textContent === "Retry camera";
    }));
  const fatal = errors.filter(e => !e.includes("NotAllowedError"));
  check("denied-camera path has no unexpected errors", fatal.length === 0, fatal.join(" | "));
  await browser.close();
}

/* ---------------- receive: fake camera drives the worker loop ---------------- */
const SEARCHING = "Searching for code…";
const guideGeometry = (page) => page.evaluate(() => {
  const guide = document.querySelector(".cl-guide");
  const stage = document.querySelector(".cl-receive-stage");
  if (!guide || !stage) return null;
  const gr = guide.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  return {
    w: gr.width, h: gr.height,
    gcx: gr.left + gr.width / 2, gcy: gr.top + gr.height / 2,
    scx: sr.left + sr.width / 2, scy: sr.top + sr.height / 2,
    vmin: Math.min(window.innerWidth, window.innerHeight),
  };
});
const checkGuide = (label, g) => {
  check(`${label}: overlay guide exists`, g !== null);
  if (g === null) return;
  check(`${label}: guide is square`, Math.abs(g.w - g.h) <= 1, JSON.stringify(g));
  check(`${label}: guide side is 70% of the shorter viewport edge`,
    Math.abs(g.w - 0.7 * g.vmin) <= 1.5, `side ${g.w}, 70vmin ${0.7 * g.vmin}`);
  check(`${label}: guide is centered on the camera stage`,
    Math.abs(g.gcx - g.scx) <= 1 && Math.abs(g.gcy - g.scy) <= 1, JSON.stringify(g));
};
{
  const browser = await launch([
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ]);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.grantPermissions(["camera"]);
  const { page, errors } = await instrument(context);
  await page.addInitScript(() => {
    window.__gumCalls = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => {
      window.__gumCalls += 1;
      return original(...args);
    };
  });
  await page.goto(`${URL}?mode=receive`);
  await page.waitForSelector(".cl-receive-stage video", { timeout: 15000 });
  await page.waitForFunction(() =>
    document.querySelector(".cl-overlay-status")?.textContent === "Searching for code…",
  null, { timeout: 20000 });
  check("fake camera reaches the worker-driven search state", true);
  await page.waitForTimeout(1300); // > 1 s with no finder in sight
  const overlay = await page.evaluate(() => document.querySelector(".cl-overlay-status")?.textContent);
  check("no-finder scene shows the exact search status after 1 s",
    overlay === SEARCHING, JSON.stringify(overlay));

  checkGuide("desktop receive", await guideGeometry(page));

  // Repeated Reset must reuse the open camera (never a second getUserMedia)
  // and the respawned/reset worker must keep the loop alive.
  const gumBefore = await page.evaluate(() => window.__gumCalls);
  for (let i = 0; i < 3; i++) await page.click("button:has-text('Reset receiver')");
  await page.waitForTimeout(900);
  const gumAfter = await page.evaluate(() => window.__gumCalls);
  check("repeated Reset never opens a concurrent camera",
    gumBefore === 1 && gumAfter === 1, `${gumBefore} -> ${gumAfter}`);
  const afterReset = await page.evaluate(() => document.querySelector(".cl-overlay-status")?.textContent);
  check("receive loop keeps running after repeated Reset",
    afterReset === SEARCHING, JSON.stringify(afterReset));

  check("fake-camera run had no console/page errors", errors.length === 0, errors.join(" | "));
  const csp = await page.evaluate(() => window.__csp);
  check("worker + camera run under CSP with no violations", csp.length === 0, csp.join(" | "));
  await page.screenshot({ path: join(EVIDENCE, "built-desktop-receiver-searching.png") });
  await browser.close();
}

/* ---------------- receive: lifecycle races (retry storm, pagehide) ---------------- */
{
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, errors } = await instrument(context);
  await page.addInitScript(() => {
    window.__gumCalls = 0;
    navigator.mediaDevices.getUserMedia = () => {
      window.__gumCalls += 1;
      return new Promise((_, reject) => setTimeout(
        () => reject(new DOMException("Permission denied", "NotAllowedError")), 400));
    };
  });
  await page.goto(`${URL}?mode=receive`);
  await page.waitForFunction(() =>
    document.querySelector(".cl-overlay-status")?.textContent === "Camera permission required",
  null, { timeout: 15000 });
  // hammer Retry while its getUserMedia is still in flight
  await page.click(".cl-btn-primary");
  await page.click(".cl-btn-primary", { force: true }).catch(() => {});
  await page.click(".cl-btn-primary", { force: true }).catch(() => {});
  await page.waitForTimeout(150);
  const gumDuring = await page.evaluate(() => window.__gumCalls);
  check("a Retry storm opens at most one camera request at a time",
    gumDuring === 2, `getUserMedia calls: ${gumDuring}`);
  const fatal = errors.filter(e => !e.includes("NotAllowedError"));
  check("retry-storm run has no unexpected errors", fatal.length === 0, fatal.join(" | "));
  await browser.close();
}
{
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, errors } = await instrument(context);
  await page.addInitScript(() => {
    window.__tracks = [];
    window.__resolveGum = null;
    navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => {
      window.__resolveGum = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320; canvas.height = 240;
        canvas.getContext("2d").fillRect(0, 0, 320, 240);
        const stream = canvas.captureStream(10);
        window.__tracks.push(...stream.getTracks());
        resolve(stream);
      };
    });
  });
  await page.goto(`${URL}?mode=receive`);
  await page.waitForFunction(() => window.__resolveGum !== null, null, { timeout: 15000 });
  // pagehide lands while getUserMedia is still pending…
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  // …then the camera resolves late: the track must be stopped, not leaked
  await page.evaluate(() => window.__resolveGum());
  await page.waitForTimeout(250);
  const trackStates = await page.evaluate(() => window.__tracks.map(t => t.readyState));
  check("getUserMedia resolving after pagehide stops the track (no leak)",
    trackStates.length > 0 && trackStates.every(s => s === "ended"), trackStates.join(","));
  check("pagehide race run had no console/page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
}

/* ---------------- sender: lifecycle races (wake lock, stage failure) ---------------- */
{
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, errors } = await instrument(context);
  await page.addInitScript(() => {
    window.__wakeLockReleases = 0;
    window.__resolveWakeLock = null;
    const sentinel = {
      released: false,
      type: "screen",
      release: () => { window.__wakeLockReleases += 1; return Promise.resolve(); },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: () => new Promise((resolve) => { window.__resolveWakeLock = () => resolve(sentinel); }) },
    });
  });
  await page.goto(`${URL}?mode=send`);
  await page.waitForSelector(".cl-sender", { timeout: 15000 });
  await page.setInputFiles("input[type=file]", {
    name: "race.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(4096, 7),
  });
  await page.click("button:has-text('Start')");
  await page.waitForSelector(".cl-stage canvas", { timeout: 20000 });
  await page.click(".cl-stage button:has-text('Stop')");
  await page.waitForTimeout(100);
  // the wake lock request resolves only after Stop tore the stream down
  await page.evaluate(() => window.__resolveWakeLock && window.__resolveWakeLock());
  await page.waitForTimeout(150);
  const releases = await page.evaluate(() => window.__wakeLockReleases);
  check("wake lock granted after Stop is released, not attached to stale state",
    releases >= 1, `releases: ${releases}`);
  check("wake-lock race run had no console/page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
}
{
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, errors } = await instrument(context);
  await page.goto(`${URL}?mode=send`);
  await page.waitForSelector(".cl-sender", { timeout: 15000 });
  await page.setInputFiles("input[type=file]", {
    name: "boom.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(4096, 9),
  });
  // arm a renderer failure that fires after the full-white stage is appended
  await page.evaluate(() => {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      get() { throw new Error("synthetic renderer failure"); },
    });
  });
  await page.click("button:has-text('Start')");
  await page.waitForTimeout(400);
  check("a failure after the stage is appended removes the stage",
    await page.evaluate(() => !document.querySelector(".cl-stage")));
  check("controls unlock after the failed start", await page.evaluate(() =>
    [...document.querySelectorAll("select")].every(sel => !sel.disabled)));
  const statusText = await page.evaluate(() => document.querySelector(".cl-status")?.textContent);
  check("the failed start reports a visible error status",
    statusText === "Could not start the transfer. See the console for details.", JSON.stringify(statusText));
  const unexpected = errors.filter(e => !e.includes("synthetic renderer failure") && !e.includes("sender start failed"));
  check("stage-failure run has no unexpected errors", unexpected.length === 0, unexpected.join(" | "));
  await browser.close();
}

/* ---------------- sender: Start-button validity across async start ---------------- */
{
  // Start must go dark while a stream is active (a second click used to be
  // able to start an overlapping stream) and re-arm after Stop.
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, errors } = await instrument(context);
  const startState = () => page.evaluate(() =>
    [...document.querySelectorAll(".cl-sender button")]
      .find(b => b.textContent === "Start")?.disabled);
  await page.goto(`${URL}?mode=send`);
  await page.waitForSelector(".cl-sender", { timeout: 15000 });
  await page.setInputFiles("input[type=file]", {
    name: "valid.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(4096, 3),
  });
  check("Start arms for a valid selection", (await startState()) === false);
  await page.click("button:has-text('Start')");
  await page.waitForSelector(".cl-stage canvas", { timeout: 20000 });
  check("Start is disabled while a stream is active", (await startState()) === true);
  await page.click(".cl-stage button:has-text('Stop')");
  await page.waitForTimeout(150);
  check("Start re-arms after Stop with the valid file still selected",
    (await startState()) === false);
  check("start-validity run had no console/page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
}
{
  // A file whose start-time read comes back empty (changed on disk after
  // selection) must leave Start disabled until a new file is selected.
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, errors } = await instrument(context);
  await page.addInitScript(() => {
    window.__emptyReads = 0;
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (window.__emptyReads === 0) {
        window.__emptyReads += 1;
        return Promise.resolve(new ArrayBuffer(0));
      }
      return original.call(this);
    };
  });
  const startState = () => page.evaluate(() =>
    [...document.querySelectorAll(".cl-sender button")]
      .find(b => b.textContent === "Start")?.disabled);
  await page.goto(`${URL}?mode=send`);
  await page.waitForSelector(".cl-sender", { timeout: 15000 });
  await page.setInputFiles("input[type=file]", {
    name: "shrunk.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(4096, 5),
  });
  await page.click("button:has-text('Start')");
  await page.waitForFunction(() =>
    document.querySelector(".cl-status")?.textContent ===
      "That file is empty — choose a non-empty file.", null, { timeout: 15000 });
  check("empty start-time read keeps Start disabled for that selection",
    (await startState()) === true);
  await page.setInputFiles("input[type=file]", {
    name: "fresh.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(4096, 6),
  });
  await page.waitForTimeout(100);
  check("a newly selected file re-arms Start after the failed read",
    (await startState()) === false);
  await page.click("button:has-text('Start')");
  await page.waitForSelector(".cl-stage canvas", { timeout: 20000 });
  check("the fresh selection streams normally after the failed read", true);
  await page.click(".cl-stage button:has-text('Stop')");
  check("empty-read run had no console/page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
}

/* ---------------- mobile layout smoke ---------------- */
{
  const browser = await launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 10 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36",
  });
  const { page, errors } = await instrument(context);
  await page.goto(URL);
  await page.waitForSelector(".cl-mode-btn", { timeout: 15000 });
  const layout = await page.evaluate(() => {
    const btn = document.querySelector(".cl-mode-btn");
    const wrap = document.querySelector(".cl-chooser");
    return {
      buttonWidth: btn.getBoundingClientRect().width,
      wrapWidth: wrap.getBoundingClientRect().width,
      noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  });
  check("mobile chooser buttons fill their column", layout.buttonWidth >= layout.wrapWidth - 2,
    JSON.stringify(layout));
  check("mobile page has no horizontal scroll", layout.noHorizontalScroll);
  check("mobile boot had no console/page errors", errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: join(EVIDENCE, "built-mobile-chooser.png") });
  await browser.close();
}

/* ---------------- mobile receive: guide + exact search status ---------------- */
{
  const browser = await launch([
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ]);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 10 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36",
  });
  await context.grantPermissions(["camera"]);
  const { page, errors } = await instrument(context);
  await page.goto(`${URL}?mode=receive`);
  await page.waitForSelector(".cl-receive-stage video", { timeout: 15000 });
  await page.waitForFunction(() =>
    document.querySelector(".cl-overlay-status")?.textContent === "Searching for code…",
  null, { timeout: 20000 });
  await page.waitForTimeout(1300);
  const overlay = await page.evaluate(() => document.querySelector(".cl-overlay-status")?.textContent);
  check("mobile no-finder scene shows the exact search status after 1 s",
    overlay === SEARCHING, JSON.stringify(overlay));
  checkGuide("mobile receive", await guideGeometry(page));
  check("mobile receive run had no console/page errors", errors.length === 0, errors.join(" | "));
  await page.evaluate(() =>
    document.querySelector(".cl-receive-stage")?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(EVIDENCE, "built-mobile-receiver-guide.png") });
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall ChromaLink built-page checks passed");
