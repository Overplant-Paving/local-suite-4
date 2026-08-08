# Acoustic Modem Architecture Contract

Status: Stage A3 contract aligned to the 2026-08-07 G1 disposition
Current gate: Stage B / G2 Lane 1; see `G1_DISPOSITION.md` and `IMPLEMENTATION_PLAN.md`

## 1. Scope and invariants

The planned tool transfers bounded arbitrary binary content over a genuine speaker-to-microphone
audio path. It has no WebRTC, network, server, relay, Bluetooth, Wi-Fi, account, or alternate
payload path. “Arbitrary binary” means any byte content and advisory media type from 1 byte through
the published 16 MiB limit; it never means unbounded size.

These Local Suite invariants are not relaxed:

- source is edited outside `dist/`; generated output is committed and never hand-edited;
- each generated tool is one self-contained HTML file with no runtime dependency or asset fetch;
- direct `file://` operation remains an acceptance requirement unless the project explicitly
  changes that product contract after the mandatory feasibility gate;
- PWA behavior is additive and hosted-only;
- CSP exceptions are per tool and no broader than demonstrated need;
- no framework, bundler, required service, hidden network path, or `SharedArrayBuffer` is introduced;
- Optical Transfer's DCF2/LT/QR implementation is a pattern reference, not a shared wire protocol.

Acoustic v1 is an unauthenticated, unencrypted public local channel. Encryption and sender
authentication are deferred. Unsupported security flags fail closed.

## 2. Decisions frozen now and decisions gated by evidence

### Frozen contracts

- Protocol v1 byte order, frame fields, bounds, state semantics, CRC32C convention, manifest
  identity, durable ACK meaning, duplicate handling, and final SHA-256 gate are specified in
  `PROTOCOL.md`.
- Layer boundaries and the APIs in this document are stable for downstream lanes.
- The initial file limit is 16 MiB; the hash strategy uses bounded whole-buffer Web Crypto.
- The runtime uses one AudioWorklet for bounded audio I/O, one dedicated Worker for protocol/DSP,
  transferred fixed-size buffers, and no shared memory.
- The source uses ordered classic scripts and one global namespace, then is deterministically
  embedded into the generated page.
- The generated product uses the build-time `data:text/javascript;base64,...` AudioWorklet module
  selected in `G1_DISPOSITION.md`; direct-file mode has no Blob or runtime module-fetch fallback.
- Received chunks and their receipt state are atomically committed before ACK.
- Settings JSON backup excludes acoustic IndexedDB sessions and must say so.
- Baseline FEC is an owned constraint-length-7 convolutional code with soft Viterbi decoding; no
  external modem runtime or outer Reed–Solomon code is part of v1.

### Still provisional after G1

- supported browser/launch-mode matrix beyond the verified desktop Chromium/API subset, including
  physical microphone/speaker use, Android, and OS-installed-device behavior;
- direct Worklet-to-Worker port transfer versus bounded main-thread relay;
- exact OFDM profile parameters beyond the profile registry ranges in `DSP_DESIGN.md`;
- control repetition, burst duration, tail guard, and ACK timeout values;
- punctured FEC modes, fast QPSK profile, near-ultrasonic, wired/stretch, 16-QAM, and WAV tooling;
- the 16 MiB limit itself if bounded digest/Blob memory fails on minimum hardware;
- any payload-goodput, reliability, distance, safe-volume, or compatibility statement.

A provisional parameter may be tightened or disabled without changing the logical API. A change to
frozen on-wire meaning requires a protocol version change.

## 3. Layer boundaries

| Layer | Owns | Must not own |
|---|---|---|
| Application | DOM, accessibility, file selection, permission disclosure, progress vocabulary, user actions | Wire parsing, FEC, sample processing |
| Transfer/session | Roles, negotiation, turn/epoch state, selective-repeat ARQ, retries, resume reconciliation, completion | DOM, AudioContext, FFT |
| Framing/coding | Canonical manifest, byte serialization, CRC32C, whitening, FEC, interleaving, parser limits | Browser lifecycle, storage, waveform timing |
| DSP/PHY | Profiles, preamble, FFT/IFFT, modulation, acquisition, CFO/SRO, channel estimate, equalization, soft metrics | IndexedDB, downloads, permission UI |
| Browser runtime | AudioContext/MediaStream/AudioWorklet/Worker orchestration, buffer pools, device lifecycle | Protocol policy and unbounded DSP work |
| Persistence | IndexedDB transactions, durable receipt pages, tombstones, quota/corruption/cleanup | ACK policy decisions, audio, DOM rendering |
| Simulation/evidence | Seeded channel transformations, measurements, evidence labels | Product success claims or hidden production fallback |

Lane 1 pure modules have no DOM, Web Audio, Worker-global assumption, IndexedDB, timers, or random
source hidden inside them. Time, randomness, storage, and channel effects enter through explicit
arguments or adapters.

## 4. Stable API surface

All results use discriminated records. Hostile-input rejection is a normal `{ok:false, code,
detail?}` result; parser and decoder entry points do not throw after receiving bytes. Programmer
misuse may throw during construction.

```text
AcousticV1.Bytes.read/write methods(bytes, offset, value) -> bounded result
AcousticV1.Crc32c.digest(bytes, seed?) -> uint32
AcousticV1.Sha256.digestBounded(buffer, maxBytes) -> Promise<Result<32-byte digest>>

AcousticV1.Wire.encodeFrame(frame, limits) -> Result<Uint8Array>
AcousticV1.Wire.decodeFrame(bytes, limits) -> Result<DecodedFrame>
AcousticV1.Manifest.encode(record, limits) -> Result<Uint8Array>
AcousticV1.Manifest.parse(bytes, limits) -> Result<Manifest>
AcousticV1.Manifest.id(canonicalBytes) -> Promise<32-byte SHA-256>

AcousticV1.ArqSender.create(config, snapshot?) -> ArqSender
ArqSender.nextBurst(audioNow, budget) -> FrameIntent[]
ArqSender.acceptAck(ack, audioNow) -> Transition[]
ArqSender.onTimeout(audioNow) -> Transition[]
ArqSender.snapshot() -> PersistableSenderState

AcousticV1.ArqReceiver.create(config, snapshot?) -> ArqReceiver
ArqReceiver.classifyChunk(meta) -> new | exactDuplicate | conflict | outOfRange
ArqReceiver.commitResult(chunkIndex, durableResult) -> Transition[]
ArqReceiver.makeAck(maxPayloadBytes) -> AckRecord
ArqReceiver.snapshot() -> PersistableReceiverState

AcousticV1.Session.reduce(state, event) -> {state, effects[]}
AcousticV1.Profiles.plan(profileId, gridSampleRate) -> Result<CarrierPlan>
AcousticV1.PhyTx.encode(intent, plan, outputPool) -> Result<PcmDescriptor[]>
AcousticV1.PhyRx.push(block, absoluteFrame, discontinuities) -> FrameEvent[] | MetricEvent[]
AcousticV1.Channel.run(seed, config, inputPcm) -> {pcm, record}
```

The session reducer is the sole owner of state transitions. Effects such as `TRANSMIT`,
`STORE_CHUNK`, `LOAD_RESUME`, `REQUEST_PERMISSION`, `START_HASH`, and `STOP_AUDIO` are executed by
the browser controller and returned as new events. This makes cancel, late-promise, timeout, and
resume races deterministic in tests.

### Browser adapters

```text
AudioRuntime.probe() -> CapabilityReport
AudioRuntime.start({role, requestedProcessing, onBlock, onState}) -> Promise<Result<RuntimeReport>>
AudioRuntime.queueTx(descriptors) -> Result
AudioRuntime.pause(reason) -> Promise<void>
AudioRuntime.stop(reason) -> Promise<void>

WorkerClient.start(config) -> Promise<Result>
WorkerClient.request(kind, payload, transferList?) -> Promise<Result>
WorkerClient.stop(reason) -> void

SessionStore.open() -> Promise<Result<StoreReport>>
SessionStore.preflight(requiredBytes) -> Promise<Result<QuotaReport>>
SessionStore.commitChunk(manifestId, chunk, receiptDelta) -> Promise<Result<CommitReceipt>>
SessionStore.loadResume(manifestId) -> Promise<Result<ResumeSnapshot>>
SessionStore.markVerified(manifestId, hash, receipt) -> Promise<Result>
SessionStore.list() / delete(manifestId) / cleanup(policy) -> Promise<Result>
```

`commitChunk` resolves successfully only after the multi-store transaction's `complete` event. The
receiver may advertise that chunk in an ACK only after that result returns.

## 5. Namespace, loading, and test seams

The no-framework source convention is strict-mode classic JavaScript:

- pure modules attach one frozen sub-namespace to `globalThis.AcousticV1`;
- app modules attach to `window.AcousticV1App` and consume only the frozen Lane 1 API;
- Worker messages use the numeric API version `1` and the schemas below;
- the AudioWorklet is one flat file and does not import application or DSP modules;
- there are no browser ES-module imports, dynamic source discovery, or order-dependent directory
  scans.

Each module refuses to replace an existing namespace member. The only product globals are
`AcousticV1` and `AcousticV1App`. `window.AcousticModemTest` is a frozen, generated-page test seam
created by the page entry. It exposes constants, pure constructors, injected clock/random/media/
storage adapters, event snapshots, and teardown counters; it does not bypass verification or make
private payload bytes available to ordinary UI code.

Worker envelope:

```text
{api:1, id:uint32, kind:string, payload:bounded-record}
{api:1, id:uint32, ok:boolean, kind:string, payload?|error?}
```

Permitted main-to-Worker kinds are `INIT`, `RESET`, `RX_BLOCK`, `TX_INTENT`, `HASH_BUFFER`, and
`SIM_RUN`. Worker-to-main asynchronous kinds are `READY`, `TX_PCM`, `RX_FRAME`, `SESSION_EVENT`,
`METRICS`, `BACKPRESSURE`, and `FATAL`. Unknown kinds and API versions return a bounded error.

`RX_BLOCK` and `TX_PCM` transfer, rather than clone, typed-array buffers. A returned-buffer message
puts each buffer back in its fixed pool. No message contains DOM objects, `File`, IndexedDB handles,
or arbitrary object graphs.

## 6. Exact planned source organization and deterministic embedding

The implementation owns these source paths:

```text
tools/audio.html
assets/acoustic/
  protocol/constants.js
  protocol/bytes.js
  protocol/crc32c.js
  protocol/sha256.js
  protocol/whitening.js
  protocol/fec.js
  protocol/interleave.js
  protocol/wire.js
  protocol/manifest.js
  protocol/arq.js
  protocol/session.js
  dsp/fft.js
  dsp/profiles.js
  dsp/preamble.js
  dsp/resampler.js
  dsp/transmitter.js
  dsp/receiver.js
  sim/prng.js
  sim/channel.js
  sim/benchmark.js
  worker-entry.js
  app/audio-runtime.js
  app/worker-client.js
  app/session-store.js
  app/transfer-controller.js
  app/diagnostics.js
  app/ui.js
  app/page-entry.js
  worklet/audio-io.js
  bundles.json
```

`bundles.json` is strict JSON with schema version 1 and three explicit ordered arrays: `page`,
`worker`, and `worklet`. It contains repository-relative files only, rejects duplicates, traversal,
unknown fields, missing files, and any file not under `assets/acoustic/`. The worklet array contains
exactly `worklet/audio-io.js` in v1.

The v1 order is exact. `page` contains:

```text
protocol/constants.js
protocol/bytes.js
protocol/crc32c.js
protocol/sha256.js
protocol/wire.js
protocol/manifest.js
protocol/arq.js
protocol/session.js
app/audio-runtime.js
app/worker-client.js
app/session-store.js
app/transfer-controller.js
app/diagnostics.js
app/ui.js
app/page-entry.js
```

`worker` contains the dependencies below; `worker-entry.js` is the validated entry appended after
them and is not duplicated in the array:

```text
protocol/constants.js
protocol/bytes.js
protocol/crc32c.js
protocol/sha256.js
protocol/whitening.js
protocol/fec.js
protocol/interleave.js
protocol/wire.js
protocol/manifest.js
protocol/arq.js
protocol/session.js
dsp/fft.js
dsp/profiles.js
dsp/preamble.js
dsp/resampler.js
dsp/transmitter.js
dsp/receiver.js
sim/prng.js
sim/channel.js
sim/benchmark.js
```

`worklet` contains only `worklet/audio-io.js`. Page-side protocol/session modules are intentionally
small duplicates of Worker source so the controller can run the deterministic reducer and validate
messages without runtime imports. DSP, FEC, whitening, interleaving, and simulation remain Worker-
only.

Source mode remains runnable:

- `tools/audio.html` has explicit ordered `<script src="../assets/acoustic/..."
  data-suite-acoustic-page>` tags for every entry in the `page` array;
- `worker-entry.js` has one build-validated `importScripts(...)` prologue matching the `worker`
  dependency order when run from source;
- `AudioRuntime` loads `../assets/acoustic/worklet/audio-io.js` from source.

The future `build.py` transform is deterministic:

1. Validate that HTML page tags and Worker `importScripts` match `bundles.json` exactly.
2. Concatenate page files in declared order, with a stable path comment and one newline boundary,
   and replace the page tag block with one inline classic script.
3. Concatenate Worker dependencies plus `worker-entry.js`, remove only the validated import prologue,
   JSON-escape the result, and replace one `@suite:acoustic-worker` string marker.
4. Read the single flat worklet, JSON-escape it, and replace one `@suite:acoustic-worklet` marker.
5. Reject source maps, dynamic `import`, unlisted sources, unresolved markers, and output references
   to `../assets/acoustic/`.
6. Let the existing CSP-hash and staleness/PWA gates operate on the final generated HTML.

At runtime the generated page creates one Blob URL for the Worker and passes the build-time base64
data URL for the validated Worklet bytes to `audioWorklet.addModule()`. It revokes the Worker URL
after its `READY` handshake; teardown also revokes any survivor. Source mode uses relative files.
Generated mode makes zero runtime fetches and has no Blob-Worklet or module-network fallback.

The acoustic manifest entry will have no endpoints. It needs only tool-scoped `script-src data:` for
the AudioWorklet and `worker-src blob:` for the dedicated Worker. `connect-src` remains `'none'`.
The allowlist and generated CSP negative tests must reject use by any other tool unless separately
justified. A `script-src blob:` allowance used only by the spike's rejected dual-candidate matrix is
not inherited. Optical's exception and transform remain unchanged.

## 7. Audio runtime, sample rates, and bounded real-time behavior

Audio starts only from an explicit user gesture after an audible/recordable warning. Both peers need
speaker and microphone capability because ACKs use the reverse acoustic link.

The runtime requests mono capture with `echoCancellation`, `noiseSuppression`, and
`autoGainControl` set to `false` preferences. It records requested, supported, and effective track
settings separately. A request is never presented as proof that processing is disabled. It reports
the actual `AudioContext.sampleRate` and the negotiated PHY grid rate.

Protocol grids are defined for 44,100 and 48,000 Hz. A transmitter uses its actual supported context
rate as the grid when it is one of those values; otherwise a bounded resampler maps to a negotiated
supported grid or the transfer fails explicitly. A receiver searches both control grids during
discovery, then resamples its captured context stream to the peer's announced grid. Residual physical
clock error is handled as SRO; context rate alone is not treated as the microphone's physical clock.

Initial pool ceiling per direction is 16 buffers × 4096 mono `Float32` samples (256 KiB), for 512
KiB total capture/playback storage. Pool size and block size are constants, not user-controlled.
Observed worklet input/output arrays may have any positive render-quantum length and are copied into
the fixed blocks without assuming 128 frames.

The worklet performs only:

- bounded copies between render arrays and pool blocks;
- playback silence on underflow;
- capture drop on overflow;
- absolute frame/discontinuity counters;
- peak and clipping counters that require no allocation.

All FFT, resampling, FEC, hashing, framing, simulation, storage, JSON, and logging occur outside the
render callback. A discontinuity invalidates acquisition. Queues never grow to compensate.

The direct Worklet-to-Worker `MessageChannel` is preferred but provisional. If the browser matrix
cannot transfer the port reliably, a main-thread relay is permitted only with the same fixed pools,
backpressure, transfer semantics, and timing gates. `ScriptProcessorNode` and unbounded cloning are
not production fallbacks.

On permission denial, missing device, track mute/end, `devicechange`, route change, context
`suspended`/`interrupted`/`closed`, backgrounding, page hide, Worker failure, or pool exhaustion, the
controller transitions explicitly. It never assumes samples accumulated while suspended. Resume
requires a user gesture, new epoch, discovery/control reacquisition, and calibration.

Cancel is locally immediate: stop tracks, zero/disconnect output, close the AudioContext and Worker,
close ports, invalidate generations, release buffers, revoke URLs, and persist or delete state per
the user's choice. A best-effort acoustic `CANCEL` cannot delay local teardown.

## 8. Persistence contract

Database name: `local-suite-v4-acoustic`
IndexedDB schema version: `1`

| Store | Key | Required value |
|---|---|---|
| `sessions` | manifest ID as 64 lowercase hex characters | schema, manifest bytes, protocol version, status, chunk/window limits, durable counts, epoch, timestamps, error state |
| `chunks` | `[manifestId, chunkIndex]` | exact length, CRC32C, `ArrayBuffer` bytes |
| `receipts` | `[manifestId, page]` | 1024-bit durable-chunk bitmap, page version |
| `tombstones` | manifest ID | verified hash, final receipt sequence, completed/expiry timestamps; no payload bytes |

The database name and every key are validated because IndexedDB is origin-wide, not path-isolated,
on a shared Pages origin. Records are untrusted input after every read.

New chunk insertion uses one `readwrite` transaction spanning `sessions`, `chunks`, and `receipts`.
It validates manifest/session identity, range, exact expected length, and CRC before write. An exact
duplicate is byte-compared and succeeds idempotently without incrementing counts. Different bytes at
the same index preserve the original, mark the session `suspect`, and produce a NACK/error; they are
never overwritten silently. ACK reflects only transaction-complete receipt bits.

Resume uses the full 32-byte manifest ID. The sender must reselect and rehash the `File`; persistent
file handles are not assumed. A resume creates a fresh random session ID and higher epoch, pages the
durable receipt map, ignores old-session frames, and continues only after manifest identity and
bounds match exactly. Corrupt, wrong-version, stale, or mismatched records never merge with a live
session.

Limits are four incomplete sessions and 64 MiB aggregate acoustic payload bytes per origin, further
reduced by `navigator.storage.estimate()` with at least 32 MiB or 20% of reported quota (whichever is
larger) reserved as headroom. An estimate is advisory. A failed transaction or quota error sends no
ACK, pauses reception, and offers explicit cleanup. The application may request persistent storage
but must report denial honestly.

Incomplete and verified-payload sessions expire after 30 days; final tombstones expire after 24
hours. Startup cleanup removes expired tombstones first, then expired inactive sessions. It never
silently deletes the active session. Browser eviction or user-cleared data remains possible, so
resume is best-effort. Corrupt records are marked and offered for deletion; no unbounded quarantine
copy is retained.

Acoustic IndexedDB is excluded from Settings backup/restore and cannot bridge file/hosted origins.
The tool provides list, size, age, status, resume, and delete controls. Product integration must
correct the Settings prose before release.

## 9. Hash, memory, and allocation contract

Web Crypto has no standard incremental digest. Baseline v1 therefore uses
`crypto.subtle.digest("SHA-256", exactBuffer)` only after enforcing the 16 MiB limit:

- sender preparation reads at most 16 MiB, computes SHA-256, then releases that buffer before DATA;
- sender DATA reads bounded `File.slice()` chunks and does not retain the whole file;
- receiver stores chunks durably, allocates one exact file-length buffer only at final verification,
  fills it by ordered cursor reads, and hashes it;
- only verified bytes may create a Blob/download action;
- a resume rehashes the reselected source before sending resumed bytes.

The controlled JavaScript allocation budget for one active transfer is 48 MiB excluding browser-
internal Web Crypto, Blob, AudioContext, and IndexedDB implementation memory. Within it:

| Resource | Ceiling |
|---|---:|
| Final/source hash buffer | 16 MiB |
| Possible download Blob input retained by app | 16 MiB |
| Active chunk/window bytes | 256 KiB |
| Capture + playback pools | 512 KiB |
| DSP/FEC/resampler scratch and queued PCM | 8 MiB |
| Logs/metrics | 1 MiB and 2,000 records |
| Opt-in diagnostic PCM | 10 seconds mono; at most 2 MiB at 48 kHz float |
| Remaining controller/UI/transient allowance | bounded remainder to 48 MiB |

No array length derives from the wire before checked integer arithmetic and the limits in
`PROTOCOL.md`. Allocation failure is a recoverable terminal state; durable chunks remain resumable.
Peak process memory is not promised. The mobile memory spike must validate or reduce the file limit.

User-visible states are distinct: `received` (durably committed), `hash verification in progress`,
`SHA-256 verified`, `download ready`, and `save requested`. Clicking a download anchor does not prove
the browser saved a file. “Saved” is used only if a future API confirms a completed write.

## 10. Security, privacy, accessibility, and licensing

CRC32C and FEC address channel errors. SHA-256 addresses end-to-end reconstruction relative to the
received manifest. None authenticates a person or protects confidentiality. The UI warns that any
nearby recorder may recover plaintext and that active injection/jamming is possible.

Metadata is hostile. Filenames are NFC-normalized; reduced to a basename; stripped of path,
control, bidi, reserved-device, trailing-dot/space, and dangerous characters; and capped at 255
encoded UTF-8 bytes. MIME is advisory, capped at 127 ASCII bytes, defaults to
`application/octet-stream`, and never causes inline rendering. DOM rendering uses `textContent`.

Raw microphone recording is off by default. Diagnostic capture requires a separate explicit action,
shows a persistent indicator and Stop control, obeys the 10-second cap, stays local, and is deleted
on reset unless the user deliberately exports it. Logs contain no payload bytes, full filename,
secret, raw audio, or future key material.

Calibration and transfer cannot rely on sound, color, or rapidly changing numbers. The UI requires
keyboard-complete controls, a prominent Stop button, textual state and errors, non-color indicators,
rate-limited live announcements, reduced-motion behavior, and warning/confirmation before tones.
Safe digital amplitude is specified in `DSP_DESIGN.md`; the browser cannot infer acoustic SPL.

There is no top-level repository license. The baseline implementation is owned JavaScript with no
modem runtime dependency. Any copied code, table, vector, WASM, or recording requires pinned
provenance, hash, transitive license review, reproducible derivation, and scoped notices before
integration. Standards may define behavior but do not substitute for implementation provenance.

## 11. Release boundary

`G1_DISPOSITION.md` authorizes ordered Stage-B Lane 1 and Lane 2 production source/test work under
the exclusive ownership and gates in `IMPLEMENTATION_PLAN.md`. It does not authorize either spike
to be cherry-picked or authorize shared manifest, build, workflow, generated, or release edits
before the production lanes are integrated and jointly reviewed. Release remains blocked until
generated-page CSP/launch tests, deterministic protocol/DSP tests, crash-safe resume, the full Local
Suite regression suite, scoped provenance review, and a reproducible two-device physical matrix all
pass from the exact candidate commit.
