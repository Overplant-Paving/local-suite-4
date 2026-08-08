/* Narrow production Audio Transfer browser control check.
   Run: node tests/audio-built.mjs */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join, extname } from "node:path";
const ROOT = resolve(import.meta.dirname, "..");

const mime = {".html": "text/html", ".js": "text/javascript", ".png": "image/png",
  ".webmanifest": "application/manifest+json"};
const server = http.createServer((request, response) => {
  const rel = request.url.split("?")[0].replace(/^\/+/, "") || "index.html";
  const path = join(ROOT, "dist", rel);
  if (!existsSync(path)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, {"content-type": mime[extname(path)] || "application/octet-stream",
    "cache-control": "no-store"});
  response.end(readFileSync(path));
});
await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
server.unref();
const origin = `http://127.0.0.1:${server.address().port}`;

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
};
const browser = await chromium.launch({
  executablePath: existsSync("/snap/bin/chromium") ? "/snap/bin/chromium" : chromium.executablePath(),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const context = await browser.newContext({viewport: {width: 1200, height: 900}, permissions: ["microphone"]});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(`page: ${String(error)}`));
page.on("console", message => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", event =>
    window.__csp.push(`${event.violatedDirective}:${event.blockedURI}`));
});
await page.goto(`${origin}/index.html`);
check("hub exposes the new Beta Tools category", await page.locator("h2", {hasText: "Beta Tools"}).count() === 1);
check("Audio Transfer is a separate Beta Tools card", await page.evaluate(() => {
  const heading = [...document.querySelectorAll("h2")].find(node => node.textContent.includes("Beta Tools"));
  return heading?.closest("section")?.querySelector('a[href="audio.html"]')?.textContent.includes("Audio Transfer") === true;
}));
await page.goto(`${origin}/audio.html`);
await page.waitForTimeout(300);
check("page exposes bounded transfer helpers", await page.evaluate(() =>
  window.AcousticTransferTest?.MAX_FILE_BYTES === 1048576 && window.AcousticTransferTest?.CHUNK_BYTES === 512 &&
  window.AcousticTransferTest?.MAX_FOUNTAIN_FRAMES === 3072));
const fountainMatrix = await page.evaluate(() => {
  const T = window.AcousticTransferTest;
  const sizes = [1, 2, 8, 16, 32, 64, 128, 2048];
  const results = [];
  for (const k of sizes) {
    const seeds = k === 2048 ? 3 : 20;
    for (let seed = 0; seed < seeds; seed++) {
      const sid = Uint8Array.from({length: 16}, (_, i) => (seed * 29 + i * 17 + k) & 255);
      const length = k * T.CHUNK_BYTES - (k > 1 ? 7 : 0);
      const payload = Uint8Array.from({length}, (_, i) => (i * 31 + seed * 7 + k) & 255);
      const count = T.fountainEquationCount(k);
      const sequences = Array.from({length: count}, (_, equation) =>
        T.fountainSequenceForEquation(equation, k, count));
      const encoder = new T.LTEncoder(payload, T.CHUNK_BYTES, sid);
      const exact = new T.LTDecoder(k, T.CHUNK_BYTES, sid, length, count);
      for (const sequence of sequences) exact.addFrame(sequence, encoder.encode(sequence));
      const assembled = exact.assemble();
      results.push({k, seed, mode: "no-loss", ok: Boolean(assembled) && T.bytesEqual(assembled, payload)});
      exact.dispose();
      if (k >= 8 && k <= 128) {
        const lossy = new T.LTDecoder(k, T.CHUNK_BYTES, sid, length, count);
        for (let equation = 0; equation < sequences.length; equation++) {
          if (equation === seed % k) continue;
          const sequence = sequences[equation];
          lossy.addFrame(sequence, encoder.encode(sequence));
        }
        const recovered = lossy.assemble();
        results.push({k, seed, mode: "one-systematic-loss", ok: Boolean(recovered) && T.bytesEqual(recovered, payload)});
        lossy.dispose();
      }
    }
  }
  return {total: results.length, failures: results.filter(result => !result.ok)};
});
check("finite fountain schedule reconstructs every deterministic no-loss and loss-matrix case",
  fountainMatrix.failures.length === 0, JSON.stringify(fountainMatrix.failures.slice(0, 12)));

await page.locator("#sendFile").setInputFiles({name: "one.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0xa5])});
await page.locator("#startSendBtn").click();
await page.waitForFunction(() => document.getElementById("sendSampleRate").textContent.includes("Hz"), null, {timeout: 15000});
await page.waitForFunction(() => !document.getElementById("sendPacket").textContent.startsWith("0 /"), null, {timeout: 15000});
check("Send creates observed-rate AudioContext and audible packet", await page.locator("#sendPacket").textContent().then(text => /1 \/ 22/.test(text)), await page.locator("#sendPacket").textContent());
await page.locator("#stopSendBtn").click();
await page.waitForFunction(() => document.getElementById("stopSendBtn").hidden, null, {timeout: 5000});

await page.locator("#receiveTab").click();
await page.locator("#receiveBtn").click();
await page.waitForFunction(() => document.getElementById("rxSampleRate").textContent.includes("Hz"), null, {timeout: 15000});
check("Receive opens microphone and reports effective processing", await page.evaluate(() =>
  ["ecEffective", "nsEffective", "agcEffective"].every(id => document.getElementById(id).textContent !== "—")));
check("Receive reports real listening state", await page.locator("#stateListening").evaluate(element => element.classList.contains("on")));
const pipeline = await page.evaluate(async () => {
  const T = window.AcousticTransferTest;
  const bytes = new Uint8Array([0, 1, 0xff, 0x41]);
  const digest = await T.sha256(bytes);
  const sid = new Uint8Array(16);
  sid.set([1, 2, 3, 4], 12);
  const file = new File([bytes], "exact.bin", {type: "application/octet-stream"});
  const manifest = T.makeManifest(file, bytes, digest, sid);
  const manifestId = await T.sha256(manifest.bytes);
  const common = {sessionId: sid, manifestTag: T.u32(manifestId), totalChunks: 1};
  const fountain = new T.LTEncoder(bytes, T.CHUNK_BYTES, sid);
  await T.feedDecodedFrame({...common, type: 5, profileId: 1, bytes: manifest.bytes});
  await T.feedDecodedFrame({...common, type: 16, profileId: 16, fountain: true,
    index: 0, sequence: 4, bytes: fountain.encode(4)});
  await T.feedDecodedFrame({...common, type: 23, profileId: 1,
    manifestId, sha256: digest, fileLength: bytes.length});
  return {
    download: !document.getElementById("downloadLink").hidden,
    name: document.getElementById("downloadLink").download,
    integrity: document.getElementById("integrityResult").textContent,
    progress: document.getElementById("receiveProgress").getAttribute("aria-valuenow"),
  };
});
check("decoded packets reconstruct exact SHA-gated download", pipeline.download &&
  pipeline.name === "exact.bin" && pipeline.integrity.startsWith("SHA-256 verified") &&
  pipeline.progress === "100", JSON.stringify(pipeline));

await page.locator("#receiveBtn").click();
await page.waitForFunction(() => document.getElementById("receiveBtn").disabled &&
  document.getElementById("stateListening").classList.contains("on"), null, {timeout: 15000});
const mismatch = await page.evaluate(async () => {
  const T = window.AcousticTransferTest;
  const declared = new Uint8Array([9, 8]);
  const changed = new Uint8Array([9, 7]);
  const digest = await T.sha256(declared);
  const sid = new Uint8Array(16);
  sid[15] = 9;
  const file = new File([declared], "changed.bin", {type: "application/octet-stream"});
  const manifest = T.makeManifest(file, declared, digest, sid);
  const manifestId = await T.sha256(manifest.bytes);
  const common = {sessionId: sid, manifestTag: T.u32(manifestId), totalChunks: 1};
  const fountain = new T.LTEncoder(changed, T.CHUNK_BYTES, sid);
  await T.feedDecodedFrame({...common, type: 5, profileId: 1, bytes: manifest.bytes});
  await T.feedDecodedFrame({...common, type: 16, profileId: 16, fountain: true,
    index: 0, sequence: 4, bytes: fountain.encode(4)});
  await T.feedDecodedFrame({...common, type: 23, profileId: 1,
    manifestId, sha256: digest, fileLength: changed.length});
  return {
    download: !document.getElementById("downloadLink").hidden,
    integrity: document.getElementById("integrityResult").textContent,
    status: document.getElementById("receiveStatus").textContent,
  };
});
check("SHA-256 mismatch withholds download", !mismatch.download &&
  mismatch.integrity.includes("download withheld") && mismatch.status.includes("SHA-256 mismatch"),
  JSON.stringify(mismatch));

const csp = await page.evaluate(() => window.__csp);
check("browser exercise has no CSP violations", csp.length === 0, csp.join(" | "));
check("browser exercise has no console/page errors", errors.length === 0, errors.join(" | "));
check("page remains responsive without horizontal overflow", await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth));

const directErrors = [];
let escaped = 0;
const direct = await context.newPage();
direct.on("request", request => { if (/^https?:/.test(request.url())) escaped++; });
direct.on("pageerror", error => directErrors.push(`page: ${String(error)}`));
direct.on("console", message => { if (message.type() === "error") directErrors.push(`console: ${message.text()}`); });
await direct.goto(pathToFileURL(join(ROOT, "dist", "audio.html")).href);
await direct.locator("#sendFile").setInputFiles({name: "direct.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0x5a])});
await direct.locator("#startSendBtn").click();
await direct.waitForFunction(() => !document.getElementById("sendPacket").textContent.startsWith("0 /"), null, {timeout: 15000});
check("generated direct-file sender starts embedded Worker and data-URL AudioWorklet",
  await direct.locator("#sendSampleRate").textContent().then(text => text.includes("Hz")));
await direct.locator("#stopSendBtn").click();
check("direct-file sender makes no HTTP(S) request", escaped === 0, String(escaped));
check("direct-file sender has no console/page errors", directErrors.length === 0, directErrors.join(" | "));
await direct.close();

await context.close();
await browser.close();
server.close();
console.log(failures.length ? `\naudio: ${failures.length} FAILURE(S)` : "\naudio: PASS");
process.exitCode = failures.length ? 1 : 0;
