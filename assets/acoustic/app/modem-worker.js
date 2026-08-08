"use strict";

/* In source/hosted development this import is used. build.py removes it and
   prepends the exact same modem-core.js bytes to the embedded production Worker. */
importScripts("./modem-core.js");

const A = self.AcousticV1;
const C = A.Constants;
const T = C.FRAME_TYPES;
const F = C.FLAGS;
let sampleRate = 0;
let receiver = null;
let rxGeneration = 0;

function fail(id, error) {
  const detail = error && error.code ? `${error.code}${error.detail ? `: ${error.detail}` : ""}` :
    String(error && error.message ? error.message : error);
  postMessage({kind: "ERROR", id, detail: detail.slice(0, 240)});
}

function requireBytes(value, length, label) {
  if (!(value instanceof Uint8Array) || (length !== undefined && value.length !== length)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function encodePacket(packet) {
  const sessionId = requireBytes(packet.sessionId, 16, "session ID");
  const common = {
    flags: packet.repeat ? F.RETRANSMIT : 0,
    profileId: C.PROFILES.C0,
    fecId: C.FECS.K7_R12,
    epoch: 0,
    sequence: packet.sequence,
    sessionId,
    manifestTag: packet.manifestTag,
    windowSize: 8,
    totalChunks: packet.totalChunks,
  };
  let frame;
  if (packet.packetKind === "manifest") {
    const fragment = requireBytes(packet.bytes, undefined, "manifest");
    frame = {...common, type: T.MANIFEST, flags: common.flags | F.FINAL,
      primaryIndex: 0, itemCount: fragment.length, payloadRecord: {fragment}};
  } else if (packet.packetKind === "data") {
    const bytes = requireBytes(packet.bytes, undefined, "chunk");
    frame = {...common, type: T.DATA, primaryIndex: packet.index, itemCount: 1,
      payloadRecord: {chunkIndex: packet.index, bytes}};
  } else if (packet.packetKind === "fin") {
    frame = {...common, type: T.FIN, flags: common.flags | F.FINAL,
      primaryIndex: packet.totalChunks, itemCount: 0,
      payloadRecord: {
        manifestId: requireBytes(packet.manifestId, 32, "manifest ID"),
        expectedSha256: requireBytes(packet.sha256, 32, "SHA-256"),
        fileLength: BigInt(packet.fileLength),
      }};
  } else {
    throw new TypeError("unknown packet kind");
  }
  const wire = A.Wire.encodeFrame(frame);
  if (!wire.ok) throw wire;
  const encoded = A.PhyTx.encodeFrame(wire.value, {sampleRate, profileId: C.PROFILES.C0});
  if (!encoded.ok) throw encoded;
  return encoded.value;
}

function summarizeFrame(frame, metrics) {
  const base = {
    kind: "RX_FRAME",
    type: frame.type,
    flags: frame.flags,
    sequence: frame.sequence,
    sessionId: frame.sessionId,
    manifestTag: frame.manifestTag,
    primaryIndex: frame.primaryIndex,
    totalChunks: frame.totalChunks,
    metrics,
  };
  if (frame.type === T.MANIFEST) base.bytes = frame.parsed.fragment;
  else if (frame.type === T.DATA) {
    base.index = frame.parsed.chunkIndex;
    base.bytes = frame.parsed.bytes;
    base.chunkCrc = frame.parsed.chunkCrc;
  } else if (frame.type === T.FIN) {
    base.manifestId = frame.parsed.manifestId;
    base.sha256 = frame.parsed.expectedSha256;
    base.fileLength = Number(frame.parsed.fileLength);
  } else return null;
  return base;
}

self.onmessage = event => {
  const message = event.data || {};
  try {
    if (message.kind === "INIT") {
      if (message.sampleRate !== 44100 && message.sampleRate !== 48000) {
        throw new RangeError("AudioContext must run at 44,100 or 48,000 Hz");
      }
      sampleRate = message.sampleRate;
      rxGeneration = message.generation || 0;
      const created = A.PhyRx.create({sampleRate, profileId: C.PROFILES.C0});
      if (!created.ok) throw created;
      receiver = created.value;
      postMessage({kind: "READY", generation: rxGeneration, sampleRate});
      return;
    }
    if (!sampleRate) throw new Error("worker is not initialized");
    if (message.kind === "ENCODE") {
      const encoded = encodePacket(message.packet);
      postMessage({kind: "ENCODED", id: message.id, waveform: encoded.waveform,
        metadata: encoded.metadata}, [encoded.waveform.buffer]);
      return;
    }
    if (message.kind === "RX_RESET") {
      receiver.reset(!!message.discontinuity);
      return;
    }
    if (message.kind === "RX_BLOCK") {
      if (!(message.samples instanceof Float32Array)) throw new TypeError("invalid capture block");
      const events = receiver.push(message.samples, message.absoluteFrame, message.discontinuities || 0);
      for (const item of events) {
        if (item.kind === "RX_FRAME") {
          const summary = summarizeFrame(item.frame, item.metrics);
          if (summary) postMessage(summary);
        } else if (item.kind === "METRIC") {
          postMessage({kind: "RX_METRIC", code: item.code, count: item.count || 0});
        }
      }
      postMessage({kind: "RX_ACK", generation: rxGeneration,
        snapshot: receiver.snapshotMetrics()});
      return;
    }
    if (message.kind === "STOP") {
      receiver = null;
      sampleRate = 0;
      postMessage({kind: "STOPPED", generation: rxGeneration});
      close();
    }
  } catch (error) {
    fail(message.id, error);
  }
};
