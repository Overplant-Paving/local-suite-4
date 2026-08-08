/* Explicit same-room hardware attempt; never part of broad smoke.
   Run from an interactive desktop/PipeWire session:
   node tests/audio-physical.mjs */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

const physicalBytes = Number(process.env.AUDIO_PHYSICAL_BYTES || 1);
if (!Number.isSafeInteger(physicalBytes) || physicalBytes < 1 || physicalBytes > 1024 * 1024) {
  throw new RangeError("AUDIO_PHYSICAL_BYTES must be an integer from 1 through 1048576");
}
const payload = Buffer.alloc(physicalBytes);
for (let i = 0; i < payload.length; i++) payload[i] = (i * 73 + 19) & 0xff;
const expectedSha256 = createHash("sha256").update(payload).digest("hex");
const sourceBlocks = Math.ceil(physicalBytes / 512);
const equationCount = Math.max(8, Math.ceil(sourceBlocks * 1.35) + 2);
const totalPackets = 5 + 2 + equationCount + 7;
const physicalTimeoutMs = Math.max(90000, 30000 + totalPackets * 5000);

const origin = "http://127.0.0.1:8765";
const browser = await chromium.launch({
  executablePath: existsSync("/snap/bin/chromium") ? "/snap/bin/chromium" : chromium.executablePath(),
  headless: false,
  ignoreDefaultArgs: ["--mute-audio"],
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({permissions: ["microphone"], viewport: {width: 1050, height: 820}});
await context.grantPermissions(["microphone"], {origin});
const receiver = await context.newPage();
const sender = await context.newPage();
const errors = [];
for (const [name, page] of [["receiver", receiver], ["sender", sender]]) {
  page.on("pageerror", error => errors.push(`${name} page: ${String(error)}`));
  page.on("console", message => { if (message.type() === "error") errors.push(`${name} console: ${message.text()}`); });
}

let result;
try {
  await receiver.goto(`${origin}/audio.html`);
  await receiver.locator("#receiveTab").click();
  await receiver.locator("#receiveBtn").click();
  await receiver.waitForFunction(() => document.getElementById("rxSampleRate").textContent.includes("Hz"), null, {timeout: 15000});

  await sender.goto(`${origin}/audio.html`);
  await sender.locator("#sendFile").setInputFiles({name: `air-${physicalBytes}.bin`, mimeType: "application/octet-stream", buffer: payload});
  await sender.locator("#startSendBtn").click();
  const deadline = Date.now() + physicalTimeoutMs;
  let observation = {};
  let maxDbfs = -Infinity;
  let signalSeen = false;
  let lockedSeen = false;
  const decoderStates = new Set();
  while (Date.now() < deadline) {
    observation = await receiver.evaluate(() => ({
      status: document.getElementById("receiveStatus").textContent,
      packets: document.getElementById("rxPackets").textContent,
      level: document.getElementById("rxLevel").textContent,
      decoder: document.getElementById("rxDecoder").textContent,
      signal: document.getElementById("stateSignal").classList.contains("on"),
      locked: document.getElementById("stateLocked").classList.contains("on"),
      integrity: document.getElementById("integrityResult").textContent,
      download: !document.getElementById("downloadLink").hidden,
    }));
    const measured = Number.parseFloat(observation.level);
    if (Number.isFinite(measured)) maxDbfs = Math.max(maxDbfs, measured);
    signalSeen ||= observation.signal;
    lockedSeen ||= observation.locked;
    if (observation.decoder) decoderStates.add(observation.decoder);
    if (observation.download || /failed|error|mismatch/i.test(observation.status)) break;
    await receiver.waitForTimeout(100);
  }
  const send = await sender.evaluate(() => ({
    status: document.getElementById("sendStatus").textContent,
    packet: document.getElementById("sendPacket").textContent,
    rate: document.getElementById("sendRate").textContent,
    sampleRate: document.getElementById("sendSampleRate").textContent,
  }));
  const receive = await receiver.evaluate(() => ({
    status: document.getElementById("receiveStatus").textContent,
    packets: document.getElementById("rxPackets").textContent,
    level: document.getElementById("rxLevel").textContent,
    signal: document.getElementById("stateSignal").classList.contains("on"),
    locked: document.getElementById("stateLocked").classList.contains("on"),
    integrity: document.getElementById("integrityResult").textContent,
    download: !document.getElementById("downloadLink").hidden,
    sampleRate: document.getElementById("rxSampleRate").textContent,
    processing: ["ec", "ns", "agc"].map(name => ({
      name,
      requested: document.getElementById(`${name}Requested`).textContent,
      supported: document.getElementById(`${name}Supported`).textContent,
      effective: document.getElementById(`${name}Effective`).textContent,
    })),
  }));
  let downloadedSha256 = null;
  let downloadedBytes = 0;
  let exactDownload = false;
  if (receive.download) {
    const values = await receiver.evaluate(() => {
      const bytes = window.AcousticTransferTest.getVerifiedBytes();
      return bytes ? Array.from(bytes) : [];
    });
    const downloaded = Buffer.from(values);
    downloadedBytes = downloaded.length;
    downloadedSha256 = createHash("sha256").update(downloaded).digest("hex");
    exactDownload = downloaded.equals(payload);
  }
  result = {verified: receive.download && receive.integrity.startsWith("SHA-256 verified") && exactDownload,
    expected: {bytes: payload.length, sha256: expectedSha256},
    downloaded: {bytes: downloadedBytes, sha256: downloadedSha256, exact: exactDownload},
    physicalTelemetry: {maxDbfs, signalSeen, lockedSeen, decoderStates: [...decoderStates]},
    send, receive, errors};
} catch (error) {
  result = {verified: false, blocker: String(error), errors};
} finally {
  await browser.close();
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.verified ? 0 : 1;
