"use strict";

(() => {
const MAX_FILE_BYTES = 1024 * 1024;
const CHUNK_BYTES = 512;
const INITIAL_MANIFEST_COPIES = 5;
const MID_MANIFEST_COPIES = 2;
const FIN_COPIES = 7;
const FOUNTAIN_OVERHEAD = .35;
const FOUNTAIN_EXTRA_EQUATIONS = 2;
const MAX_FOUNTAIN_FRAMES = 3072;
const MAX_FOUNTAIN_STORAGE_BYTES = 8 * 1024 * 1024;
const INTER_PACKET_GAP_MS = 600;
const MAX_RX_PENDING = 6;
const SYSTEMATIC_SEQUENCE_BASE = INITIAL_MANIFEST_COPIES + 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", {fatal: true});
const EMBEDDED_MODEM_WORKER = /* @suite:acoustic-worker */""/* /@suite:acoustic-worker */;
const EMBEDDED_WORKLET_DATA_URL = /* @suite:acoustic-worklet-data-url */""/* /@suite:acoustic-worklet-data-url */;
const SOURCE_WORKER_URL = "../assets/acoustic/app/modem-worker.js";
const SOURCE_WORKLET_URL = "../assets/acoustic/worklet/audio-io.js";

const $ = id => document.getElementById(id);
const sendTab = $("sendTab"), receiveTab = $("receiveTab");
const sendPanel = $("sendPanel"), receivePanel = $("receivePanel");
const sendFile = $("sendFile"), startSendBtn = $("startSendBtn"), stopSendBtn = $("stopSendBtn");
const sendStatus = $("sendStatus"), sendBar = $("sendBar"), sendProgress = $("sendProgress");
const receiveBtn = $("receiveBtn"), stopReceiveBtn = $("stopReceiveBtn"), resetReceiveBtn = $("resetReceiveBtn");
const receiveStatus = $("receiveStatus"), receiveBar = $("receiveBar"), receiveProgress = $("receiveProgress");
const downloadLink = $("downloadLink"), integrityResult = $("integrityResult");

let generation = 0;
let active = null;
let downloadUrl = null;
let receiveState = null;
let verifiedBytesForTest = null;

function formatBytes(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${Number.isInteger(n) ? n : n.toFixed(n < 10 ? 1 : 0)} B`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MiB`;
  return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
}
function formatRate(bytes, elapsedSeconds) {
  if (!(elapsedSeconds > 0) || !(bytes >= 0)) return "—";
  return `${formatBytes(bytes / elapsedSeconds)}/s`;
}
function setStatus(element, text, kind = "") {
  element.textContent = text;
  element.className = `status${kind ? ` ${kind}` : ""}`;
}
function setText(id, text) { $(id).textContent = text; }
function setProgress(progress, bar, fraction) {
  const percent = Math.max(0, Math.min(100, fraction * 100));
  bar.style.width = `${percent}%`;
  progress.setAttribute("aria-valuenow", String(Math.round(percent)));
}
function bytesEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function hex(bytes) {
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
}
function fromHex(value, length) {
  if (typeof value !== "string" || value.length !== length * 2 || !/^[0-9a-f]+$/i.test(value)) {
    throw new Error("Acoustic metadata contains invalid hexadecimal data.");
  }
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}
async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
function u32(bytes) {
  return (((bytes[0] * 0x1000000) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]) >>> 0);
}
function safeFileName(input) {
  let name = String(input || "").split(/[\\/]/).pop() || "";
  try { name = name.normalize("NFC"); } catch (_) {}
  name = name.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[<>:"|?*]/g, "_").replace(/[. ]+$/g, "").trim();
  if (!name || name === "." || name === "..") return "transfer.bin";
  const stem = name.split(".")[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) name = `_${name}`;
  const points = Array.from(name);
  if (points.length > 120) name = points.slice(0, 120).join("");
  return name || "transfer.bin";
}
function safeMediaType(input) {
  const type = String(input || "").trim();
  return type.length <= 100 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(type) ?
    type : "application/octet-stream";
}
function sessionId() {
  const value = new Uint8Array(16);
  do { crypto.getRandomValues(value); } while (value.every(byte => byte === 0));
  return value;
}
function fountainEquationCount(k) {
  if (!Number.isInteger(k) || k < 1 || k > Math.ceil(MAX_FILE_BYTES / CHUNK_BYTES)) {
    throw new RangeError("Invalid fountain source block count.");
  }
  const count = Math.max(8, Math.ceil(k * (1 + FOUNTAIN_OVERHEAD)) + FOUNTAIN_EXTRA_EQUATIONS);
  if (count > MAX_FOUNTAIN_FRAMES) throw new RangeError("Fountain equation limit exceeded.");
  return count;
}
function fountainSessionSeed(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) throw new TypeError("Invalid fountain session ID.");
  let seed = 0x811c9dc5;
  for (const byte of bytes) seed = Math.imul(seed ^ byte, 0x01000193);
  return seed >>> 0;
}
function splitmix32(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let value = state ^ (state >>> 16);
    value = Math.imul(value, 0x21f0aaad); value ^= value >>> 15;
    value = Math.imul(value, 0x735a2d97); value ^= value >>> 15;
    return value >>> 0;
  };
}
const LN2 = 0.6931471805599453;
function dlog(x) {
  let exponent = 0, mantissa = x;
  while (mantissa >= 1.5) { mantissa /= 2; exponent++; }
  while (mantissa < .75) { mantissa *= 2; exponent--; }
  const z = (mantissa - 1) / (mantissa + 1), z2 = z * z;
  let term = z, sum = 0;
  for (let n = 1; n <= 21; n += 2) { sum += term / n; term *= z2; }
  return exponent * LN2 + 2 * sum;
}
function solitonCdf(k) {
  const cdf = new Float64Array(k);
  if (k === 1) { cdf[0] = 1; return cdf; }
  const radius = Math.max(1, .1 * dlog(k / .5) * Math.sqrt(k));
  const spike = Math.min(k, Math.ceil(k / radius));
  let total = 0;
  for (let degree = 1; degree <= k; degree++) {
    const rho = degree === 1 ? 1 / k : 1 / (degree * (degree - 1));
    let tau = 0;
    if (degree < spike) tau = radius / (degree * k);
    else if (degree === spike) tau = radius * Math.max(0, dlog(radius / .5)) / k;
    total += rho + tau; cdf[degree - 1] = total;
  }
  for (let i = 0; i < k; i++) cdf[i] /= total;
  cdf[k - 1] = 1;
  return cdf;
}
function frameSeed(sessionSeed, sequence) {
  let hash = (Math.imul((sessionSeed + 1) | 0, 0x9e3779b1) ^ ((sequence + 0x85ebca6b) | 0)) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) | 0;
}
function frameIndices(k, cdf, sessionSeed, sequence) {
  if (sequence >= SYSTEMATIC_SEQUENCE_BASE && sequence < SYSTEMATIC_SEQUENCE_BASE + k) {
    return [sequence - SYSTEMATIC_SEQUENCE_BASE];
  }
  const firstParitySequence = fountainSequenceForEquation(k, k, fountainEquationCount(k));
  if (sequence === firstParitySequence) return Array.from({length: k}, (_, index) => index);
  const random = splitmix32(frameSeed(sessionSeed, sequence));
  const sample = random() * 2 ** -32;
  let low = 0, high = k - 1;
  while (low < high) { const mid = (low + high) >> 1; if (cdf[mid] >= sample) high = mid; else low = mid + 1; }
  const degree = Math.min(k, low + 1);
  if (degree > k >> 3) {
    const scratch = new Uint32Array(k); for (let i = 0; i < k; i++) scratch[i] = i;
    const out = new Array(degree);
    for (let i = 0; i < degree; i++) { const j = i + random() % (k - i); const value = scratch[i]; scratch[i] = scratch[j]; scratch[j] = value; out[i] = scratch[i]; }
    return out;
  }
  const selected = new Set(); while (selected.size < degree) selected.add(random() % k);
  return [...selected];
}
function fountainMidpoint(k, equationCount) {
  return Math.max(k, Math.ceil(equationCount / 2));
}
function fountainSequenceForEquation(equation, k, equationCount) {
  if (!Number.isInteger(equation) || equation < 0 || equation >= equationCount) {
    throw new RangeError("Invalid fountain equation ordinal.");
  }
  const midpoint = fountainMidpoint(k, equationCount);
  return SYSTEMATIC_SEQUENCE_BASE + equation + (equation >= midpoint ? MID_MANIFEST_COPIES : 0);
}
function xorInto(target, source) {
  for (let i = 0; i < target.length; i++) target[i] = (target[i] ^ source[i]) >>> 0;
}
class LTEncoder {
  constructor(payload, blockLen, sessionBytes) {
    if (!(payload instanceof Uint8Array) || payload.length < 1 || payload.length > MAX_FILE_BYTES ||
        blockLen !== CHUNK_BYTES) throw new Error("Unsafe fountain encoder parameters.");
    this.blockLen = blockLen; this.sessionSeed = fountainSessionSeed(sessionBytes);
    this.k = Math.ceil(payload.length / blockLen); fountainEquationCount(this.k);
    this.words = Math.ceil(blockLen / 4); this.blocks = new Uint32Array(this.k * this.words);
    const bytes = new Uint8Array(this.blocks.buffer);
    for (let block = 0; block < this.k; block++) bytes.set(payload.subarray(block * blockLen,
      Math.min((block + 1) * blockLen, payload.length)), block * this.words * 4);
    this.cdf = solitonCdf(this.k);
  }
  encode(sequence) {
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 0xffffffff) throw new RangeError("Invalid fountain sequence.");
    const out = new Uint32Array(this.words);
    for (const block of frameIndices(this.k, this.cdf, this.sessionSeed, sequence)) {
      const offset = block * this.words;
      for (let word = 0; word < this.words; word++) out[word] = (out[word] ^ this.blocks[offset + word]) >>> 0;
    }
    return new Uint8Array(out.buffer, 0, this.blockLen);
  }
}
class LTDecoder {
  constructor(k, blockLen, sessionBytes, totalLen, equationLimit) {
    if (!Number.isInteger(k) || k < 1 || k > Math.ceil(MAX_FILE_BYTES / CHUNK_BYTES) ||
        blockLen !== CHUNK_BYTES || !Number.isInteger(totalLen) || totalLen < 1 ||
        totalLen > MAX_FILE_BYTES || k !== Math.ceil(totalLen / blockLen) ||
        equationLimit !== fountainEquationCount(k)) throw new Error("Unsafe fountain decoder parameters.");
    this.k = k; this.blockLen = blockLen; this.totalLen = totalLen;
    this.sessionSeed = fountainSessionSeed(sessionBytes); this.words = Math.ceil(blockLen / 4);
    this.cdf = solitonCdf(k); this.solved = new Array(k).fill(null);
    this.byBlock = new Map(); this.seen = new Map(); this.solvedCount = 0;
    this.framesNew = 0; this.framesDup = 0;
    this.maxFrames = Math.min(equationLimit, MAX_FOUNTAIN_FRAMES,
      Math.floor(MAX_FOUNTAIN_STORAGE_BYTES / (this.words * 4 * 2)));
    if (this.maxFrames < equationLimit) throw new Error("Fountain storage ceiling is too small.");
  }
  get isComplete() { return this.solvedCount >= this.k; }
  addFrame(sequence, block) {
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 0xffffffff ||
        !(block instanceof Uint8Array) || block.length !== this.blockLen) throw new Error("Invalid fountain equation.");
    const prior = this.seen.get(sequence);
    if (prior) {
      this.framesDup++;
      if (!bytesEqual(prior, block)) throw new Error("A repeated fountain equation conflicts with accepted bytes.");
      return false;
    }
    if (this.seen.size >= this.maxFrames) throw new Error("The bounded fountain equation ceiling was reached without recovery.");
    this.seen.set(sequence, block.slice()); this.framesNew++;
    if (this.isComplete) return false;
    const indices = new Set(frameIndices(this.k, this.cdf, this.sessionSeed, sequence));
    const words = new Uint32Array(this.words); new Uint8Array(words.buffer).set(block);
    for (const index of [...indices]) { const solved = this.solved[index]; if (solved) { xorInto(words, solved); indices.delete(index); } }
    if (indices.size === 0) return true;
    if (indices.size === 1) { this.resolve(indices.values().next().value, words); return true; }
    const pending = {idx: indices, words};
    for (const index of indices) { let waiting = this.byBlock.get(index); if (!waiting) { waiting = new Set(); this.byBlock.set(index, waiting); } waiting.add(pending); }
    return true;
  }
  resolve(initialBlock, initialWords) {
    const queue = [[initialBlock, initialWords]];
    while (queue.length) {
      const [block, words] = queue.pop();
      if (this.solved[block]) continue;
      this.solved[block] = words; this.solvedCount++;
      const waiting = this.byBlock.get(block); if (!waiting) continue;
      this.byBlock.delete(block);
      for (const pending of waiting) {
        xorInto(pending.words, words); pending.idx.delete(block);
        if (pending.idx.size === 1) {
          const remaining = pending.idx.values().next().value;
          this.byBlock.get(remaining)?.delete(pending);
          if (!this.solved[remaining]) queue.push([remaining, pending.words]);
        }
      }
    }
  }
  assemble() {
    if (!this.isComplete) return null;
    const out = new Uint8Array(this.totalLen);
    for (let block = 0; block < this.k; block++) {
      const start = block * this.blockLen, length = Math.min(this.blockLen, this.totalLen - start);
      if (length > 0) out.set(new Uint8Array(this.solved[block].buffer, 0, length), start);
    }
    return out;
  }
  dispose() { this.byBlock.clear(); this.seen.clear(); this.solved.fill(null); }
}
function timeout(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out.`)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}
function activeHandle(handle) { return active === handle && generation === handle.generation && !handle.stopped; }

function resetDownload() {
  verifiedBytesForTest = null;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  downloadLink.hidden = true;
  downloadLink.removeAttribute("href");
  downloadLink.removeAttribute("download");
  integrityResult.className = "integrity idle";
  integrityResult.textContent = "No file has been verified.";
}
function clearReceiveState() {
  if (receiveState && receiveState.fountain) receiveState.fountain.dispose();
  receiveState = null;
}

async function teardown(handle) {
  if (!handle || handle.stopped) return;
  handle.stopped = true;
  clearInterval(handle.metricTimer);
  for (const pending of handle.encodes.values()) pending.reject(new DOMException("Transfer stopped", "AbortError"));
  for (const pending of handle.plays.values()) pending.reject(new DOMException("Transfer stopped", "AbortError"));
  handle.encodes.clear(); handle.plays.clear();
  try { handle.node && handle.node.port.postMessage({kind: "STOP", generation: handle.generation}); } catch (_) {}
  try { handle.worker && handle.worker.postMessage({kind: "STOP"}); } catch (_) {}
  if (handle.stream) for (const track of handle.stream.getTracks()) track.stop();
  try { handle.source && handle.source.disconnect(); } catch (_) {}
  try { handle.node && handle.node.disconnect(); } catch (_) {}
  try { handle.gain && handle.gain.disconnect(); } catch (_) {}
  if (handle.worker) {
    await new Promise(resolve => setTimeout(resolve, 30));
    handle.worker.terminate();
  }
  if (handle.context && handle.context.state !== "closed") await handle.context.close().catch(() => undefined);
  if (handle.workerUrl) URL.revokeObjectURL(handle.workerUrl);
  if (active === handle) active = null;
  if (handle.mode === "receive") {
    for (const id of ["stateListening", "stateSignal", "stateLocked"]) $(id).classList.remove("on");
    $("signalBar").style.width = "0";
  }
  startSendBtn.disabled = !sendFile.files.length;
  stopSendBtn.hidden = true;
  receiveBtn.disabled = false;
  stopReceiveBtn.hidden = true;
}

async function stopActive() {
  generation++;
  const handle = active;
  if (handle) await teardown(handle);
}

function createWorker(handle) {
  if (!EMBEDDED_MODEM_WORKER) return new Worker(SOURCE_WORKER_URL);
  handle.workerUrl = URL.createObjectURL(new Blob([EMBEDDED_MODEM_WORKER], {type: "text/javascript"}));
  return new Worker(handle.workerUrl);
}

async function createAudio(mode, stream = null) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor || !window.AudioWorkletNode || !window.Worker || !crypto.subtle) {
    throw new Error("This browser does not provide the required Web Audio, AudioWorklet, Worker, and Web Crypto APIs.");
  }
  const handle = {
    generation: ++generation, mode, stream, stopped: false, workerUrl: null,
    context: null, worker: null, node: null, gain: null, source: null,
    encodes: new Map(), plays: new Map(), nextRequest: 1, rxPending: 0,
    rxDrops: 0, pendingDiscontinuity: 0, preRoll: null, signalActive: false,
    lowBlocks: 0, noiseRms: .00004, lastRms: 0, lastPeak: 0, lastSignalAt: -Infinity,
    lastLockAt: -Infinity, metricTimer: 0,
  };
  active = handle;
  try {
    handle.context = new AudioContextCtor({latencyHint: "interactive"});
    await handle.context.resume();
    if (handle.context.sampleRate !== 44100 && handle.context.sampleRate !== 48000) {
      throw new Error(`Observed ${handle.context.sampleRate.toLocaleString()} Hz. Audio Transfer currently supports observed 44,100 or 48,000 Hz contexts.`);
    }
    const moduleUrl = EMBEDDED_WORKLET_DATA_URL || SOURCE_WORKLET_URL;
    await handle.context.audioWorklet.addModule(moduleUrl);
    if (!activeHandle(handle)) throw new DOMException("Start superseded", "AbortError");
    handle.node = new AudioWorkletNode(handle.context, "local-suite-acoustic-io", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: {generation: handle.generation, captureFrames: 4096},
    });
    handle.gain = handle.context.createGain();
    handle.gain.gain.value = mode === "send" ? 1 : 0;
    handle.node.connect(handle.gain).connect(handle.context.destination);
    if (stream) {
      handle.source = handle.context.createMediaStreamSource(stream);
      handle.source.connect(handle.node);
    }
    const workletReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("AudioWorklet did not become ready.")), 5000);
      handle.node.port.onmessage = event => {
        const message = event.data || {};
        if (message.generation !== handle.generation) return;
        if (message.kind === "READY") { clearTimeout(timer); resolve(message); return; }
        onWorkletMessage(handle, message);
      };
    });
    handle.worker = createWorker(handle);
    const workerReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Modem Worker did not become ready.")), 5000);
      handle.worker.onmessage = event => {
        const message = event.data || {};
        if (message.kind === "READY") { clearTimeout(timer); resolve(message); return; }
        onWorkerMessage(handle, message);
      };
      handle.worker.onerror = event => reject(new Error(event.message || "Modem Worker failed."));
    });
    handle.worker.postMessage({kind: "INIT", sampleRate: handle.context.sampleRate,
      generation: handle.generation});
    await Promise.all([workletReady, workerReady]);
    if (!activeHandle(handle)) throw new DOMException("Start superseded", "AbortError");
    return handle;
  } catch (error) {
    await teardown(handle);
    throw error;
  }
}

function onWorkletMessage(handle, message) {
  if (!activeHandle(handle)) return;
  if (message.kind === "PLAYED" || message.kind === "PLAY_REJECTED") {
    const pending = handle.plays.get(message.id);
    if (!pending) return;
    handle.plays.delete(message.id);
    if (message.kind === "PLAYED") pending.resolve();
    else pending.reject(new Error(message.reason || "Playback queue rejected a packet."));
  } else if (message.kind === "CAPTURE" && handle.mode === "receive") {
    handleCapture(handle, message);
  }
}

function onWorkerMessage(handle, message) {
  if (!activeHandle(handle)) return;
  if (message.kind === "ENCODED" || (message.kind === "ERROR" && message.id)) {
    const pending = handle.encodes.get(message.id);
    if (!pending) return;
    handle.encodes.delete(message.id);
    if (message.kind === "ENCODED") pending.resolve(message);
    else pending.reject(new Error(message.detail || "Packet encoding failed."));
  } else if (message.kind === "RX_ACK") {
    handle.rxPending = Math.max(0, handle.rxPending - 1);
    setText("rxQueue", `${handle.rxPending} / ${MAX_RX_PENDING}`);
  } else if (message.kind === "RX_FRAME") {
    handle.lastLockAt = performance.now();
    handleRxFrame(handle, message).catch(error => failReceive(handle, error));
  } else if (message.kind === "RX_METRIC") {
    setText("rxDecoder", message.code === "DISCONTINUITY" ? "reacquiring" : message.code.toLowerCase());
  } else if (message.kind === "ERROR") {
    failReceive(handle, new Error(message.detail || "Receiver Worker failed."));
  }
}

function encodePacket(handle, packet) {
  return new Promise((resolve, reject) => {
    const id = handle.nextRequest++;
    handle.encodes.set(id, {resolve, reject});
    handle.worker.postMessage({kind: "ENCODE", id, packet});
  });
}
function playWaveform(handle, waveform) {
  return new Promise((resolve, reject) => {
    const id = handle.nextRequest++;
    handle.plays.set(id, {resolve, reject});
    handle.node.port.postMessage({kind: "PLAY", generation: handle.generation, id,
      samples: waveform}, [waveform.buffer]);
  });
}

function updateSignalUi(handle) {
  const now = performance.now();
  const signal = now - handle.lastSignalAt < 700;
  const locked = now - handle.lastLockAt < 3000;
  $("stateListening").classList.toggle("on", activeHandle(handle));
  $("stateSignal").classList.toggle("on", signal);
  $("stateLocked").classList.toggle("on", locked);
  const db = handle.lastRms > 0 ? 20 * Math.log10(handle.lastRms) : -120;
  $("signalBar").style.width = `${Math.max(0, Math.min(100, (db + 90) * (100 / 78)))}%`;
  setText("rxLevel", `${db.toFixed(1)} dBFS · peak ${handle.lastPeak.toFixed(3)}`);
}

function forwardCapture(handle, block, discontinuity = 0) {
  if (!(block && block.samples instanceof Float32Array)) return;
  if (handle.rxPending >= MAX_RX_PENDING) {
    handle.rxDrops++;
    handle.pendingDiscontinuity++;
    setText("rxDrops", String(handle.rxDrops));
    return;
  }
  const gaps = discontinuity + handle.pendingDiscontinuity;
  handle.pendingDiscontinuity = 0;
  handle.rxPending++;
  handle.worker.postMessage({kind: "RX_BLOCK", samples: block.samples,
    absoluteFrame: block.absoluteFrame, discontinuities: gaps}, [block.samples.buffer]);
}

function handleCapture(handle, message) {
  handle.lastRms = Number(message.rms) || 0;
  handle.lastPeak = Number(message.peak) || 0;
  const threshold = Math.max(.00005, Math.min(.02, handle.noiseRms * 2));
  const strong = handle.lastRms >= threshold;
  if (strong) {
    handle.lastSignalAt = performance.now();
    handle.lowBlocks = 0;
    if (!handle.signalActive) {
      handle.signalActive = true;
      handle.worker.postMessage({kind: "RX_RESET", discontinuity: true});
      if (handle.preRoll) forwardCapture(handle, handle.preRoll, 0);
      handle.preRoll = null;
    }
    forwardCapture(handle, message, 0);
  } else if (handle.signalActive) {
    forwardCapture(handle, message, 0);
    handle.lowBlocks++;
    if (handle.lowBlocks >= 5) {
      handle.signalActive = false;
      handle.lowBlocks = 0;
      handle.worker.postMessage({kind: "RX_RESET", discontinuity: false});
    }
  } else {
    handle.noiseRms = handle.noiseRms * .94 + handle.lastRms * .06;
    handle.preRoll = {samples: message.samples, absoluteFrame: message.absoluteFrame};
  }
  updateSignalUi(handle);
}

function makeManifest(file, fileBytes, digestBytes, sid) {
  let name = safeFileName(file.name);
  let value, bytes;
  const totalChunks = Math.ceil(fileBytes.length / CHUNK_BYTES);
  const equationCount = fountainEquationCount(totalChunks);
  do {
    value = {v: 2, name, type: safeMediaType(file.type), size: fileBytes.length,
      sha256: hex(digestBytes), chunkSize: CHUNK_BYTES,
      totalChunks, equationCount, dataProfile: "R1-BPSK",
      fountain: "lt-rsd-systematic-v2", session: hex(sid)};
    bytes = encoder.encode(JSON.stringify(value));
    if (bytes.length <= 512) return {value, bytes};
    name = Array.from(name).slice(0, -8).join("") || "transfer.bin";
  } while (name.length);
  throw new Error("The file metadata does not fit in an acoustic manifest.");
}

async function startSend() {
  const file = sendFile.files[0];
  if (!file) { setStatus(sendStatus, "Choose a file first.", "error"); return; }
  if (file.size < 1 || file.size > MAX_FILE_BYTES) {
    setStatus(sendStatus, `Choose a file from 1 byte through ${formatBytes(MAX_FILE_BYTES)}.`, "error");
    return;
  }
  await stopActive();
  startSendBtn.disabled = true; stopSendBtn.hidden = false;
  setProgress(sendProgress, sendBar, 0);
  setStatus(sendStatus, "Reading and hashing the file locally…");
  try {
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const digestBytes = await sha256(fileBytes);
    const sid = sessionId();
    const manifest = makeManifest(file, fileBytes, digestBytes, sid);
    const manifestId = await sha256(manifest.bytes);
    const manifestTag = u32(manifestId);
    setText("sendName", manifest.value.name);
    setText("sendSize", formatBytes(fileBytes.length));
    setText("sendSha", hex(digestBytes));
    setText("sendSession", hex(sid).slice(0, 12));
    const handle = await createAudio("send");
    setText("sendSampleRate", `${handle.context.sampleRate.toLocaleString()} Hz`);
    const totalChunks = manifest.value.totalChunks;
    const equationCount = manifest.value.equationCount;
    const fountain = new LTEncoder(fileBytes, CHUNK_BYTES, sid);
    const totalPackets = INITIAL_MANIFEST_COPIES + MID_MANIFEST_COPIES +
      equationCount + FIN_COPIES;
    let complete = 0, sequence = 1, airBytes = 0;
    const started = performance.now();

    async function emit(packetKind, bytes, index, repeat) {
      if (!activeHandle(handle)) throw new DOMException("Transfer stopped", "AbortError");
      const isData = packetKind === "data";
      const packet = {packetKind, bytes, index: isData ? index % totalChunks : index,
        fountain: isData, repeat, sequence: sequence++,
        sessionId: sid, manifestTag, totalChunks, manifestId, sha256: digestBytes,
        fileLength: fileBytes.length};
      setStatus(sendStatus, `Encoding ${isData ? `fountain equation ${index + 1}/${equationCount} · R1 BPSK` : `${packetKind} · C0 BPSK`}… Keep the sending speaker near the receiving microphone.`);
      const encoded = await encodePacket(handle, packet);
      setText("sendProfile", "C0 BPSK control · R1 BPSK data");
      setText("sendPacket", `${complete + 1} / ${totalPackets} · ${(encoded.metadata.durationSeconds).toFixed(2)} s`);
      await playWaveform(handle, encoded.waveform);
      complete++;
      airBytes += bytes ? bytes.length : 72;
      const elapsed = Math.max(.1, (performance.now() - started) / 1000);
      setText("sendRate", formatRate(airBytes, elapsed));
      setProgress(sendProgress, sendBar, complete / totalPackets);
      if (complete < totalPackets) {
        setStatus(sendStatus, "Packet sent. Holding a short quiet interval so the receiver can reacquire…");
        await new Promise(resolve => setTimeout(resolve, INTER_PACKET_GAP_MS));
      }
    }

    for (let copy = 0; copy < INITIAL_MANIFEST_COPIES; copy++) {
      await emit("manifest", manifest.bytes, 0, copy > 0);
    }
    const midpoint = fountainMidpoint(totalChunks, equationCount);
    for (let equation = 0; equation < equationCount; equation++) {
      if (equation === midpoint) {
        for (let copy = 0; copy < MID_MANIFEST_COPIES; copy++) {
          await emit("manifest", manifest.bytes, 0, true);
        }
      }
      if (sequence !== fountainSequenceForEquation(equation, totalChunks, equationCount)) {
        throw new Error("The acoustic fountain schedule is inconsistent.");
      }
      const equationBytes = fountain.encode(sequence);
      await emit("data", equationBytes, equation, false);
    }
    for (let copy = 0; copy < FIN_COPIES; copy++) await emit("fin", null, 0, copy > 0);
    setStatus(sendStatus, `Transfer complete · ${totalPackets} audible packets · ${formatRate(airBytes, Math.max(.1, (performance.now() - started) / 1000))} actual acoustic payload rate.`, "good");
    await teardown(handle);
  } catch (error) {
    if (error && error.name !== "AbortError") setStatus(sendStatus, error.message || String(error), "error");
    if (active) await teardown(active);
  }
}

function processingRow(name, requested, supported, effective) {
  setText(`${name}Requested`, requested);
  setText(`${name}Supported`, supported ? "yes" : "no");
  setText(`${name}Effective`, effective === undefined ? "—" : (effective ? "on" : "off"));
}

async function startReceive() {
  await stopActive();
  resetDownload();
  receiveProgress.classList.remove("error");
  clearReceiveState();
  setProgress(receiveProgress, receiveBar, 0);
  setText("rxName", "—"); setText("rxSize", "—"); setText("rxSession", "—");
  setText("rxRate", "—"); setText("rxPackets", "0"); setText("rxDrops", "0");
  setText("rxProfile", "C0 BPSK + R1 BPSK");
  setText("rxDecoder", "idle"); setText("rxQueue", `0 / ${MAX_RX_PENDING}`);
  const media = navigator.mediaDevices;
  if (!media || typeof media.getUserMedia !== "function") {
    setStatus(receiveStatus, "Microphone access is unavailable here. Open the built page from hosted HTTPS (localhost also works in desktop browsers).", "error");
    return;
  }
  const supported = media.getSupportedConstraints ? media.getSupportedConstraints() : {};
  processingRow("ec", "off", !!supported.echoCancellation);
  processingRow("ns", "off", !!supported.noiseSuppression);
  processingRow("agc", "off", !!supported.autoGainControl);
  receiveBtn.disabled = true; stopReceiveBtn.hidden = false;
  setStatus(receiveStatus, "Requesting microphone permission…");
  let stream;
  try {
    stream = await media.getUserMedia({audio: {
      channelCount: {ideal: 1}, echoCancellation: {ideal: false},
      noiseSuppression: {ideal: false}, autoGainControl: {ideal: false},
    }, video: false});
    const track = stream.getAudioTracks()[0];
    const settings = track && track.getSettings ? track.getSettings() : {};
    processingRow("ec", "off", !!supported.echoCancellation, settings.echoCancellation);
    processingRow("ns", "off", !!supported.noiseSuppression, settings.noiseSuppression);
    processingRow("agc", "off", !!supported.autoGainControl, settings.autoGainControl);
    const handle = await createAudio("receive", stream);
    setText("rxSampleRate", `${handle.context.sampleRate.toLocaleString()} Hz`);
    setText("rxDevice", settings.deviceId ? "selected input" : "browser default input");
    setText("rxChannels", settings.channelCount ? String(settings.channelCount) : "1 requested");
    handle.metricTimer = setInterval(() => updateSignalUi(handle), 250);
    updateSignalUi(handle);
    setText("rxDecoder", "searching");
    setStatus(receiveStatus, "Listening. Start the sender nearby; keep the microphone unobstructed and the speaker at a comfortable volume.", "good");
  } catch (error) {
    if (stream) for (const track of stream.getTracks()) track.stop();
    const message = error && error.name === "NotAllowedError" ?
      "Microphone permission was denied. Allow it in the browser’s site controls, then try Receive again." :
      (error.message || String(error));
    setStatus(receiveStatus, message, "error");
    if (active) await teardown(active);
  }
}

function parseManifest(bytes, frame) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 512) throw new Error("Invalid acoustic manifest length.");
  const value = JSON.parse(decoder.decode(bytes));
  if (!value || value.v !== 2 || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_FILE_BYTES ||
      value.chunkSize !== CHUNK_BYTES || !Number.isSafeInteger(value.totalChunks) ||
      value.totalChunks !== Math.ceil(value.size / CHUNK_BYTES) || value.totalChunks !== frame.totalChunks ||
      !Number.isSafeInteger(value.equationCount) || value.equationCount !== fountainEquationCount(value.totalChunks) ||
      value.dataProfile !== "R1-BPSK" || value.fountain !== "lt-rsd-systematic-v2" || frame.profileId !== 1) {
    throw new Error("Acoustic manifest limits or coding contract are invalid.");
  }
  const expected = fromHex(value.sha256, 32);
  const sid = fromHex(value.session, 16);
  if (!bytesEqual(sid, frame.sessionId)) throw new Error("Manifest session ID does not match its frame.");
  return {value: {...value, name: safeFileName(value.name), type: safeMediaType(value.type)}, expected};
}

async function handleRxFrame(handle, frame) {
  if (!activeHandle(handle)) return;
  setText("rxPackets", String((Number($("rxPackets").textContent) || 0) + 1));
  const sidHex = hex(frame.sessionId);
  if (frame.type === 5) {
    const parsed = parseManifest(frame.bytes, frame);
    const manifestId = await sha256(frame.bytes);
    if (u32(manifestId) !== frame.manifestTag) throw new Error("Manifest identity tag mismatch.");
    if (receiveState) {
      if (receiveState.sidHex !== sidHex || !bytesEqual(receiveState.manifestId, manifestId)) return;
    } else {
      const fountain = new LTDecoder(parsed.value.totalChunks, parsed.value.chunkSize,
        frame.sessionId, parsed.value.size, parsed.value.equationCount);
      receiveState = {
        sidHex, manifestId, tag: frame.manifestTag, manifest: parsed.value,
        expected: parsed.expected, fountain, uniqueBytes: 0,
        started: performance.now(), finSeen: false, finishing: false,
      };
      setText("rxName", parsed.value.name);
      setText("rxSize", formatBytes(parsed.value.size));
      setText("rxSession", sidHex.slice(0, 12));
      setText("rxProfile", "C0 BPSK control · R1 BPSK data");
      setText("rxDecoder", "C0 manifest + CRC32C");
      setStatus(receiveStatus, `Locked to ${parsed.value.name}. Solving ${parsed.value.totalChunks} source blocks from up to ${parsed.value.equationCount} fountain equations…`, "good");
    }
    return;
  }
  const state = receiveState;
  if (!state || state.sidHex !== sidHex || state.tag !== frame.manifestTag ||
      state.manifest.totalChunks !== frame.totalChunks) return;
  if (frame.type === 16) {
    if (frame.profileId !== 16 || frame.fountain !== true ||
        !Number.isSafeInteger(frame.index) || frame.index < 0 || frame.index >= state.manifest.totalChunks ||
        !Number.isSafeInteger(frame.sequence) || !(frame.bytes instanceof Uint8Array) ||
        frame.bytes.length !== CHUNK_BYTES) throw new Error("Received DATA does not match the R1-BPSK fountain contract.");
    state.fountain.addFrame(frame.sequence, frame.bytes);
    state.uniqueBytes = Math.min(state.manifest.size, state.fountain.solvedCount * CHUNK_BYTES);
    const fraction = state.fountain.solvedCount / state.fountain.k;
    setProgress(receiveProgress, receiveBar, Math.min(.99, fraction));
    setText("rxRate", formatRate(state.uniqueBytes, Math.max(.1, (performance.now() - state.started) / 1000)));
    setText("rxProfile", "C0 BPSK control · R1 BPSK data");
    setText("rxDecoder", `R1 BPSK · ${state.fountain.solvedCount}/${state.fountain.k} solved`);
    setStatus(receiveStatus, `${state.manifest.name} · ${state.fountain.solvedCount}/${state.fountain.k} source blocks solved from ${state.fountain.framesNew}/${state.manifest.equationCount} CRC-valid equations.`, "good");
    await maybeFinish(handle, state);
  } else if (frame.type === 23) {
    if (frame.profileId !== 1 || !bytesEqual(frame.manifestId, state.manifestId) ||
        !bytesEqual(frame.sha256, state.expected) || frame.fileLength !== state.manifest.size) {
      throw new Error("Final acoustic identity does not match the locked manifest.");
    }
    state.finSeen = true;
    if (!state.fountain.isComplete) {
      setStatus(receiveStatus, `Final identity received, but ${state.fountain.k - state.fountain.solvedCount} source blocks remain unsolved. Download withheld.`, "error");
    }
    await maybeFinish(handle, state);
  }
}

async function maybeFinish(handle, state) {
  if (state.finishing || !state.fountain.isComplete) return;
  if (!state.finSeen) {
    setProgress(receiveProgress, receiveBar, .99);
    setStatus(receiveStatus, "All source blocks solved. Waiting for the repeated C0 final identity packet…", "good");
    return;
  }
  state.finishing = true;
  setProgress(receiveProgress, receiveBar, .99);
  setStatus(receiveStatus, "Fountain recovery complete. Computing final SHA-256 locally…");
  const bytes = state.fountain.assemble();
  if (!(bytes instanceof Uint8Array) || bytes.length !== state.manifest.size) {
    throw new Error("Fountain reconstruction did not produce the declared file length.");
  }
  const actual = await sha256(bytes);
  if (!bytesEqual(actual, state.expected)) throw new Error("SHA-256 mismatch. No download was created; recovered bytes were discarded.");
  verifiedBytesForTest = bytes.slice();
  state.fountain.dispose();
  downloadUrl = URL.createObjectURL(new Blob([bytes], {type: state.manifest.type}));
  downloadLink.href = downloadUrl;
  downloadLink.download = state.manifest.name;
  downloadLink.textContent = `Download ${state.manifest.name}`;
  downloadLink.hidden = false;
  integrityResult.className = "integrity verified";
  integrityResult.textContent = `SHA-256 verified · ${hex(actual)}`;
  setProgress(receiveProgress, receiveBar, 1);
  setStatus(receiveStatus, `${state.manifest.name} recovered exactly. SHA-256 verified; download is ready.`, "good");
  await teardown(handle);
}

async function failReceive(handle, error) {
  if (!activeHandle(handle)) return;
  resetDownload();
  clearReceiveState();
  integrityResult.className = "integrity failed";
  integrityResult.textContent = "Integrity failed · download withheld";
  receiveProgress.classList.add("error");
  setStatus(receiveStatus, error.message || String(error), "error");
  await teardown(handle);
}

function selectTab(mode) {
  const receive = mode === "receive";
  sendTab.setAttribute("aria-selected", String(!receive));
  receiveTab.setAttribute("aria-selected", String(receive));
  sendTab.tabIndex = receive ? -1 : 0; receiveTab.tabIndex = receive ? 0 : -1;
  sendPanel.hidden = receive; receivePanel.hidden = !receive;
  stopActive();
  clearReceiveState();
}

for (const tab of [sendTab, receiveTab]) {
  tab.addEventListener("click", () => selectTab(tab === receiveTab ? "receive" : "send"));
  tab.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const other = tab === sendTab ? receiveTab : sendTab;
      other.click(); other.focus();
    }
  });
}
sendFile.addEventListener("change", () => {
  const file = sendFile.files[0];
  startSendBtn.disabled = !file;
  if (!file) setStatus(sendStatus, "Choose a file to send.");
  else if (file.size < 1 || file.size > MAX_FILE_BYTES) setStatus(sendStatus,
    `${file.name} is ${formatBytes(file.size)}; Audio Transfer accepts 1 byte through ${formatBytes(MAX_FILE_BYTES)}.`, "error");
  else setStatus(sendStatus, `${safeFileName(file.name)} selected · ${formatBytes(file.size)}. SHA-256 will be computed before sound starts.`, "good");
});
startSendBtn.addEventListener("click", startSend);
stopSendBtn.addEventListener("click", async () => { await stopActive(); setStatus(sendStatus, "Transfer stopped. Speaker output and modem resources are closed."); });
receiveBtn.addEventListener("click", startReceive);
stopReceiveBtn.addEventListener("click", async () => { await stopActive(); clearReceiveState(); setStatus(receiveStatus, "Receiver stopped. Microphone tracks and modem resources are closed; partial equations were discarded."); });
resetReceiveBtn.addEventListener("click", async () => {
  await stopActive(); clearReceiveState(); resetDownload(); receiveProgress.classList.remove("error");
  setProgress(receiveProgress, receiveBar, 0); setStatus(receiveStatus, "Receiver reset. No partial payload remains in memory.");
});
window.addEventListener("pagehide", () => { generation++; if (active) teardown(active); clearReceiveState(); resetDownload(); });

Suite.theme.init();
processingRow("ec", "off", false);
processingRow("ns", "off", false);
processingRow("agc", "off", false);
async function feedDecodedFrame(frame) {
  if (!active || active.mode !== "receive") throw new Error("Receiver is not active.");
  const handle = active;
  try {
    return await handleRxFrame(handle, frame);
  } catch (error) {
    if (activeHandle(handle)) await failReceive(handle, error);
  }
}
window.AcousticTransferTest = Object.freeze({MAX_FILE_BYTES, CHUNK_BYTES, MAX_FOUNTAIN_FRAMES,
  SYSTEMATIC_SEQUENCE_BASE,
  safeFileName, safeMediaType, bytesEqual, hex, fromHex, sha256, u32, fountainEquationCount,
  fountainSessionSeed, solitonCdf, frameIndices, fountainMidpoint, fountainSequenceForEquation,
  LTEncoder, LTDecoder,
  makeManifest, parseManifest, feedDecodedFrame,
  getVerifiedBytes: () => verifiedBytesForTest ? verifiedBytesForTest.slice() : null});
})();
