/* Deterministic production modem loopback for both supported sample rates and profiles.
   Exercises the actual PHY decoder, including acquisition beyond the old 4,096-sample window.
   Run: node tests/audio-modem.mjs */
globalThis.self = globalThis;
await import("../assets/acoustic/app/modem-core.js");

const A = globalThis.AcousticV1;
const C = A.Constants;
const PRE_ROLL = 6144;
const checks = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) checks.push(name);
};

for (const sampleRate of [44100, 48000]) {
  for (const profileId of [C.PROFILES.C0, C.PROFILES.R1]) {
    const isData = profileId === C.PROFILES.R1;
    const payload = isData
      ? Uint8Array.from({length: 512}, (_, i) => i & 255)
      : new TextEncoder().encode('{"v":2,"test":true}');
    const payloadRecord = isData ? {chunkIndex: 0, bytes: payload} : {fragment: payload};
    const frame = {
      type: isData ? C.FRAME_TYPES.DATA : C.FRAME_TYPES.MANIFEST,
      flags: isData ? C.FLAGS.MORE : C.FLAGS.FINAL,
      profileId,
      fecId: C.FECS.K7_R12,
      epoch: 0,
      sequence: 7,
      sessionId: Uint8Array.from({length: 16}, (_, i) => i),
      manifestTag: 0x12345678,
      windowSize: 8,
      totalChunks: 1,
      primaryIndex: 0,
      itemCount: isData ? 1 : payload.length,
      payloadRecord,
    };
    const label = `${sampleRate} Hz ${isData ? "R1-BPSK DATA" : "C0-BPSK manifest"}`;
    const wire = A.Wire.encodeFrame(frame);
    check(`${label} wire encode`, wire.ok, wire.detail || wire.code);
    if (!wire.ok) continue;
    const encoded = A.PhyTx.encodeFrame(wire.value, {sampleRate, profileId});
    check(`${label} waveform encode`, encoded.ok, encoded.detail || encoded.code);
    if (!encoded.ok) continue;
    const capture = new Float32Array(PRE_ROLL + encoded.value.waveform.length);
    capture.set(encoded.value.waveform, PRE_ROLL);
    const decoded = A.PhyRx.decodeBurst(capture, sampleRate, profileId);
    check(`${label} decode after ${PRE_ROLL}-sample pre-roll`, decoded.ok,
      decoded.detail || decoded.code);
    if (!decoded.ok) continue;
    check(`${label} identity`, decoded.value.frame.sequence === frame.sequence &&
      decoded.value.frame.profileId === profileId &&
      decoded.value.metrics.acquisitionOffsetSamples > 4096 &&
      decoded.value.metrics.acquisitionOffsetSamples < PRE_ROLL + 512,
      JSON.stringify({sequence: decoded.value.frame.sequence,
        profileId: decoded.value.frame.profileId,
        offset: decoded.value.metrics.acquisitionOffsetSamples}));
    const recovered = isData ? decoded.value.frame.parsed.bytes : decoded.value.frame.parsed.fragment;
    check(`${label} exact payload`, A.Bytes.equal(recovered, payload));
  }
}

console.log(checks.length ? `\naudio modem: ${checks.length} FAILURE(S)` : "\naudio modem: PASS");
process.exitCode = checks.length ? 1 : 0;
