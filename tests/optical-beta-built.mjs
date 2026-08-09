/* Optical Transfer Beta deterministic and browser integration gate.
   Run: node tests/optical-beta-built.mjs */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const URL = pathToFileURL(join(ROOT, "dist", "optical-beta.html")).href;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
};
let browser;
try { browser = await chromium.launch({ channel: "chrome" }); }
catch (error) {
  if (!String(error).includes("distribution 'chrome' is not found")) throw error;
  browser = await chromium.launch();
}

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
let escaped = 0;
await context.route(/^https?:/, route => { escaped++; route.abort(); });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(`page: ${String(error)}`));
page.on("console", message => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", event => window.__csp.push(`${event.violatedDirective}:${event.blockedURI}`));
});
await page.goto(URL);
await page.waitForTimeout(250);
check("built page exposes the deterministic protocol API", await page.evaluate(() => !!window.OpticalTransferTest));
check("page load makes no HTTP(S) request", escaped === 0, String(escaped));
check("page boot has no console/page errors", errors.length === 0, errors.join(" | "));
check("page boot has no CSP violations", (await page.evaluate(() => window.__csp)).length === 0, (await page.evaluate(() => window.__csp)).join(" | "));
const cameraFpsControl = page.locator("#captureFps");
const cameraFpsOptions = await cameraFpsControl.locator("option").allTextContents();
check("Receive offers high-frame-rate camera requests through 120 FPS",
  JSON.stringify(cameraFpsOptions) === JSON.stringify(["30", "60", "90", "120"]), JSON.stringify(cameraFpsOptions));
check("Receive keeps 30 FPS as the compatibility-safe default", await cameraFpsControl.inputValue() === "30");

const vectors = await page.evaluate(() => {
  const T = window.OpticalTransferTest;
  const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join(" ");
  const frame = T.packFrame({ sessionId: 0xbeef, seq: 0x01020304, k: 0x0111, blockLen: 6, totalLen: 0x666, payloadFnv: 0x89abcdef }, new Uint8Array([1, 2, 3, 4, 5, 6]));
  const cdfDigests = {};
  for (const k of [1, 2, 17, 179, 716]) {
    const cdf = T.solitonCdf(k);
    cdfDigests[k] = `0x${T.fnv1a(new Uint8Array(cdf.buffer)).toString(16).padStart(8, "0")}`;
  }
  return {
    header: hex(frame),
    parsed: T.parseFrame(frame)?.header,
    dlog: [1, 1.5, 2, 10, 2000].map(value => T.dlog(value)),
    indices: [0, 1, 2, 41, 1000].map(seq => T.frameIndices(179, T.solitonCdf(179), 4242, seq)),
    cdfDigests,
  };
});
check("20-byte little-endian frame golden vector",
  vectors.header === "d1 0c ef be 04 03 02 01 11 01 06 00 66 06 00 00 ef cd ab 89 01 02 03 04 05 06", vectors.header);
check("frame golden vector parses exactly", JSON.stringify(vectors.parsed) === JSON.stringify({ sessionId: 0xbeef, seq: 0x01020304, k: 0x0111, blockLen: 6, totalLen: 0x666, payloadFnv: 0x89abcdef }), JSON.stringify(vectors.parsed));
check("deterministic log golden vector", JSON.stringify(vectors.dlog) === JSON.stringify([0, 0.4054651081081644, 0.6931471805599453, 2.3025850929940455, 7.600902459542082]), JSON.stringify(vectors.dlog));
check("robust-soliton CDF fingerprints", JSON.stringify(vectors.cdfDigests) === JSON.stringify({ 1: "0x8c6a9878", 2: "0x2417b297", 17: "0x2ba41e3c", 179: "0xe8b6340a", 716: "0x28d31438" }), JSON.stringify(vectors.cdfDigests));
check("fountain block-subset golden vector", JSON.stringify(vectors.indices) === JSON.stringify([[27,39],[30,55],[155,125],[28,132,88],[39,75,24]]), JSON.stringify(vectors.indices));

const recovery = await page.evaluate(() => {
  const T = window.OpticalTransferTest;
  const makePayload = length => { const value = new Uint8Array(length); for (let i = 0; i < length; i++) value[i] = (i * 37 + (i >> 8) * 11) & 255; return value; };
  const same = (a, b) => a && a.length === b.length && a.every((value, index) => value === b[index]);
  const payload = makePayload(100_000), blockLen = 1445, session = 77;
  const encoder = new T.LTEncoder(payload, blockLen, session);

  const dropped = new T.LTDecoder(encoder.k, blockLen, session, payload.length);
  const randomDrop = T.splitmix32(23);
  let seq = 0;
  while (!dropped.isComplete && seq < encoder.k * 20) {
    const block = encoder.encode(seq);
    if (randomDrop() * 2 ** -32 >= .3) { dropped.addFrame(seq, block); dropped.addFrame(seq, block); }
    seq++;
  }

  const shuffled = [];
  for (let i = 0; i < Math.ceil(encoder.k * 3); i++) shuffled.push([i, encoder.encode(i)]);
  const randomShuffle = T.splitmix32(5);
  for (let i = shuffled.length - 1; i > 0; i--) { const j = randomShuffle() % (i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const outOfOrder = new T.LTDecoder(encoder.k, blockLen, session, payload.length);
  for (const [frameSeq, block] of shuffled) { outOfOrder.addFrame(frameSeq, block); if (outOfOrder.isComplete) break; }
  return {
    droppedComplete: dropped.isComplete,
    droppedExact: same(dropped.assemble(), payload),
    duplicates: dropped.framesDup,
    outOfOrderComplete: outOfOrder.isComplete,
    outOfOrderExact: same(outOfOrder.assemble(), payload),
  };
});
check("30% dropped frames recover exactly", recovery.droppedComplete && recovery.droppedExact, JSON.stringify(recovery));
check("duplicate frames are ignored without corruption", recovery.duplicates > 0 && recovery.droppedExact, JSON.stringify(recovery));
check("shuffled/out-of-order frames recover exactly", recovery.outOfOrderComplete && recovery.outOfOrderExact, JSON.stringify(recovery));

const security = await page.evaluate(async () => {
  const T = window.OpticalTransferTest;
  const source = new TextEncoder().encode("optical transfer security\n".repeat(1000));
  const packed = await T.packFile("../../CON.txt. ", "text/plain", source);
  const unpacked = await T.unpackFile(packed.container);
  unpacked.bytes[0] ^= 0xff;
  const hashMismatch = !(await T.verifyFile(unpacked));

  const goodFrame = T.packFrame({ sessionId: 1, seq: 2, k: 3, blockLen: 4, totalLen: 10, payloadFnv: 0 }, new Uint8Array([9, 9, 9, 9]));
  const malformed = [];
  const wrongMagic = goodFrame.slice(); wrongMagic[0] = 0;
  const zeroK = goodFrame.slice(); new DataView(zeroK.buffer).setUint16(8, 0, true);
  const inconsistentK = goodFrame.slice(); new DataView(inconsistentK.buffer).setUint16(8, 2, true);
  const oversized = goodFrame.slice(); new DataView(oversized.buffer).setUint32(12, T.MAX_CONTAINER_BYTES + 1, true);
  for (const value of [wrongMagic, zeroK, inconsistentK, oversized, goodFrame.slice(0, -1)]) malformed.push(T.parseFrame(value) === null);

  const badMagic = packed.container.slice(); badMagic[0] = 0;
  let badContainer = false;
  try { await T.unpackFile(badMagic); } catch { badContainer = true; }
  const badLength = packed.container.slice(); new DataView(badLength.buffer).setUint32(13, packed.transmittedSize + 1, true);
  let lengthRejected = false;
  try { await T.unpackFile(badLength); } catch { lengthRejected = true; }

  const bombSource = new TextEncoder().encode("gzip ceiling\n".repeat(2000));
  const compressed = await T.gzipBytes(bombSource);
  let bombRejected = false;
  try { await T.gunzipLimited(compressed, 128); } catch (error) { bombRejected = /expands past/.test(String(error)); }

  const bounded = new T.LTDecoder(100, 4, 9, 400);
  bounded.maxFrames = 2;
  bounded.addFrame(0, new Uint8Array(4)); bounded.addFrame(1, new Uint8Array(4));
  let equationCeiling = false;
  try { bounded.addFrame(2, new Uint8Array(4)); } catch (error) { equationCeiling = /memory ceiling/.test(String(error)); }

  const equationBudget = [1445, 2933].every(blockLen => {
    const k = Math.ceil(T.MAX_CONTAINER_BYTES / blockLen);
    const decoder = new T.LTDecoder(k, blockLen, 10, T.MAX_CONTAINER_BYTES);
    return decoder.maxFrames * Math.ceil(blockLen / 4) * 4 <= T.MAX_PENDING_EQUATION_BYTES;
  });

  return {
    hashMismatch, malformed, badContainer, lengthRejected, bombRejected, equationCeiling, equationBudget,
    names: ["../../etc/passwd", "C:\\Windows\\CON", "\u202Egpj.exe", "report?.txt", "..", "NUL.txt"].map(T.safeFileName),
  };
});
check("changed payload fails SHA-256", security.hashMismatch);
check("malformed/hostile frame headers are rejected before allocation", security.malformed.every(Boolean), JSON.stringify(security.malformed));
check("malformed container magic and lengths are rejected", security.badContainer && security.lengthRejected, JSON.stringify(security));
check("gzip inflation stops at the declared ceiling", security.bombRejected);
check("unsolved unique equations stop at a bounded memory ceiling", security.equationCeiling);
check("maximum-payload equation buffers are bounded to the explicit byte budget", security.equationBudget);
check("received filename sanitization handles paths, bidi, invalid and reserved names",
  JSON.stringify(security.names) === JSON.stringify(["passwd", "_CON", "gpj.exe", "report_.txt", "transfer.bin", "_NUL.txt"]), JSON.stringify(security.names));

const sessions = await page.evaluate(() => {
  const T = window.OpticalTransferTest;
  const make = (sessionId, seq) => {
    const header = { sessionId, seq, k: 2, blockLen: 4, totalLen: 8, payloadFnv: sessionId };
    return { header, block: new Uint8Array(4) };
  };
  const activated = [];
  const receiver = new T.SessionReceiver(header => activated.push(header.sessionId));
  receiver.accept(make(11, 0), 0);
  const firstOther = receiver.accept(make(22, 0), 10);
  const duplicateOther = receiver.accept(make(22, 0), 20);
  const secondOther = receiver.accept(make(22, 1), 30);
  return { activated, firstCandidate: firstOther.candidate, duplicateCandidate: duplicateOther.candidate, replaced: secondOther.replaced, key: receiver.key };
});
check("one stray valid frame cannot replace an active session", sessions.firstCandidate && sessions.duplicateCandidate && sessions.activated.length === 2, JSON.stringify(sessions));
check("two distinct frames replace and isolate the session", sessions.replaced && sessions.key.startsWith("22:"), JSON.stringify(sessions));

await page.locator("#sendFile").setInputFiles({ name: "ui-flow.bin", mimeType: "application/octet-stream", buffer: Buffer.from(Array.from({ length: 4096 }, (_, i) => i & 255)) });
await page.click("#prepareBtn");
await page.waitForFunction(() => !document.getElementById("streamBtn").disabled);
check("UI Send flow packs locally and enables streaming", /prepared/.test(await page.textContent("#sendStatus")));
await page.click("#streamBtn");
await page.waitForFunction(() => /frame [1-9]/.test(document.getElementById("streamMeta").textContent), null, { timeout: 10_000 });
const sendUi = await page.evaluate(() => {
  const rect = sendQr.getBoundingClientRect();
  return { width: sendQr.width, height: sendQr.height, clientWidth: rect.width, clientHeight: rect.height, status: sendStatus.textContent, meta: streamMeta.textContent };
});
check("UI Send flow renders a real animated QR frame", sendUi.width > 100 && sendUi.height === sendUi.width && /Streaming endlessly/.test(sendUi.status), JSON.stringify(sendUi));
check("desktop-composited QR remains exactly square", sendUi.clientWidth === sendUi.clientHeight && sendUi.clientWidth <= 700, JSON.stringify(sendUi));
await page.click("#pauseBtn");
check("animated stream has an explicit pause control", /paused/.test(await page.textContent("#sendStatus")));
const qrRoundTrip = await page.evaluate(() => new Promise(resolve => {
  const url = URL.createObjectURL(new Blob([OPTICAL_WORKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(url);
  const timer = setTimeout(() => { worker.terminate(); URL.revokeObjectURL(url); resolve({ ok: false, reason: "timeout" }); }, 12_000);
  worker.onmessage = event => {
    if (event.data?.id !== 7) return;
    clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url);
    const parsed = event.data.bytes ? window.OpticalTransferTest.parseFrame(new Uint8Array(event.data.bytes)) : null;
    resolve({ ok: !!parsed, blockLen: parsed?.header.blockLen, totalLen: parsed?.header.totalLen });
  };
  worker.onerror = event => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); resolve({ ok: false, reason: event.message }); };
  const image = sendQr.getContext("2d").getImageData(0, 0, sendQr.width, sendQr.height);
  worker.postMessage({ id: 7, buf: image.data.buffer, w: image.width, h: image.height }, [image.data.buffer]);
}));
check("rendered QR decodes through the real ZXing worker to a valid fountain frame", qrRoundTrip.ok && qrRoundTrip.blockLen === 1445 && qrRoundTrip.totalLen > 0, JSON.stringify(qrRoundTrip));

const receiverUi = await page.evaluate(async () => {
  const T = window.OpticalTransferTest;
  T.resetReceiver();
  const source = new TextEncoder().encode("verified receiver path");
  const packed = await T.packFile("verified.txt", "text/plain", source);
  const sessionId = 404, blockLen = 480;
  const encoder = new T.LTEncoder(packed.container, blockLen, sessionId);
  const header = { sessionId, seq: 0, k: encoder.k, blockLen, totalLen: packed.container.length, payloadFnv: T.fnv1a(packed.container) };
  for (let seq = 0; seq < 100 && !document.querySelector("#result a.download"); seq++) {
    T.feedDecodedFrame(T.packFrame({ ...header, seq }, encoder.encode(seq)));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  const verified = { download: !!document.querySelector("#result a.download"), status: document.getElementById("receiveStatus").textContent, progress: document.getElementById("receiveProgress").getAttribute("aria-valuenow"), progressVisible: !document.getElementById("cameraPreview").hidden };

  T.resetReceiver();
  const corrupt = packed.container.slice(); corrupt[corrupt.length - 1] ^= 0xff;
  const badEncoder = new T.LTEncoder(corrupt, blockLen, sessionId + 1);
  const badHeader = { sessionId: sessionId + 1, seq: 0, k: badEncoder.k, blockLen, totalLen: corrupt.length, payloadFnv: T.fnv1a(corrupt) };
  for (let seq = 0; seq < 100 && !/failed|No download/.test(document.getElementById("result").textContent); seq++) {
    T.feedDecodedFrame(T.packFrame({ ...badHeader, seq }, badEncoder.encode(seq)));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  const corruptResult = { download: !!document.querySelector("#result a.download"), text: document.getElementById("result").textContent, progress: document.getElementById("receiveProgress").getAttribute("aria-valuenow") };

  T.resetReceiver();
  const invalidUtf8 = await T.packFile("snippet.txt", "application/vnd.decimen.snippet", new Uint8Array([0xc3, 0x28]));
  const textEncoder = new T.LTEncoder(invalidUtf8.container, blockLen, sessionId + 2);
  const textHeader = { sessionId: sessionId + 2, seq: 0, k: textEncoder.k, blockLen, totalLen: invalidUtf8.container.length, payloadFnv: T.fnv1a(invalidUtf8.container) };
  for (let seq = 0; seq < 100 && !/not valid UTF-8/.test(document.getElementById("receiveStatus").textContent); seq++) {
    T.feedDecodedFrame(T.packFrame({ ...textHeader, seq }, textEncoder.encode(seq)));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  const invalidText = { status: document.getElementById("receiveStatus").textContent, progress: document.getElementById("receiveProgress").getAttribute("aria-valuenow") };

  T.resetReceiver();
  const racePacked = await T.packFile("reset-race.txt", "text/plain", new TextEncoder().encode("verification must not outlive reset"));
  const raceEncoder = new T.LTEncoder(racePacked.container, blockLen, sessionId + 3);
  const raceHeader = { sessionId: sessionId + 3, seq: 0, k: raceEncoder.k, blockLen, totalLen: racePacked.container.length, payloadFnv: T.fnv1a(racePacked.container) };
  for (let seq = 0; seq < 100 && document.getElementById("receiveProgress").getAttribute("aria-valuenow") !== "99"; seq++) {
    T.feedDecodedFrame(T.packFrame({ ...raceHeader, seq }, raceEncoder.encode(seq)));
  }
  T.resetReceiver();
  await new Promise(resolve => setTimeout(resolve, 100));
  const resetRace = { download: !!document.querySelector("#result a.download"), text: document.getElementById("receiveStatus").textContent, progress: document.getElementById("receiveProgress").getAttribute("aria-valuenow") };

  T.resetReceiver();
  document.getElementById("receiveTab").click();
  const modePacked = await T.packFile("mode-race.txt", "text/plain", new TextEncoder().encode("mode switch cancels verification"));
  const modeEncoder = new T.LTEncoder(modePacked.container, blockLen, sessionId + 4);
  const modeHeader = { sessionId: sessionId + 4, seq: 0, k: modeEncoder.k, blockLen, totalLen: modePacked.container.length, payloadFnv: T.fnv1a(modePacked.container) };
  for (let seq = 0; seq < 100 && document.getElementById("receiveProgress").getAttribute("aria-valuenow") !== "99"; seq++) T.feedDecodedFrame(T.packFrame({ ...modeHeader, seq }, modeEncoder.encode(seq)));
  document.getElementById("sendTab").click();
  await new Promise(resolve => setTimeout(resolve, 100));
  const modeRace = { result: document.getElementById("result").textContent, sendVisible: !document.getElementById("sendPanel").hidden };
  return { verified, corruptResult, invalidText, resetRace, modeRace };
});
check("receiver exposes a download only after SHA-256 integrity verification", receiverUi.verified.download && /SHA-256 integrity verified/.test(receiverUi.verified.status) && receiverUi.verified.progress === "100" && receiverUi.verified.progressVisible, JSON.stringify(receiverUi));
check("corrupt recovered bytes create no download or completed progress", !receiverUi.corruptResult.download && /No download was created/.test(receiverUi.corruptResult.text) && receiverUi.corruptResult.progress === "0", JSON.stringify(receiverUi));
check("invalid UTF-8 snippets fail without completed progress", /not valid UTF-8/.test(receiverUi.invalidText.status) && receiverUi.invalidText.progress === "0", JSON.stringify(receiverUi));
check("receiver reset invalidates an in-flight verification", !receiverUi.resetRace.download && /Receiver reset/.test(receiverUi.resetRace.text) && receiverUi.resetRace.progress === "0", JSON.stringify(receiverUi));
check("mode switch invalidates an in-flight verification", receiverUi.modeRace.sendVisible && receiverUi.modeRace.result === "", JSON.stringify(receiverUi));

const workerWarm = await page.evaluate(() => new Promise(resolve => {
  const url = URL.createObjectURL(new Blob([OPTICAL_WORKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(url);
  const timer = setTimeout(() => { worker.terminate(); URL.revokeObjectURL(url); resolve({ ok: false, reason: "timeout" }); }, 12_000);
  worker.onmessage = event => { if (event.data?.id === -1) { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); resolve({ ok: true, sourceBytes: OPTICAL_WORKER_SOURCE.length }); } };
  worker.onerror = event => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); resolve({ ok: false, reason: event.message }); };
}));
check("embedded ZXing worker and data-URI WASM warm under generated CSP", workerWarm.ok && workerWarm.sourceBytes > 1_000_000, JSON.stringify(workerWarm));
check("worker warm-up makes no HTTP(S) request", escaped === 0, String(escaped));

await context.close();

async function capabilityScenario(name, stub, expected) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.addInitScript(stub);
  await p.goto(URL);
  await p.click("#receiveTab");
  await p.click("#cameraBtn");
  await p.waitForTimeout(80);
  const state = await p.evaluate(() => ({ status: document.getElementById("receiveStatus").textContent, disabled: document.getElementById("cameraBtn").disabled, hidden: document.getElementById("cameraBtn").hidden }));
  check(name, expected.test(state.status) && !state.disabled && !state.hidden, JSON.stringify(state));
  await ctx.close();
}
await capabilityScenario("Receive reports unavailable camera / secure-context state", () => { window.__opticalMediaDevices = null; }, /Camera access is unavailable/);
await capabilityScenario("Receive permission denial is explicit and retryable", () => { window.__opticalMediaDevices = { getUserMedia: () => Promise.reject(new DOMException("denied", "NotAllowedError")) }; }, /permission was denied/);

{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(URL);
  await p.locator("#sendPanel details").evaluate(element => { element.open = true; });
  await p.selectOption("#frameBytes", "2953");
  await p.click('input[name="payloadMode"][value="text"]');
  await p.fill("#sendText", "breakpoint geometry and lifecycle");
  await p.click("#prepareBtn");
  await p.waitForFunction(() => !document.getElementById("streamBtn").disabled);
  await p.click("#streamBtn");
  await p.waitForFunction(() => /frame [1-9]/.test(document.getElementById("streamMeta").textContent));
  const before = await p.evaluate(() => {
    const rect = document.getElementById("sendQr").getBoundingClientRect();
    return { width: rect.width, height: rect.height, intrinsic: document.getElementById("sendQr").width, meta: document.getElementById("streamMeta").textContent };
  });
  await p.setViewportSize({ width: 761, height: 900 });
  await p.waitForFunction(previous => document.getElementById("sendQr").width < previous, before.intrinsic);
  const resized = await p.evaluate(() => {
    const qr = document.getElementById("sendQr"), rect = qr.getBoundingClientRect();
    return { width: rect.width, height: rect.height, intrinsic: qr.width };
  });
  await p.click("#receiveTab");
  const stopped = await p.evaluate(() => ({ meta: document.getElementById("streamMeta").textContent, pauseHidden: document.getElementById("pauseBtn").hidden }));
  await p.waitForTimeout(180);
  const after = await p.evaluate(() => ({ meta: document.getElementById("streamMeta").textContent, pauseHidden: document.getElementById("pauseBtn").hidden }));
  check("maximum-density QR remains square through a live resize to the 760/761px breakpoint", before.width === before.height && resized.width === resized.height && resized.intrinsic < before.intrinsic, JSON.stringify({ before, resized }));
  check("switching to Receive invalidates hidden sender work", after.meta === stopped.meta && after.pauseHidden, JSON.stringify({ before, stopped, after }));
  await ctx.close();
}

{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(URL);
  await p.locator("#sendPanel details").evaluate(element => { element.open = true; });
  await p.selectOption("#frameBytes", "2953");
  await p.selectOption("#eccLevel", "M");
  const tuning = await p.evaluate(() => ({ disabled: document.getElementById("prepareBtn").disabled, status: document.getElementById("sendStatus").textContent }));
  check("impossible 2,953-byte ECC M tuning is rejected before streaming", tuning.disabled && /does not fit/.test(tuning.status), JSON.stringify(tuning));
  await ctx.close();
}

{
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(URL);
  await p.click('input[name="payloadMode"][value="text"]');
  await p.fill("#sendText", "reduced motion sender");
  await p.click("#prepareBtn");
  await p.waitForFunction(() => !document.getElementById("streamBtn").disabled);
  await p.click("#streamBtn");
  await p.waitForFunction(() => /frame [1-9]/.test(document.getElementById("streamMeta").textContent));
  await p.waitForTimeout(450);
  const motion = await p.evaluate(() => ({ status: document.getElementById("sendStatus").textContent, frames: Number(document.getElementById("streamMeta").textContent.match(/frame ([\d,]+)/)?.[1].replaceAll(",", "")) }));
  check("reduced-motion preference limits the high-contrast stream to 2 FPS", /2 FPS reduced-motion limit/.test(motion.status) && motion.frames <= 2, JSON.stringify(motion));
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    window.__opticalLifecycle = { created: 0, terminated: 0, stopped: 0, initialRequestedFps: 0, requestedFps: 0 };
    window.__opticalWorkerFactory = () => {
      window.__opticalLifecycle.created++;
      return { onmessage: null, onerror: null, postMessage() {}, terminate() { window.__opticalLifecycle.terminated++; } };
    };
    let changed = false;
    const track = { getSettings: () => changed ? ({ width: 960, height: 720 }) : ({ width: 1280, height: 960, frameRate: 60 }), applyConstraints: constraints => { changed = true; window.__opticalLifecycle.requestedFps = constraints.frameRate.ideal; return Promise.resolve(); }, stop: () => { window.__opticalLifecycle.stopped++; } };
    const stream = new MediaStream();
    stream.getVideoTracks = () => [track];
    stream.getTracks = () => [track];
    window.__opticalMediaDevices = { getUserMedia: constraints => { window.__opticalLifecycle.initialRequestedFps = constraints.video.frameRate.exact; return Promise.resolve(stream); } };
  });
  await p.goto(URL);
  await p.click("#receiveTab");
  await p.selectOption("#captureFps", "90");
  await p.click("#cameraBtn");
  await p.waitForFunction(() => document.getElementById("metricCamera").textContent === "1280×960 @ 60");
  const cappedCameraMode = await p.textContent("#metricCamera");
  await p.selectOption("#captureWidth", "960");
  await p.selectOption("#captureFps", "120");
  await p.waitForFunction(() => document.getElementById("metricCamera").textContent === "960×720 @ FPS unreported");
  const unreportedCameraMode = await p.textContent("#metricCamera");
  await p.click("#stopCameraBtn");
  const lifecycle = await p.evaluate(() => ({ ...window.__opticalLifecycle, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, workers: document.getElementById("metricWorkers").textContent }));
  check("camera mode reports a device-capped FPS instead of the higher request", cappedCameraMode === "1280×960 @ 60", cappedCameraMode);
  check("camera mode does not invent an FPS when the track omits it", unreportedCameraMode === "960×720 @ FPS unreported", unreportedCameraMode);
  check("camera stop tears down tracks, workers, and Blob lifecycle slots", lifecycle.created === 1 && lifecycle.terminated === 1 && lifecycle.stopped === 1 && lifecycle.workers === "0", JSON.stringify(lifecycle));
  check("camera startup requests the selected 90 FPS mode", lifecycle.initialRequestedFps === 90, JSON.stringify(lifecycle));
  check("live camera tuning requests the selected 120 FPS mode", lifecycle.requestedFps === 120, JSON.stringify(lifecycle));
  check("Optical Transfer Beta has no 390px mobile horizontal overflow", !lifecycle.overflow);
  await ctx.close();
}

{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    window.__fpsRace = { actual: 30, requested: [] };
    window.__opticalWorkerFactory = () => ({ onmessage: null, onerror: null, postMessage() {}, terminate() {} });
    let call = 0;
    const track = {
      getSettings: () => ({ width: 1280, height: 960, frameRate: window.__fpsRace.actual }),
      applyConstraints: constraints => {
        const fps = constraints.frameRate.ideal;
        window.__fpsRace.requested.push(fps);
        const delay = call++ === 0 ? 80 : 10;
        return new Promise(resolve => setTimeout(() => { window.__fpsRace.actual = fps; resolve(); }, delay));
      },
      stop() {},
    };
    const stream = new MediaStream();
    stream.getVideoTracks = () => [track];
    stream.getTracks = () => [track];
    window.__opticalMediaDevices = { getUserMedia: () => Promise.resolve(stream) };
  });
  await p.goto(URL);
  await p.click("#receiveTab");
  await p.click("#cameraBtn");
  await p.waitForFunction(() => document.getElementById("metricCamera").textContent === "1280×960 @ 30");
  await p.selectOption("#captureFps", "60");
  await p.selectOption("#captureFps", "120");
  await p.waitForTimeout(180);
  const race = await p.evaluate(() => ({ ...window.__fpsRace, metric: document.getElementById("metricCamera").textContent }));
  check("overlapping live FPS changes settle on the newest requested camera mode",
    JSON.stringify(race.requested) === JSON.stringify([60, 120]) && race.actual === 120 && race.metric === "1280×960 @ 120", JSON.stringify(race));
  await ctx.close();
}

{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    let changed = false;
    const track = {
      getSettings: () => changed ? ({ width: 960, height: 720, frameRate: 30 }) : ({ width: 1280, height: 960, frameRate: 30 }),
      applyConstraints: () => new Promise(resolve => setTimeout(() => { changed = true; resolve(); }, 80)),
      stop() {},
    };
    const stream = new MediaStream();
    stream.getVideoTracks = () => [track];
    stream.getTracks = () => [track];
    window.__opticalMediaDevices = { getUserMedia: () => Promise.resolve(stream) };
  });
  await p.goto(URL);
  await p.click("#receiveTab");
  await p.click("#cameraBtn");
  await p.waitForFunction(() => document.getElementById("metricCamera").textContent === "1280×960 @ 30");
  await p.selectOption("#captureWidth", "960");
  await p.click("#stopCameraBtn");
  await p.waitForTimeout(140);
  const staleSettings = await p.evaluate(() => ({ status: document.getElementById("receiveStatus").textContent, camera: document.getElementById("metricCamera").textContent }));
  check("late camera-setting resolution cannot update torn-down UI state", /Camera stopped/.test(staleSettings.status) && staleSettings.camera === "1280×960 @ 30", JSON.stringify(staleSettings));
  await ctx.close();
}

{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    window.__lateCamera = { stopped: 0 };
    const track = { getSettings: () => ({}), stop: () => { window.__lateCamera.stopped++; } };
    const stream = new MediaStream();
    stream.getVideoTracks = () => [track];
    stream.getTracks = () => [track];
    window.__opticalMediaDevices = { getUserMedia: () => new Promise(resolve => setTimeout(() => resolve(stream), 80)) };
  });
  await p.goto(URL);
  await p.click("#receiveTab");
  await p.click("#cameraBtn");
  await p.click("#sendTab");
  await p.waitForTimeout(160);
  const late = await p.evaluate(() => ({ ...window.__lateCamera, sendVisible: !document.getElementById("sendPanel").hidden, cameraDisabled: document.getElementById("cameraBtn").disabled, workers: document.getElementById("metricWorkers").textContent }));
  check("late camera permission resolution cannot outlive a mode switch", late.stopped === 1 && late.sendVisible && !late.cameraDisabled && late.workers === "0", JSON.stringify(late));
  await ctx.close();
}

const html = readFileSync(join(ROOT, "dist", "optical-beta.html"), "utf8");
const serviceWorker = readFileSync(join(ROOT, "dist", "sw.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest", "tools.json"), "utf8"));
const betaEntry = manifest.tools.find(tool => tool.id === "optical-beta");
const stableEntry = manifest.tools.find(tool => tool.id === "optical");
check("generated artifact is self-contained", !/<script[^>]+src=|<link[^>]+stylesheet/.test(html));
check("Optical Transfer Beta is a separate Beta Tools manifest entry",
  betaEntry?.file === "optical-beta.html" && betaEntry?.cat === "beta" && stableEntry?.file === "optical.html" && stableEntry?.cat === "util", JSON.stringify({ betaEntry, stableEntry }));
check("built page identifies itself as Optical Transfer Beta", /<title>Optical Transfer Beta · Local Suite<\/title>/.test(html) && /<h1>Optical Transfer Beta<\/h1>/.test(html));
check("PWA app-shell cache includes optical-beta.html", serviceWorker.includes('"optical-beta.html"'));
check("generated CSP scopes WASM/data/blob allowances", /script-src[^;]+'wasm-unsafe-eval'/.test(html) && /connect-src data:/.test(html) && /worker-src 'self' blob:/.test(html));
check("mobile HTTPS and PWA offline caveat is visible", /Mobile browsers generally require this page on hosted HTTPS/.test(html) && /cache enables later offline use/.test(html));
check("confidentiality warning is explicit", /Not confidential:/.test(html) && /does not encrypt the screen/.test(html));
check("integrity wording does not imply sender authenticity", /SHA-256 integrity verified/.test(html) && !/Verified transfer complete/.test(html));

const provenance = readFileSync(join(ROOT, "assets", "optical", "PROVENANCE.md"), "utf8");
const crypto = await import("node:crypto");
const vendorHashes = Object.fromEntries(["qrcode.js", "zxing-worker.js", "zxing_reader.wasm"].map(name => [name, crypto.createHash("sha256").update(readFileSync(join(ROOT, "assets", "optical", name))).digest("hex")]));
check("vendored Optical assets match recorded provenance hashes", Object.entries(vendorHashes).every(([name, hash]) => provenance.includes(`\`${name}\``) && provenance.includes(`\`${hash}\``)), JSON.stringify(vendorHashes));

const hubContext = await browser.newContext();
const hubPage = await hubContext.newPage();
await hubPage.goto(pathToFileURL(join(ROOT, "dist", "index.html")).href);
const betaCard = await hubPage.evaluate(() => [...document.querySelectorAll("section")].some(section =>
  section.querySelector("h2")?.textContent.includes("Beta Tools") &&
  section.querySelector('a[href="optical-beta.html"]')?.textContent.includes("Optical Transfer Beta")
));
check("generated hub renders Optical Transfer Beta inside Beta Tools", betaCard);
await hubContext.close();

await browser.close();
console.log(failures.length ? `\noptical beta: ${failures.length} FAILURE(S)` : "\noptical beta: PASS");
process.exit(failures.length ? 1 : 0);
