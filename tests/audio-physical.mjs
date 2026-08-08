/* Explicit same-room hardware attempt; never part of broad smoke.
   Run from an interactive desktop/PipeWire session:
   node tests/audio-physical.mjs */
import { chromium } from "playwright";

const origin = "http://127.0.0.1:8765";
const browser = await chromium.launch({
  executablePath: "/snap/bin/chromium",
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
  await sender.locator("#sendFile").setInputFiles({name: "air.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0x41])});
  await sender.locator("#startSendBtn").click();
  const deadline = Date.now() + 90000;
  let observation = {};
  while (Date.now() < deadline) {
    observation = await receiver.evaluate(() => ({
      status: document.getElementById("receiveStatus").textContent,
      packets: document.getElementById("rxPackets").textContent,
      level: document.getElementById("rxLevel").textContent,
      signal: document.getElementById("stateSignal").classList.contains("on"),
      locked: document.getElementById("stateLocked").classList.contains("on"),
      integrity: document.getElementById("integrityResult").textContent,
      download: !document.getElementById("downloadLink").hidden,
    }));
    if (observation.download || /failed|error|mismatch/i.test(observation.status)) break;
    await receiver.waitForTimeout(500);
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
  result = {verified: receive.download && receive.integrity.startsWith("SHA-256 verified"), send, receive, errors};
} catch (error) {
  result = {verified: false, blocker: String(error), errors};
} finally {
  await browser.close();
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.verified ? 0 : 1;
