/* Optical Transfer Beta Test 1 production packaging gate.
   Run: node tests/optical-beta-test-1-built.mjs */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import vm from "node:vm";

const ROOT = resolve(import.meta.dirname, "..");
const DIST_URL = pathToFileURL(join(ROOT, "dist", "optical-beta-test-1.html")).href;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` - ${detail}`}`);
  if (!ok) failures.push(name);
};
const sha256 = path => createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");
const read = path => readFileSync(join(ROOT, path), "utf8");

const source = read("tools/optical-beta-test-1.html");
const built = read("dist/optical-beta-test-1.html");
const serviceWorker = read("dist/sw.js");
const buildPy = read("build.py");
const manifest = JSON.parse(read("manifest/tools.json"));
const generatedHtml = readdirSync(join(ROOT, "dist")).filter(file => file.endsWith(".html")).sort();
const precache = JSON.parse(serviceWorker.match(/const PRECACHE = (\[[^\]]+\])/s)?.[1] || "[]");

const protectedHashes = {
  "tools/optical.html": "5d5819ad7a0d2420da4f215e435479ef268a8e269d535b36229d40b4d77b324b",
  "dist/optical.html": "4d5d3d2b607f7e3012a21cb795bd6b52ce51b65c26d09e4cf62d5ab0613268dc",
  "tests/optical-built.mjs": "b816d5bbde73cb80cf6fa36d74dd25d8626273024a72526dfedebc2167436257",
  "OPTICAL-TRANSFER.md": "6f28067cdf1669d56311100c7037389e1ddf4066ee910d7530bfbc64d4128ec5",
};
for (const [path, expected] of Object.entries(protectedHashes)) {
  const actual = sha256(path);
  check(`protected stable file hash is preserved: ${path}`, actual === expected, actual);
}

const entry = manifest.tools.find(tool => tool.id === "optical-beta-test-1");
const stableEntry = manifest.tools.find(tool => tool.id === "optical");
const betaEntry = manifest.tools.find(tool => tool.id === "optical-beta");
check("manifest has exactly 106 product identities", manifest.tools.length === 106, String(manifest.tools.length));
check("dist has exactly 107 generated HTML pages", generatedHtml.length === 107, String(generatedHtml.length));
check("PWA precache count is derived from generated HTML + webmanifest + icons",
  precache.length === generatedHtml.length + 1 + 3 && precache.length === 111,
  JSON.stringify({ generatedHtml: generatedHtml.length, precache: precache.length }));
check("manifest contains separate Beta Test 1 identity",
  entry?.file === "optical-beta-test-1.html" && entry?.name === "Optical Transfer Beta Test 1" && entry?.cat === "beta" && entry?.since === "v4.3.5",
  JSON.stringify(entry));
check("stable and existing beta optical identities remain distinct",
  stableEntry?.file === "optical.html" && stableEntry?.cat === "util" && betaEntry?.file === "optical-beta.html" && betaEntry?.cat === "beta",
  JSON.stringify({ stableEntry, betaEntry }));
check("PWA app-shell cache includes optical-beta-test-1.html", precache.includes("optical-beta-test-1.html"));
check("generated artifact is self-contained", !/<script[^>]+src=|<link[^>]+stylesheet/.test(built));
check("built page identifies itself as Optical Transfer Beta Test 1",
  /<title>Optical Transfer Beta Test 1 . Local Suite<\/title>/.test(built) &&
  /<h1>Optical Transfer Beta Test 1<\/h1>/.test(built));
check("current product metadata is v4.3.5 in primary docs",
  read("README.md").includes("Current release: **v4.3.5**") &&
  read("CLAUDE.md").includes("Current project state (v4.3.5") &&
  read("ROADMAP.md").includes("Local Suite v4.3.5") &&
  buildPy.includes("RELEASE_TOOL_COUNT = 106"));

check("builder exact allowlist recognizes only the new H8 filename",
  buildPy.includes("OPTICAL_H8_GLOBAL_HISTOGRAM_WORKER_MARKER_RE") &&
  buildPy.includes('name != "optical-beta-test-1.html"') &&
  buildPy.includes('name not in {"optical.html", "optical-beta.html"}') &&
  !/optical.*marker.*valid.*tools\/\*\.html/i.test(buildPy));
check("source uses the H8 global-histogram worker marker and not the stable marker",
  source.includes("@suite:optical-h8-global-histogram-worker") && !source.includes("@suite:optical-worker */\"\""));

const forbiddenRemnants = [
  "URLSearchParams", "location.search", "OpticalTransferTest", "__optical", "physicalRunId",
  "campaign", "H66-R2-T-", "H76", "H77", "H78", "H79", "H80", "H81", "ADB", "CDP",
  "localhost", "127.0.0.1", "synthetic trial", "benchmark harness", "test payload control",
];
for (const token of forbiddenRemnants) {
  check(`production source has no lab/harness remnant: ${token}`, !source.includes(token));
}
check("production H40 code has no old fixed 1.2s or 8MiB guards",
  !/\b1200\b|1\.2\s*s|8\s*\*\s*1024\s*\*\s*1024|8MiB|8 MiB/.test(source.match(/const H40_ADAPTIVE_RESIDUAL[\s\S]*?class LTDecoder/)?.[0] || ""));
check("production page has no hard 1MiB transfer assumption",
  !/1MIB|1048576|strict\s+1\s*MiB\s+gate/i.test(source));
check("telemetry retained across transfer duration is bounded",
  /callbacksPerPresentation\.push/.test(source) &&
  /callbacksPerPresentation\.length > 120/.test(source) &&
  /callbacksPerPresentation\.shift\(\)/.test(source) &&
  !/decodeHistory|frameHistory|telemetryFrames|latencySamples|receivedFrames\s*=\s*\[\]/.test(source));
check("lifecycle safeguards are present in production source",
  ["stopSender()", "pagehide", "captureGeneration", "receiveGeneration", "drainAndTerminate", "closeAfterPostSha", "reader?.cancel", "URL.revokeObjectURL"].every(token => source.includes(token)));
check("integrity language does not claim authenticity",
  built.includes("SHA-256 integrity verified") && built.includes("This does not authenticate the sender.") && !/authentic transfer|sender authenticated/i.test(built));

const scriptBody = source.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)?.[1];
if (!scriptBody) {
  check("production script is extractable for VM protocol tests", false);
} else {
  const prefix = scriptBody.split("const sendTab =")[0].replace("Suite.theme.init();", "");
  const context = vm.createContext({
    console,
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    performance: { now: () => Date.now() },
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
  });
  const exportsCode = `
globalThis.__exports = {
  HEADER_LEN, MAX_FILE_BYTES, MAX_SNIPPET_BYTES, MAX_CONTAINER_BYTES, MAX_FRAME_BYTES,
  MAX_SOURCE_BLOCKS, MAX_PENDING_EQUATION_BYTES, SELECTED_FRAME_BYTES, SELECTED_BLOCK_LEN,
  SELECTED_QR_VERSION, SELECTED_QR_MODULES, SELECTED_ECC_LEVEL, SELECTED_MASK_PATTERN,
  SELECTED_QUIET_ZONE, SELECTED_PRESENTATIONS_PER_SECOND, SELECTED_GROSS_CARRIER_BPS,
  SELECTED_RAF_CALLBACKS_PER_PRESENTATION, SELECTED_RING_DEPTH, SELECTED_RECEIVER_WORKERS,
  SELECTED_CAPTURE_WIDTH, SELECTED_CAPTURE_FPS, SELECTED_WORKER_IMAGE, SELECTED_PACKAGE,
  PRODUCTION_BOUNDS, H40_ADAPTIVE_RESIDUAL, planH40Residual, LTEncoder, LTDecoder,
  packFrame, parseFrame, fnv1a, frameIndices, solitonCdf, splitmix32, streamIdentity
};`;
  vm.runInContext(prefix + exportsCode, context, { filename: "optical-beta-test-1-core.js" });
  const T = context.__exports;

  check("selected package constants match H66-R2",
    T.SELECTED_FRAME_BYTES === 2563 &&
    T.SELECTED_BLOCK_LEN === 2543 &&
    T.SELECTED_QR_VERSION === 37 &&
    T.SELECTED_QR_MODULES === 165 &&
    T.SELECTED_ECC_LEVEL === "L" &&
    T.SELECTED_MASK_PATTERN === 4 &&
    T.SELECTED_QUIET_ZONE === 4 &&
    T.SELECTED_PRESENTATIONS_PER_SECOND === 30 &&
    T.SELECTED_GROSS_CARRIER_BPS === 76890 &&
    T.SELECTED_RAF_CALLBACKS_PER_PRESENTATION === 2 &&
    T.SELECTED_RING_DEPTH === 3 &&
    T.SELECTED_RECEIVER_WORKERS === 4 &&
    T.SELECTED_CAPTURE_WIDTH === 1280 &&
    T.SELECTED_CAPTURE_FPS === 60,
    JSON.stringify(T.SELECTED_PACKAGE));
  check("production bounds expose the required five classifications",
    ["removedBenchmarkArtificialCap", "adaptiveBound", "protocolCorrectnessBound", "resourceSafetyBound", "externalBrowserDeviceLimit"].every(key => Array.isArray(T.PRODUCTION_BOUNDS[key]) && T.PRODUCTION_BOUNDS[key].length));
  check("resource safety bounds remain finite",
    T.MAX_FILE_BYTES === 16 * 1024 * 1024 &&
    T.MAX_SNIPPET_BYTES === 1024 * 1024 &&
    T.MAX_PENDING_EQUATION_BYTES === 32 * 1024 * 1024 &&
    T.H40_ADAPTIVE_RESIDUAL.maxBytes === 64 * 1024 * 1024 &&
    T.SELECTED_RECEIVER_WORKERS === 4 &&
    T.SELECTED_RING_DEPTH === 3);

  const plans = [1, 3, 10].map(mib => {
    const totalLen = mib * 1024 * 1024;
    const unresolved = 64;
    return T.planH40Residual({
      k: Math.ceil(totalLen / T.SELECTED_BLOCK_LEN),
      blockLen: T.SELECTED_BLOCK_LEN,
      totalLen,
      rows: unresolved,
      unresolved,
    });
  });
  check("H40 admission is payload-aware beyond 1 MiB",
    plans.every(plan => plan.maxMs > 1200 && plan.maxBytes > 8 * 1024 * 1024) &&
    plans[1].admitted && plans[2].admitted,
    JSON.stringify(plans));
  check("H40 plans classify admitted work as adaptive bounds",
    plans.every(plan => plan.classification === "adaptive bound"), JSON.stringify(plans.map(plan => plan.classification)));

  const protocol = await vm.runInContext(`(async () => {
    const T = globalThis.__exports;
    const frame = T.packFrame({ sessionId: 0xbeef, seq: 0x01020304, k: 0x0111, blockLen: 6, totalLen: 0x666, payloadFnv: 0x89abcdef }, new Uint8Array([1, 2, 3, 4, 5, 6]));
    const badMagic = frame.slice(); badMagic[0] = 0;
    const badK = frame.slice(); new DataView(badK.buffer).setUint16(8, 0, true);
    return {
      parsed: T.parseFrame(frame)?.header,
      rejects: [badMagic, badK, frame.slice(0, -1)].map(bytes => T.parseFrame(bytes) === null),
      frameLength: frame.length,
    };
  })()`, context);
  check("frame protocol accepts exact headers and rejects malformed input",
    protocol.frameLength === 26 &&
    protocol.parsed?.sessionId === 0xbeef &&
    protocol.parsed?.blockLen === 6 &&
    protocol.rejects.every(Boolean),
    JSON.stringify(protocol));

  const h40 = await vm.runInContext(`(async () => {
    const T = globalThis.__exports;
    const config = { triggerPercent: 0, retryPercent: .02, minRows: 1, minBytes: 1024, maxBytes: 1024 * 1024, minMs: 100, maxMs: 2000, minOps: 1, maxOps: 100000, yieldEveryOps: 1 };
    const payload = new Uint8Array([1,2,3,4, 5,6,7,8, 9,10,11,12]);
    const view = new DataView(payload.buffer);
    const words = [0, 1, 2].map(index => view.getUint32(index * 4, true));
    const decoder = new T.LTDecoder(3, 4, 55, 12, config);
    const rows = [
      { seq: 0, idx: [0, 1], words: new Uint32Array([words[0] ^ words[1]]) },
      { seq: 1, idx: [1, 2], words: new Uint32Array([words[1] ^ words[2]]) },
      { seq: 2, idx: [2], words: new Uint32Array([words[2]]) },
    ];
    const plan = T.planH40Residual({ k: 3, blockLen: 4, totalLen: 12, rows: 3, unresolved: 3, config });
    await decoder.completeResidual(rows, plan, decoder.generation);
    const assembled = decoder.assemble();
    return {
      admitted: plan.admitted,
      complete: decoder.isComplete,
      exact: assembled && Array.from(assembled).join(",") === Array.from(payload).join(","),
      completions: decoder.residualTelemetry.completions,
      yielded: decoder.residualTelemetry.yielded,
      outcome: decoder.residualTelemetry.last?.outcome,
    };
  })()`, context);
  check("adaptive H40 residual completion can solve full-rank rows with yields",
    h40.admitted && h40.complete && h40.exact && h40.completions === 1 && h40.yielded > 0 && h40.outcome === "full-rank",
    JSON.stringify(h40));

  const fallback = await vm.runInContext(`(async () => {
    const T = globalThis.__exports;
    const payload = new Uint8Array(160);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 17 + 3) & 255;
    const encoder = new T.LTEncoder(payload, 8, 99);
    const decoder = new T.LTDecoder(encoder.k, 8, 99, payload.length, { triggerPercent: 0, retryPercent: .01, minRows: 1, minBytes: 1, maxBytes: 1, minMs: 1, maxMs: 10, minOps: 1, maxOps: 1000, yieldEveryOps: 1 });
    decoder.maxFrames = 1000;
    for (let seq = 0; seq < 1000 && !decoder.isComplete; seq++) {
      decoder.addFrame(seq, encoder.encode(seq));
      await decoder.residualIdle();
    }
    const assembled = decoder.assemble();
    return {
      complete: decoder.isComplete,
      exact: assembled && Array.from(assembled).join(",") === Array.from(payload).join(","),
      notAdmitted: decoder.residualTelemetry.notAdmitted,
      maxFrames: decoder.maxFrames,
    };
  })()`, context);
  check("H40 not-admitted fallback safely completes through normal LT peeling",
    fallback.complete && fallback.exact && fallback.notAdmitted > 0 && fallback.maxFrames === 1000,
    JSON.stringify(fallback));

  const memory = await vm.runInContext(`(() => {
    const T = globalThis.__exports;
    const blockLens = [T.SELECTED_BLOCK_LEN, T.MAX_FRAME_BYTES - T.HEADER_LEN];
    return blockLens.map(blockLen => {
      const k = Math.ceil(T.MAX_CONTAINER_BYTES / blockLen);
      const decoder = new T.LTDecoder(k, blockLen, 10, T.MAX_CONTAINER_BYTES);
      return { blockLen, k, maxFrames: decoder.maxFrames, bytes: decoder.maxFrames * Math.ceil(blockLen / 4) * 4 };
    });
  })()`, context);
  check("retained LT equation buffers stay inside the explicit memory ceiling",
    memory.every(row => row.bytes <= T.MAX_PENDING_EQUATION_BYTES), JSON.stringify(memory));
}

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
await page.goto(`${DIST_URL}?h80=1&campaign=lab&payload=1MIB&mask=0`);
await page.waitForTimeout(300);
check("browser load ignores lab-style query flags", page.url().includes("?h80=1") && errors.length === 0);
check("page load makes no HTTP(S) request", escaped === 0, String(escaped));
check("page boot has no console/page errors", errors.length === 0, errors.join(" | "));
check("page boot has no CSP violations", (await page.evaluate(() => window.__csp)).length === 0, (await page.evaluate(() => window.__csp)).join(" | "));

const controls = await page.evaluate(() => Object.fromEntries(["txFps", "frameBytes", "eccLevel", "displaySize", "captureWidth", "captureFps", "workerCount"].map(id => {
  const select = document.getElementById(id);
  return [id, { value: select.value, options: [...select.options].map(option => option.value) }];
})));
check("UI controls are fixed to selected package values",
  JSON.stringify(controls) === JSON.stringify({
    txFps: { value: "30", options: ["30"] },
    frameBytes: { value: "2563", options: ["2563"] },
    eccLevel: { value: "L", options: ["L"] },
    displaySize: { value: "700", options: ["700"] },
    captureWidth: { value: "1280", options: ["1280"] },
    captureFps: { value: "60", options: ["60"] },
    workerCount: { value: "4", options: ["4"] },
  }), JSON.stringify(controls));

await page.locator("#sendFile").setInputFiles({
  name: "beta-test-1-flow.bin",
  mimeType: "application/octet-stream",
  buffer: Buffer.from(Array.from({ length: 8192 }, (_, i) => i & 255)),
});
await page.click("#prepareBtn");
await page.waitForFunction(() => !document.getElementById("streamBtn").disabled);
await page.click("#streamBtn");
await page.waitForFunction(() => /frame [1-9]/.test(document.getElementById("streamMeta").textContent), null, { timeout: 10000 });
const sendUi = await page.evaluate(() => {
  const qr = document.getElementById("sendQr");
  const rect = qr.getBoundingClientRect();
  return {
    width: qr.width,
    height: qr.height,
    clientWidth: rect.width,
    clientHeight: rect.height,
    meta: document.getElementById("streamMeta").textContent,
    status: document.getElementById("sendStatus").textContent,
  };
});
check("rendered geometry is square V37 plus quiet zone at an integer scale",
  sendUi.width === sendUi.height &&
  sendUi.clientWidth === sendUi.clientHeight &&
  sendUi.width % (165 + 8) === 0 &&
  /QR V37 L mask 4/.test(sendUi.meta) &&
  /2563 gross bytes\/frame/.test(sendUi.status),
  JSON.stringify(sendUi));

const workerLiteral = built.match(/OPTICAL_H8_GLOBAL_HISTOGRAM_WORKER_SOURCE = \/\* @suite:optical-h8-global-histogram-worker \*\/([\s\S]*?)\/\* \/@suite:optical-h8-global-histogram-worker \*\//)?.[1];
let workerSource = "";
try { workerSource = workerLiteral ? JSON.parse(workerLiteral) : ""; } catch {}
check("built H8 worker is embedded with data-URI WASM and selected decode options",
  workerSource.length > 1_000_000 &&
  workerSource.includes("data:application/wasm;base64,") &&
  workerSource.includes('binarizer:"GlobalHistogram"') &&
  workerSource.includes("tryHarder:false") &&
  workerSource.includes("tryRotate:false") &&
  workerSource.includes("tryInvert:false") &&
  workerSource.includes("tryDownscale:false") &&
  workerSource.includes("M*6!==c*5"),
  String(workerSource.length));

const decodedBytes = workerSource ? await page.evaluate(workerSource => new Promise(resolve => {
  const sendQr = document.getElementById("sendQr");
  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = 768;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sendQr, 0, 64, 640, 640);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  const worker = new Worker(url);
  const timer = setTimeout(() => { worker.terminate(); URL.revokeObjectURL(url); resolve({ ok: false, reason: "timeout" }); }, 12000);
  worker.onmessage = event => {
    if (event.data?.id === -1) return;
    clearTimeout(timer);
    worker.terminate();
    URL.revokeObjectURL(url);
    const bytes = event.data?.bytes ? Array.from(new Uint8Array(event.data.bytes)) : [];
    resolve({ ok: bytes.length > 0, length: bytes.length, prefix: bytes.slice(0, 2) });
  };
  worker.onerror = event => {
    clearTimeout(timer);
    worker.terminate();
    URL.revokeObjectURL(url);
    resolve({ ok: false, reason: event.message });
  };
  worker.postMessage({ id: 7, buf: image.data.buffer, w: image.width, h: image.height }, [image.data.buffer]);
}), workerSource) : { ok: false, reason: "no worker" };
check("rendered QR decodes through the selected H8 worker to a 2,563-byte frame",
  decodedBytes.ok && decodedBytes.length === 2563 && JSON.stringify(decodedBytes.prefix) === JSON.stringify([0xd1, 0x0c]),
  JSON.stringify(decodedBytes));
check("worker warm-up and QR decode make no HTTP(S) request", escaped === 0, String(escaped));
await context.close();

const reducedContext = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 900, height: 700 } });
const reducedPage = await reducedContext.newPage();
await reducedPage.goto(DIST_URL);
await reducedPage.click('input[name="payloadMode"][value="text"]');
await reducedPage.fill("#sendText", "reduced motion selected package");
await reducedPage.click("#prepareBtn");
await reducedPage.waitForFunction(() => !document.getElementById("streamBtn").disabled);
await reducedPage.click("#streamBtn");
await reducedPage.waitForFunction(() => /frame [1-9]/.test(document.getElementById("streamMeta").textContent));
await reducedPage.waitForTimeout(450);
const reduced = await reducedPage.evaluate(() => ({
  status: document.getElementById("sendStatus").textContent,
  frames: Number(document.getElementById("streamMeta").textContent.match(/frame ([\d,]+)/)?.[1].replaceAll(",", "")),
}));
check("reduced-motion stream uses a slow no-catch-up presentation path",
  /2 presentation\/s reduced-motion limit/.test(reduced.status) && reduced.frames <= 2,
  JSON.stringify(reduced));
await reducedContext.close();

const hubContext = await browser.newContext();
const hubPage = await hubContext.newPage();
await hubPage.goto(pathToFileURL(join(ROOT, "dist", "index.html")).href);
const hub = await hubPage.evaluate(() => ({
  header: document.querySelector("header")?.textContent || "",
  betaCard: [...document.querySelectorAll("section")].some(section =>
    section.querySelector("h2")?.textContent.includes("Beta Tools") &&
    section.querySelector('a[href="optical-beta-test-1.html"]')?.textContent.includes("Optical Transfer Beta Test 1")),
}));
check("generated hub renders Optical Transfer Beta Test 1 inside Beta Tools", hub.betaCard, JSON.stringify(hub));
await hubContext.close();

await browser.close();
console.log(failures.length ? `\noptical beta test 1: ${failures.length} FAILURE(S)` : "\noptical beta test 1: PASS");
process.exit(failures.length ? 1 : 0);
