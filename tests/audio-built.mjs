/* Narrow production Audio Transfer browser control check.
   Run: node tests/audio-built.mjs */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
const ROOT = resolve(import.meta.dirname, "..");

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
};
const browser = await chromium.launch({
  executablePath: "/snap/bin/chromium",
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
await page.goto("http://127.0.0.1:8765/audio.html");
await page.waitForTimeout(300);
check("page exposes bounded transfer helpers", await page.evaluate(() =>
  window.AcousticTransferTest?.MAX_FILE_BYTES === 65536 && window.AcousticTransferTest?.CHUNK_BYTES === 256));

await page.locator("#sendFile").setInputFiles({name: "one.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0xa5])});
await page.locator("#startSendBtn").click();
await page.waitForFunction(() => document.getElementById("sendSampleRate").textContent.includes("Hz"), null, {timeout: 15000});
await page.waitForFunction(() => !document.getElementById("sendPacket").textContent.startsWith("0 /"), null, {timeout: 15000});
check("Send creates observed-rate AudioContext and audible packet", await page.locator("#sendPacket").textContent().then(text => /1 \/ 10/.test(text)), await page.locator("#sendPacket").textContent());
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
  await T.feedDecodedFrame({...common, type: 5, bytes: manifest.bytes});
  await T.feedDecodedFrame({...common, type: 16, index: 0, bytes});
  await T.feedDecodedFrame({...common, type: 23, manifestId, sha256: digest, fileLength: bytes.length});
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
  await T.feedDecodedFrame({...common, type: 5, bytes: manifest.bytes});
  await T.feedDecodedFrame({...common, type: 16, index: 0, bytes: changed});
  await T.feedDecodedFrame({...common, type: 23, manifestId, sha256: digest, fileLength: changed.length});
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
console.log(failures.length ? `\naudio: ${failures.length} FAILURE(S)` : "\naudio: PASS");
process.exitCode = failures.length ? 1 : 0;
