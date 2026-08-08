# Lane 1 Replacement Contract

Status: normative Gate R0 contract, 2026-08-07
Contract base: 9b6cdbb774805bc12146cf628068579b97fc335c
Wire version: 1.1
Manifest version: 1.1
Worker API: 1
Persistence and snapshot schema: 2

## 1. Authority, quarantine, and claims boundary

This document is the normative detail contract for replacement Lane 1. Together with
ARCHITECTURE.md, PROTOCOL.md, DSP_DESIGN.md, and IMPLEMENTATION_PLAN.md, it supersedes conflicting
Stage A draft text about wire or manifest 1.0, conditional unknown-minor acceptance, opaque TURN or
FINAL_CONFIRM payloads, ACK-shaped resume pages, mutable ARQ objects, schema 1 acoustic snapshots,
the old Worker registry, all-at-once TX, and a batch receiver.

Commit 0b2ff7ded57ea99210f06442759fda6c0a004e8c is quarantined. It and its branch, source, tests,
fixtures, APIs, directory layout, evidence, and result claims must not be merged, cherry-picked, or
adopted as the Lane 1 implementation or Lane 2 API freeze. Narrow mathematical ideas may be
independently reimplemented only at the authorized paths, with new provenance and independent
vectors. No quarantine file is an adoption unit.

This is an incompatible pre-release clarification. There is no released peer or supported stored
session to migrate. Draft AM1F/AM1M 1.0 values and schema 1 acoustic records fail closed; they are
not rewritten or inferred.

This contract is design, not evidence of physical transfer, browser real-time performance,
IndexedDB durability on a particular origin, mobile support, production readiness, release
readiness, deployment, safety, reliability, distance, goodput, or over-air compatibility.

## 2. Versions, length arithmetic, and hashing

Replacement Lane 1 supports exactly wire (major, minor) = (1, 1) and manifest (major, minor) =
(1, 1).

- Every AM1F header has bytes 4–5 equal to 01 01.
- HELLO advertises VERSION_RANGE = 01 01 01 01; ACCEPT selects that exact tuple.
- Before negotiation, only 1.1 HELLO and ACCEPT reach payload parsing. Other major or minor values
  cause bounded BAD_VERSION and create no candidate, allocation, or state.
- After negotiation, every frame equals the selected tuple. A future minor is accepted only after
  its decoder, flags, TLVs, state transitions, vectors, and advertisement are implemented.
- Stored state binds both versions. Cross-version resume and automatic migration are forbidden.

Transfer content is exactly 1 through 16,777,216 bytes. Length 0 is LIMIT_FILE before hashing,
manifest allocation, session creation, or Worker dispatch. For chunkSize 256 through 2,048:

~~~text
chunkCount = floor((fileLength + chunkSize - 1) / chunkSize)
1 <= chunkCount <= 65,536
chunkStart(i) = i * chunkSize
validLength(i) = min(chunkSize, fileLength - chunkStart(i))
0 <= i < chunkCount
1 <= validLength(i) <= chunkSize
sum(validLength(i)) = fileLength
~~~

All arithmetic is checked before allocating or converting to an allocating Number. Exact multiples
have a full final chunk. Zero-length DATA never exists. FIN encode and decode enforce 1–16 MiB even
though the generic exact u64 parser has a separate 64 MiB future-parser ceiling.

Future zero-byte support requires a new negotiated version defining zero chunks, empty digest,
ACK/resume zero-set semantics, FIN accounting, UI, and storage. It is not a 1.1 feature bit.

Production SHA-256 is bounded whole-buffer Web Crypto only. The product adapter is:

~~~text
Sha256.provider(subtleCrypto) -> Result<HashProvider>
HashProvider.digestBounded(exactBuffer:ArrayBuffer, maxBytes:u32)
  -> Promise<Result<Uint8Array(32)>>
Sha256.digestBounded(exactBuffer:ArrayBuffer, maxBytes:u32, provider:HashProvider)
  -> Promise<Result<Uint8Array(32)>>
Manifest.id(canonicalBytes, provider)
  -> Promise<Result<Uint8Array(32)>>
~~~

The adapter captures one digest function; accepts a bare ArrayBuffer, not a view or
SharedArrayBuffer; checks maxBytes before invoking it; awaits digest("SHA-256", exactBuffer);
requires an exact 32-byte ArrayBuffer result; copies to a fresh Uint8Array; and maps rejection or
shape failure to a bounded Result. File operations cap maxBytes at 16 MiB; manifest-ID operations
cap it at 1,024 bytes. File APIs separately require at least one byte. Callers generation-check
after the await.

No product file may contain a custom incremental SHA implementation or fallback. An independent
reference helper may exist only in Lane 3 fixture paths. If minimum-device memory rejects bounded
Web Crypto, work stops for a new architecture, API, provenance, version, and vector review.

## 3. AM1M 1.1 and received metadata

AM1M retains the 60-byte prefix and variable layout in PROTOCOL.md, with byte 5 equal to 01 and
flags zero. Its file length, count, chunk size, and digest obey section 2.

Optional extensions use:

~~~text
type:u8 | flags:u8 | length:u16 | value[length]
~~~

Flag bit 0 is CRITICAL; bits 1–7 are zero. Types are strictly increasing and unique. Type 00 and FF
are reserved and always fail. Types 01–EF are the public registry. Types F0–FE are private-use and
may be emitted only noncritical. The 1.1 public registry is empty and the product encoder emits no
extension.

- malformed, duplicate, out-of-order, reserved, overrun, or over-1,024-byte extensions fail;
- any unassigned critical extension fails INCOMPATIBLE_FEATURE;
- an unknown noncritical extension remains identity-bearing canonical bytes, is exposed as
  {type, critical:false, value}, and has no protocol, allocation, profile, code, encryption, or UI
  effect;
- exact re-encoding does not invent, reorder, normalize, or drop supplied extension bytes.

sanitizeFilename performs, in order:

1. require a scalar Unicode string and NFC-normalize;
2. retain the substring after the last slash or backslash;
3. remove U+0000–U+001F, U+007F–U+009F, U+061C, U+200B–U+200F, U+202A–U+202E,
   U+2060, U+2066–U+2069, and U+FEFF;
4. replace each of < > : " / \ | ? * with underscore;
5. trim Unicode whitespace and repeatedly remove trailing U+002E/U+0020;
6. replace empty, . or .. with received.bin;
7. compare the case-folded stem before the first dot to CON, PRN, AUX, NUL, CLOCK$, COM1–COM9,
   and LPT1–LPT9, prefixing underscore on a match;
8. UTF-8 truncate on a code-point boundary to at most 255 bytes, using received.bin if empty.

The sender applies this before canonical encoding; the receiver independently applies it for local
presentation without altering canonical bytes or manifest ID.

sanitizeMediaType lowercases and accepts only a parameter-free ASCII token matching
^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$ and present in this launch allowlist:

~~~text
application/octet-stream
application/json
application/zip
image/avif image/gif image/jpeg image/png image/webp
audio/mpeg audio/ogg audio/wav
text/plain
video/mp4 video/webm
~~~

Everything else, including HTML, SVG, XML, JavaScript, multipart, message, or parameterized types,
becomes application/octet-stream. The actual download Blob is always
application/octet-stream in 1.1. The sanitized advisory type is display-only. Metadata is rendered
with textContent; verified bytes are never inline-rendered or navigated.

## 4. AM1F direction, flags, accounting, and control schemas

The fixed header, byte order, CRC32C, parser order, session ID, epoch, and sequence rules in
PROTOCOL.md remain controlling with minor 1. ENCRYPTED and reserved flags always fail. MORE and
FINAL are mutually exclusive. RETRANSMIT is allowed only for a previously emitted identical
logical item; its AM1F sequence is always new.

The following is the complete allowed surface. R means FROM_RECEIVER is required; S means it is
forbidden. +RT means RETRANSMIT is the only additional allowed flag.

| Frame | Direction and flags | Header accounting | Allowed state |
|---|---|---|---|
| HELLO | S, none +RT | primary/item/window/total all 0 | sender discovery |
| ACCEPT | R, R +RT | primary/item/window/total all 0 | selected-candidate negotiation |
| TRAIN | either, R iff receiver +RT | primary=item=0; negotiated window/total after manifest | calibration/profile transition |
| CAL_REPORT | either, R iff receiver +RT | same as TRAIN | current calibration ID reply |
| MANIFEST | S, exactly MORE or FINAL +RT | primary=byte offset; item=payload bytes; total=manifest chunks | manifest delivery |
| MANIFEST_ACK | R, R+FINAL +RT | primary=item=0; exact window/total | complete manifest accepted |
| DATA | S, none or RT | primary=chunk index; item=1; exact window/total | sender DATA burst |
| TURN | S, none +RT | section 5 | end of a sender DATA burst |
| ACK | R, R; add FINAL iff complete; +RT | primary=global ackBase; item=rangeCount; exact window/total | current TURN response |
| PROFILE | either, R iff receiver +RT | primary=item=0; exact window/total | one authorized downgrade/recalibration |
| PAUSE | either, R iff receiver +RT | primary=item=0; negotiated accounting when known | active session |
| RESUME_QUERY | S, RESUME +RT | primary=item=0; exact manifest window/total | resume negotiation |
| RESUME_STATE | R, R+RESUME and exactly MORE or FINAL +RT | section 7 | accepted query reply |
| FIN | S, FINAL +RT | primary=total; item=0; exact window/total | all chunks durably acknowledged |
| FINAL_ACK | R, R+FINAL +RT | primary=total; item=0; exact window/total | verified transaction complete |
| FINAL_CONFIRM | S, FINAL +RT | primary=total; item=0; exact window/total | accepted FINAL_ACK |
| CANCEL | either, R iff receiver +RT | primary=item=0 | active session, best effort |
| ERROR | either, R iff receiver +RT | primary=item=0 | state-permitted bounded error |

Stateless decoding enforces version, exact type payload size/schema, per-type flag mask, header
accounting, CRCs, and implementation limits. Stateful validation then enforces role, turn,
capability selection, session/manifest, epoch, direction sequence, duplicate identity, and expected
chunk length. Only a statefully validated frame reaches Session.reduce.

Control TLVs 01–0D retain their PROTOCOL.md values. Version 1.1 adds:

| Type | Name | Exact value |
|---:|---|---|
| 0E | FORWARD_SELECTION | gridRate:u32, profileId:u8, fecId:u8, controlRepetition:u8, reserved:u8=0 |
| 0F | REVERSE_SELECTION | the same 8 bytes |
| 10 | CALIBRATION_ID | one nonzero u32 |
| 11 | CAL_RESULT | outcome:u8, gridCode:u8, profileId:u8, fecId:u8, tailGuardMs:u16, ackTimeoutMs:u16, discontinuities:u16, reserved:u16=0 |

gridCode is 1 for 44,100 and 2 for 48,000. outcome is 0 fail or 1 pass. Control repetition is
exactly 2. REVERSE_SELECTION is C0/K7_R12. FORWARD_SELECTION is selected from HELLO; only
R1/K7_R12 is enabled baseline DATA.

Required singleton sets are exact:

| Frame | Exact payload |
|---|---|
| HELLO | VERSION_RANGE, PROFILE_LIST, FEC_LIST, GRID_RATES, FILE_LIMIT, CHUNK_RANGE, WINDOW_RANGE, BURST_LIMITS, AUDIO_PROCESSING, ENDPOINT_NONCE, MANIFEST_ID, TURN_PARAMS |
| ACCEPT | VERSION_RANGE, FILE_LIMIT, equal-endpoint CHUNK_RANGE, equal-endpoint WINDOW_RANGE, BURST_LIMITS, AUDIO_PROCESSING, ENDPOINT_NONCE, echoed MANIFEST_ID, TURN_PARAMS, FORWARD_SELECTION, REVERSE_SELECTION |
| TRAIN | CALIBRATION_ID only |
| CAL_REPORT | CALIBRATION_ID followed by CAL_RESULT |
| PROFILE | CALIBRATION_ID, FORWARD_SELECTION, REVERSE_SELECTION, TURN_PARAMS |
| PAUSE | zero bytes |
| CANCEL | zero bytes |
| ERROR | ERROR_DETAIL only |

HELLO lists describe the original sender’s forward transmitter. Both roles receive C0 discovery at
both grids. ACCEPT selects forward values from the advertised intersection and declares the
receiver’s actual reverse C0 output grid. File/chunk/window/burst/turn selections lie within HELLO
and receiver limits; MANIFEST_ID echoes exactly. HELLO and ACCEPT alone may add unknown
noncritical control TLVs after all required types in increasing order. Unknown critical TLVs fail;
the other exact-set frames allow no additions.

ACK additionally proves every index below ackBase durable and the bit at ackBase zero unless
ackBase=totalChunks. Bitmap/ranges do not overlap or cross totals. Header primaryIndex/itemCount
match payload ackBase/rangeCount. A repeated physical copy retains logical ackSequence and exact
payload while using a new AM1F sequence.

## 5. DATA, OUTPUT_DRAINED, TURN, and control repetition

Planning, source read, encoding, queue acceptance, PCM generation, and output start do not make DATA
sent, increment its transmission attempt, or make it ACK-eligible. Only an owned OUTPUT_DRAINED
event for the DATA frame does so. If partial drain is uncertain, the epoch is invalidated and
reacquired.

TURN payload length is exactly zero. Any byte is BAD_TURN. TURN is created only after at least one
DATA frame in the burst reached OUTPUT_DRAINED:

| Field | Exact value |
|---|---|
| direction | original sender, FROM_RECEIVER clear |
| profile/FEC | C0 / K7_R12 |
| session/epoch/tag | current exact values |
| primaryIndex | first actually output-drained DATA chunk in the burst |
| itemCount | actually output-drained DATA frames, 1 through min(16, negotiated burst frames) |
| window/total | exact negotiation/manifest |
| payloadLength | 0 |
| first flags | 0 |
| repeat/retry flags | RETRANSMIT only |

One logical TURN attempt is two complete AM1F C0 frames. The first has a new sequence and no RT; the
second has the next sequence and RT. Accounting and empty payload are identical. Tail guard starts
after the second frame drains. A retry sends two more RT frames with new sequences, up to ten
logical attempts. Duplicate TURN resends the latest durable ACK without progress inflation.

The same two-complete-frame logical-attempt rule applies to ACCEPT, MANIFEST_ACK, ACK, FIN,
FINAL_ACK, and FINAL_CONFIRM. Each frame still contains the two PHY header copies; that is distinct
from whole-frame repetition. HELLO and full MANIFEST cycles retain their own repetition rules.

## 6. FIN, exact confirmation, and durable final ordering

FIN is exactly 72 bytes:

~~~text
manifestID[32] | expectedSHA256[32] | fileLength:u64
~~~

FINAL_ACK is exactly 80 bytes:

~~~text
manifestID[32] | expectedSHA256[32] | fileLength:u64 |
durableCount:u32 | finalAckSequence:u32
~~~

durableCount equals totalChunks. finalAckSequence starts at 1, advances only for a new verified
result, never wraps, and is durable. Retransmission/tombstone responses reuse the same logical
sequence and exact payload with new AM1F sequences and RT.

FINAL_CONFIRM is the byte-for-byte 80-byte accepted FINAL_ACK payload. Every manifest, hash, length,
count, final sequence, session, epoch, header total, and window binding must match. It is never an
opaque or new record.

After all chunk transactions complete, an accepted FIN starts at most one reconstruction/hash.
Duplicate exact FIN joins the pending operation; conflicting FIN fails. Hash success emits one
MARK_VERIFIED effect. One IndexedDB readwrite transaction then:

1. revalidates schema 2, canonical manifest/ID, count, durable count, lengths, CRCs, byte total,
   expected digest, and receipt revision;
2. changes the session status to VERIFIED;
3. allocates the next nonwrapping finalAckSequence;
4. writes/upserts a tombstone with the exact 80-byte FINAL_ACK, manifest binding,
   confirmationSeen=false, completion time, and 24-hour expiry; and
5. reaches transaction complete.

Only a current-generation successful completion authorizes FINAL_ACK. Abort, quota failure,
cancellation, stale result, or mismatch sends none.

After its first FINAL_ACK pair drains, the receiver enters FINAL_ACK_WAIT_CONFIRM and retries the
same logical payload in pairs or on duplicate FIN, at most ten attempts. A valid FINAL_CONFIRM
causes an idempotent MARK_CONFIRMED transaction. Transaction complete moves to COMPLETE. Exhaustion
moves to COMPLETE_CONFIRMATION_UNKNOWN: verification/download readiness remains, but peer receipt
is not claimed. A later exact confirmation may update the tombstone.

The sender marks REMOTE_SHA256_VERIFIED only on a valid FINAL_ACK, sends the exact confirmation pair,
and marks COMPLETE_CONFIRM_SENT only when both frames drain. This means browser output consumption,
not proven emission or peer reception. Exact duplicate FINAL_ACK schedules a coalesced confirmation
pair, at most ten response attempts. A higher/conflicting final sequence fails. A valid tombstone
answers duplicate FIN after reload without rehashing; duplicate confirmation is idempotent.

## 7. RESUME_QUERY and atomic 120-byte pages

RESUME_QUERY is:

~~~text
manifestID[32] | manifestLength:u16 | canonical AM1M 1.1 bytes
~~~

It uses sender direction, RESUME, a fresh nonzero session ID, a strictly higher stored attempt epoch,
and exact tag/window/total. The sender first reselects and hashes the source. The receiver parses and
asynchronously hashes the manifest and compares full ID, header tag, stored bytes/version,
chunk/window bounds, and negotiation before reading receipts.

Every RESUME_STATE payload is exactly 120 bytes:

| Offset | Size | Field |
|---:|---:|---|
| 0 | 32 | manifestID |
| 32 | 4 | snapshotRevision:u32 |
| 36 | 4 | pageBase:u32 |
| 40 | 4 | ackBase:u32 |
| 44 | 4 | durableCount:u32 |
| 48 | 2 | pageOrdinal:u16 |
| 50 | 2 | pageCount:u16 |
| 52 | 2 | bitmapBits:u16 = 512 |
| 54 | 2 | pageDurableCount:u16 |
| 56 | 64 | bitmap, 512 bits MSB-first |

Header primaryIndex=pageBase, itemCount=pageDurableCount, and window/total are exact.
snapshotRevision is nonzero, increments transactionally for each distinct durable chunk or verified
update, and does not change for an exact duplicate.

For totalChunks at least 1:

~~~text
pageCount = ceil(totalChunks / 512)   // 1..128
pageOrdinal = 0..pageCount-1
pageBase = pageOrdinal * 512
~~~

Every page is present, including all-zero pages. Tail bits are zero. pageDurableCount is the exact
valid-bit popcount. Manifest ID, revision, global durableCount, global ackBase, pageCount, session,
and epoch repeat identically. ackBase is the complete set’s first zero or totalChunks.

Nonfinal flags are FROM_RECEIVER|RESUME|MORE; final flags are
FROM_RECEIVER|RESUME|FINAL; copies/retries add RT. New pages arrive strictly in ordinal/base order.
A repeated page is accepted only when its payload and type-specific header are byte-identical apart
from AM1F sequence/RT. Conflict, skip, changed revision/count, impossible popcount, tail bit,
MORE/FINAL error, or sequence error invalidates the whole set.

The receiver reads sessions and receipts in one readonly transaction, validates stored 1,024-bit
receipt pages and chunk metadata, and copies at most 8,192 receipt bytes into one immutable response
snapshot. DATA commits do not overlap that snapshot.

The sender collects into a separate at-most-8,192-byte bitmap. No page mutates live ARQ, progress,
attempts, send base, or persistence. Only after FINAL does it verify every ordinal/domain,
union popcount, global count/base, all header/payload/session/epoch/version/manifest/negotiation
bindings, and its own source identity. One transition then replaces the durable set, advances to the
fresh transfer epoch, resets per-epoch attempts, and schedules only missing chunks. Any error
discards the temporary set and leaves prior state byte-for-byte unchanged.

## 8. Authorized source, classic-script order, namespaces, and APIs

Replacement Lane 1 may create only:

~~~text
assets/acoustic/protocol/{constants,bytes,crc32c,sha256,whitening,fec,interleave,wire,manifest,arq,session}.js
assets/acoustic/dsp/{fft,profiles,preamble,resampler,transmitter,receiver}.js
assets/acoustic/sim/{prng,channel,benchmark}.js
assets/acoustic/worker-entry.js
tests/acoustic-core.mjs
tests/acoustic-simulator.mjs
tests/fixtures/acoustic/core/**
tests/evidence/acoustic/g2-core/**
~~~

It must not create core/, worker/, renamed Lane 1 tests, a lane1 evidence tree, a shared Lane 1
result document, bundles.json, application/worklet source, build/manifest/workflow files, generated
files, or Optical changes.

The eventual page order is:

~~~text
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
~~~

The Worker dependency order is:

~~~text
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
~~~

worker-entry.js is appended once; worklet order is exactly worklet/audio-io.js. Classic scripts
attach one frozen member to globalThis.AcousticV1; apps use window.AcousticV1App. Duplicate members
throw. ESM, CommonJS, scans, runtime resolution, and source fallback are forbidden.

The only Lane 1 namespaces are Constants, Bytes, Crc32c, Sha256, Whitening, Fec, Interleave, Wire,
Manifest, Arq, Session, Fft, Profiles, Preamble, Resampler, PhyTx, PhyRx, Prng, Channel, and
Benchmark under AcousticV1.

Hostile-input operations return {ok:true,value} or {ok:false,code,detail?} and do not throw.
Wire/manifest APIs are:

~~~text
Wire.encodeFrame(frame, limits) -> Result<Uint8Array>
Wire.decodeFrame(exactBytes, limits) -> Result<DecodedFrame>
Wire.validateFrame(decodedFrame, context) -> Result<ValidatedFrame>
Manifest.encode(record, limits) -> Result<Uint8Array>
Manifest.parse(exactBytes, limits) -> Result<ManifestRecord>
Manifest.id(canonicalBytes, hashProvider) -> Promise<Result<Uint8Array(32)>>
Manifest.sanitizeFilename(text) -> Result<string>
Manifest.sanitizeMediaType(text) -> string
~~~

ARQ is pure and immutable:

~~~text
Arq.Sender.create(config, snapshot?) -> Result<Sender>
Sender.planBurst(audioNow, budget) -> Result<BurstPlan>
Sender.sourceResult(planId, chunkIndex, result) -> Result<SenderStep>
Sender.outputDrained(planId, drainedRecords, audioFrame) -> Result<SenderStep>
Sender.acceptAck(validatedAck, audioNow) -> Result<SenderStep>
Sender.onTimeout(audioNow) -> Result<SenderStep>
Sender.applyResume(completeResumeSet) -> Result<SenderStep>
Sender.snapshot() -> PersistableSenderStateV2

Arq.Receiver.create(config, snapshot?) -> Result<Receiver>
Receiver.classifyChunk(meta) -> Result<new|exactDuplicate|conflict|outOfRange>
Receiver.commitResult(chunkIndex, commitToken, durableResult) -> Result<ReceiverStep>
Receiver.makeAck(maxPayloadBytes) -> Result<AckRecord>
Receiver.makeResumeSnapshot(snapshotRevision) -> Result<ResumePage[]>
Receiver.snapshot() -> Result<PersistableReceiverStateV2>
~~~

Burst planning does not mutate attempts or ACK eligibility. commitToken binds generation, session,
epoch, manifest, index, CRC, length, and effect ID. durableResult.ok means the Lane 2 transaction
complete event fired. Storage callbacks do not live inside ARQ.

Session API is:

~~~text
Session.initial({role, controllerGeneration, limits, clockOrigin}) -> Result<State>
Session.reduce(state, event) -> {state:State, effects:Effect[]}
Session.snapshot(state) -> Result<PersistableSessionStateV2>
Session.restore(snapshot, exactManifestContext) -> Result<State>
~~~

Session.reduce is the only logical transition owner.

## 9. Reducer, effects, persistence, and ownership

State is immutable and bounded and includes schema 2, role/phase/generation, both versions, full
session/manifest identity, negotiation, nonwrapping frame/ACK/effect counters, ARQ value, pending
effects/TX, control and silence attempts, downgrade use, resume collector, final record, failure,
and bounded metrics.

Every effect carries:

~~~text
{effectId, controllerGeneration, sessionId|null, epoch,
 phaseAtIssue, kind, payload}
~~~

Every result repeats ownership. It is consumed only if it matches a pending effect and current
state. Cancel, reset, role/mode change, suspension teardown, new epoch, terminal error, or
replacement removes authorization first. Late results are ignored/counted and cannot recreate
progress.

The effect registry is exactly:

~~~text
REQUEST_PERMISSION START_AUDIO CONFIGURE_WORKER READ_SOURCE_CHUNK
TRANSMIT STORE_CHUNK LOAD_RESUME HASH_BUFFER MARK_VERIFIED MARK_CONFIRMED
PERSIST_SNAPSHOT SCHEDULE_TIMER CANCEL_TIMER STOP_AUDIO DELETE_SESSION
~~~

TRANSMIT lifecycle is exactly TX_ACCEPTED, TX_GENERATED, OUTPUT_STARTED, OUTPUT_DRAINED, TX_FAILED.
Only OUTPUT_DRAINED changes transmission facts, TURN accounting, tail guards, or confirm-sent state.

The complete role path covers preparation/permission, dual-grid discovery, exact HELLO/ACCEPT,
calibration, three manifest cycles/ACK, fresh or resume entry, DATA/commit/TURN/ACK, FIN/hash,
MARK_VERIFIED, FINAL_ACK, FINAL_CONFIRM, and MARK_CONFIRMED. Receiver never emits DATA; sender never
emits ACK/FINAL_ACK.

Incoming sequences strictly increase per physical direction and epoch. Logical repetitions use new
frame sequences and exact repeated identity. Benchmarks may not bypass sequence checks. No frame,
ACK, final, epoch, generation, request, plan, or effect counter wraps.

Database name remains local-suite-v4-acoustic, but acoustic persistence and snapshots use schema 2.
Schema 1 records fail closed and are offered for deletion. commitChunk resolves successfully only
on its multi-store transaction complete event. Snapshot restore reconciles manifest/session/version,
file length/hash, negotiation, epoch/sequences, revision, receipt bits/counts, unique byte sum,
per-index length/CRC/chunk rows, and final record before constructing live arrays.

Cancel invalidates authorization first and cannot wait for acoustic CANCEL. A transaction that
actually committed may be rediscovered only by a future valid resume; its late result cannot update
the canceled reducer or emit ACK. Planned/read/queued/not-drained work is never restored as sent.

## 10. Exact Worker API, buffers, credits, and cancellation

Envelopes are:

~~~text
request  = {api:1,id:u32_nonzero,kind:RequestKind,payload:ExactRecord}
response = {api:1,id:same,kind:same,ok:true,payload:ExactRecord}
         | {api:1,id:same,kind:same,ok:false,error:{code,detail?}}
event    = {api:1,id:0,kind:EventKind,payload:ExactRecord}
~~~

Request IDs strictly increase and never wrap. Exact own-key schemas are validated before
postMessage by Lane 2 and again in the Worker. Accessors, functions, DOM/IDB/File values,
SharedArrayBuffer, unexpected views, transfer aliases, and unbounded graphs fail.

READY is the first and only boot event:

~~~text
{api:1,id:0,kind:"READY",payload:{
  workerApi:1,wireMajor:1,wireMinor:1,manifestMajor:1,manifestMinor:1,
  pcmBlockSamples:4096,txPoolBuffers:16,rxPoolBuffers:16,maxQueue:16
}}
~~~

Requests are exactly INIT, CONFIGURE, RESET, RX_BLOCK, TX_INTENT, TX_RETURN, HASH_BUFFER, SIM_RUN.
Async events are exactly READY, TX_PCM, RX_RETURN, RX_FRAME, SESSION_EVENT, METRICS, BACKPRESSURE,
FATAL. METRICS is not a request; METRIC does not exist.

Active operations bind exactly:

~~~text
auth = {
  generation:u32_nonzero,
  sessionId:Uint8Array(16),
  epoch:u16,
  forwardProfileId:u8,
  reverseProfileId:u8
}
~~~

Exact request payloads and successful responses are:

| Kind | Payload | Successful response |
|---|---|---|
| INIT | {generation, role:"sender" or "receiver", contextSampleRate:u32, discoveryGrids:[44100,48000]} | {generation,state:"DISCOVERY",txCredits:16,limits:{the exact READY limits}} |
| CONFIGURE | {auth, forward:{gridRate,profileId,fecId}, reverse:{gridRate,profileId:C0,fecId:K7_R12}} | the exact frozen binding and state "BOUND" |
| RESET | {generation:u32 greater than current, reason:ResetReason} | {generation,state:"RESET",cancelledJobs:u16} |
| RX_BLOCK | discovery descriptor or {auth,...RxDescriptor} | {accepted:true,bufferId} |
| TX_INTENT | {auth,txId:u32_nonzero,frameBuffer:ArrayBuffer} | {accepted:true,txId,estimatedBlocks:u16} |
| TX_RETURN | {auth,bufferId:u8,buffer:ArrayBuffer} | {returned:true,bufferId,txCredits:u8} |
| HASH_BUFFER | {auth,jobId:u32_nonzero,purpose:"SOURCE" or "FINAL",buffer:ArrayBuffer} | {jobId,sha256:Uint8Array(32),byteLength:u32,buffer:ArrayBuffer} |
| SIM_RUN | {auth,jobId:u32_nonzero,seed:u32,gridRate,config,inputBuffer:ArrayBuffer} | {jobId,record,outputBuffer:ArrayBuffer} |

Asynchronous payloads are exactly:

~~~text
TX_PCM = {auth,txId,bufferId:u8,sequence:u16,sampleLength:u16,
          final:boolean,buffer:ArrayBuffer,metadata?:BoundedTxMetadata}
RX_RETURN = {generation,bufferId:u8,buffer:ArrayBuffer}
RX_FRAME = {auth_or_discovery,frame:ExactDecodedFrame,absoluteStart:u64,
            gridRate:u32,metrics:BoundedFrameMetrics}
SESSION_EVENT = {auth,kind:"TX_GENERATED"|"RX_DISCONTINUITY",
                 jobId:u32,detail:BoundedRecord}
METRICS = {generation,sequence:u32,counters:BoundedMetricRecord}
BACKPRESSURE = {generation,direction:"TX"|"RX",credits:u8,queueDepth:u8}
FATAL = {generation,code,detail?:string<=192 UTF-8 bytes}
~~~

TX_GENERATED means all PCM was generated and transferred; it is not OUTPUT_DRAINED. Only Lane 2
AudioRuntime/Worklet consumption counters may report output start/drain to the reducer.

INIT is initial-only and binds role, observed contextSampleRate, and discoveryGrids
[44100,48000]. CONFIGURE binds forward grid/profile/FEC and reverse C0/K7_R12. It may run again only
for a higher epoch or the one authorized profile transition in the same session. RESET has a
strictly greater generation, cancels work, terminalizes the Worker, and is followed by client
termination. A new controller generation boots a new Worker. During discovery RX_BLOCK uses only
{generation,discovery:true} and may emit HELLO candidates; after CONFIGURE every active request
requires auth. SIM_RUN is rejected with live audio work. HASH_BUFFER accepts SOURCE/FINAL exact
1–16 MiB ArrayBuffers and returns the buffer after digest; late results are CANCELLED.

PCM_BLOCK_SAMPLES=4096 and PCM_BLOCK_BYTES=16,384. Each direction has exactly IDs 0..15.

- buffer is a bare exact ArrayBuffer, never a view or SharedArrayBuffer;
- byteLength is exactly 16,384; sampleLength is 1..4096 from element 0;
- there is no offset, oversized backing, or alias;
- TX unused elements are zeroed;
- transfer lists contain the exact buffer once and detach the sender.

RX buffers are runtime-owned and each accepted RX_BLOCK returns exactly once as RX_RETURN. TX
buffers are Worker-owned and transition FREE -> FILLING -> MAIN_OWNED; TX_RETURN accepts only the
same exact ID/backing/auth, zeros it, and restores one credit. A seventeenth outstanding TX_PCM is
impossible. Zero credit suspends the cursor and coalesces BACKPRESSURE. No replacement allocation,
waveform slice, whole waveform, or PCM queue is permitted.

TX_INTENT frameBuffer is a transferred exact AM1F frame of 56 + payloadLength + 4 bytes, at most
4,156. The Worker decodes and authorizes it before waveform work. HASH/SIM also accept exact bare
buffers.

The accepted-job queue, including active and suspended cursors, is at most 16. There is at most one
TX cursor, two discovery candidates, one active link decoder, one hash, and one simulation job.
Every job checks its immutable ownership before allocation, before/after each await/task yield,
before event emission, and before metrics/response commit.

yieldTask resolves on a later Worker task, not merely a microtask. Maximum uninterrupted units are
4,096 PCM samples, one 512-point FFT/symbol, 1,024 discovery samples, 256 Viterbi input bits, 1,024
byte-loop bytes, or 4,096 simulator outputs. RESET prevents every old-generation event after its
response. Web Crypto itself need not be preemptible; late results are suppressed.

## 11. Cursor TX and true incremental dual-grid RX

Transmitter API is:

~~~text
PhyTx.begin(validatedIntent, carrierPlan, scratch) -> Result<TxCursor>
TxCursor.totalSamples() -> u32
TxCursor.pull(exactFloat32Block) -> Result<{sampleLength,final,metadata?}>
TxCursor.cancel() -> void
~~~

begin validates wire/profile/FEC/grid, symbols, scratch, amplitude, and the four-second ceiling
before output. pull writes directly into one exact pool block and creates no per-symbol object/view.

Receiver API is:

~~~text
PhyRx.create({contextSampleRate,discoveryGrids:[44100,48000],limits})
  -> Result<StreamReceiver>
StreamReceiver.configureLink(binding) -> Result<StreamReceiver>
StreamReceiver.push({samples:Float32Array(4096),sampleLength,
                     absoluteFrame,discontinuityCount})
  -> Result<{receiver,events,retiredThrough,metrics}>
StreamReceiver.resetEpoch(binding) -> Result<StreamReceiver>
StreamReceiver.snapshotMetrics() -> BoundedMetricRecord
~~~

Input frames are contiguous unless discontinuityCount advances. Gaps, overlap, overflow, or runtime
discontinuity drop candidates/assemblers and require reacquisition.

Discovery always runs independent 44,100 and 48,000 hypotheses using phase-accumulator resamplers,
rolling noise/energy, and O(1)-per-sample repeated-half correlation. Per-grid bounds are: ring 8,192
samples, short correlation 512, retained overlap 511, fine timing ±256, maximum C0/R1 symbol 640,
one candidate each/two total, and four expensive starts per second per grid.

Each produced hypothesis sample is processed once. Search retires everything older than the
511-sample overlap unless a bounded candidate owns it. Candidates incrementally consume and release
FFT windows and never pin a frame. Ring capacity never grows. The formal gate for every contiguous
run is:

~~~text
cumulativeRetired >= cumulativeProduced - 8192
~~~

On silence/no-candidate streams, produced minus retired stays at most 1,151 (511+640). Accepting
4,096 inputs while retiring only 256 fails.

After a validated doubled header bounds the body, FEC/deinterleave/CRC remain incremental and derive
storage only from payload <=4,096 bytes and the four-second ceiling. Nonfinite metrics fail.

One persistent LinkTracker is keyed by sessionId, epoch, remote transmitter role, grid, and profile.
It owns phase accumulators, ratio, residual ppm/confidence, timing offset/rate, common phase, CFO,
pilot update, absolute input frame, and discontinuity generation. Training/configuration creates it;
bursts borrow/return it. TURN/ACK gaps do not reset it. Ownership change, discontinuity, overflow,
clock error, or bounded confidence loss does. It reports finite actual ratio, residual ppm,
confidence, context/grid rates, and update count. Nonzero SRO with ratio 1 fails.

## 12. Exact WOLA, CFO boundary, and channel timebase

C0/R1 use N=512, CP C=128, overlap L=32. For each symbol form CP[C] || useful[N] ||
cyclicSuffix[L], where suffix is the first L useful samples. For r=0..31:

~~~text
a[r] = sin(pi * (r + 0.5) / (2*L))^2
~~~

Multiply the first L samples by a[r] and the last L by a[L-1-r]. Extended symbols start 640 samples
apart, so suffix overlaps the next leading edge. First and last overlap with zero. The burst also
uses at least 5 ms onset/release, target RMS <=0.08, and scaled peak <=0.50. Vectors cover overlaps,
first/last symbols, and pool boundaries.

Enabled C0/R1 acquisition is exactly -80 <= CFO Hz <= 80. ±100 Hz is an explicit
out-of-contract failure/reacquisition case and cannot pass the profile gate.

The channel API is:

~~~text
Channel.validate(seed, config, {gridRate,inputSamples})
  -> Result<CanonicalChannelConfig>
Channel.run(seed, config, inputPcm, gridRate)
  -> Result<{pcm,record}>
Channel.kernelVector(kind, parameter) -> Result<Float64Array>
~~~

Channel validation precedes defaults, PRNG, identity shortcuts, and allocation. Seed is integer
0..2^32-1; requested 0 maps to effective 0x6D2B79F5. Grid is 44,100 or 48,000. Input is a finite
Float32/Float64 vector of 1 through 4*gridRate samples, each in [-4,4]. Supplied values must be
finite/valid; explicit undefined and value||default behavior are forbidden. Unknown fields and
invalid/drop-repeat-silence operations fail.

Allowed keys and defaults are exactly:

~~~text
gain=1, responseFIR=[1], multipath=[], sroPpm=0, sroDriftPpm=0,
cfoHz=0, agc=null, clip=null, snrDb=120, coloredNoise=0,
tones=[], impulses=null, blockSize=256, dropBlocks=[], repeatBlocks=[],
silenceInsertions=[], quantizationBits=null
~~~

Published test-instrument bounds are gain 0..4; response FIR 1..129 taps, each -4..4; at most 16
multipath taps; SRO ±1,000 ppm with drift ±500 ppm; CFO ±100 Hz; block size 16..4,096; at most 64
drops, 64 repeats, and 32 silence insertions. The narrower ±80-Hz enabled-profile contract still
controls C0/R1 acceptance. Block operations are validated after deterministic SRO length is known:
indices are below the actual block count, each list is unique, drop/repeat sets are disjoint,
silence positions are unique/in range, and declared output length remains bounded.

The 17-tap normalized Blackman-windowed sinc in DSP_DESIGN.md is used for fractional multipath and
SRO. SRO sign is:

~~~text
sroPpm = (receiverSampleRate - transmitterSampleRate) /
         transmitterSampleRate * 1e6
~~~

Positive SRO yields more receiver samples. With input length N and phase p=0:

~~~text
while p < N:
  t = (N == 1) ? 0 : clamp(p/(N-1),0,1)
  ppm = sroPpm + sroDriftPpm * (t - 0.5)
  ratio = 1 + ppm/1e6
  output sample = sinc17(input,p)
  p = p + 1/ratio
~~~

Both SRO terms zero emit exactly N integer-phase samples. Time-varying rate is integrated; cubic
interpolation and input[n*instantaneousRatio] are forbidden. Channel operation order remains the
nine stages in DSP_DESIGN.md. Block indices are validated against the post-SRO block count, unique,
in range, mutually disjoint, and length-bounded.

Records are factual and have this exact shape:

~~~text
{
  prngVersion:"xorshift32-v1",
  sincKernelVersion:"blackman-sinc17-v1",
  hilbertKernelVersion:"blackman-hilbert63-v1",
  requestedSeed, effectiveSeed, gridRate, inputSamples, outputSamples,
  pathsApplied:{responseFir,multipath,fractionalMultipath,sro,cfoHilbert,
                agc,clip,noise,tones,impulses,blockTransform,quantization},
  applied:{droppedBlocks,repeatedBlocks,silenceBlocks,impulses},
  finalPhase, peak, signalPower, noiseRms
}
~~~

Every path boolean derives from an executed nonidentity stage; actual operation counts derive from
output, not requested lists. Records never assert independence and all numeric fields are finite.
Independent generators produce Q30 sinc/Hilbert coefficient fingerprints and a Q23 SRO impulse
fingerprint without importing product code; identity, multipath, SRO, CFO, and combined paths have
distinct vectors.

## 13. Red-first evidence and R0–R8 gates

Exploit fixtures are authored from this contract and independent logic before product code. They
cover empty/malformed control, semantic flags, never-drained ACK injection, incomplete resume,
forged snapshots, cancel/hash/storage races, role inversion, stale Worker auth, backing-buffer
attacks, ring retirement, connected SRO, invalid channel inputs, WOLA/CFO boundaries, and final
ordering. A product boolean or same-implementation round trip is never the oracle.

Independent vectors do not import product encoders, decoders, bitsets, kernels, or source lists.
Actual Worker evidence runs ordered dependencies and worker-entry.js in a separate Worker realm with
structured clone, detachment, exact buffer return, credits, active reset, and queue/high-water
observation. Same-realm WorkerCore testing is supplemental only.

Evidence retains a pre-run input/source manifest, byte-exact raw stdout/stderr and exit status,
independently derived aggregate, annotations separate from raw, exact commit/tree/environment,
commands, runtime/tool versions, hashes, seeds, case IDs, and honest scenario/case/iteration counts.
Missing, duplicate, or failed required cases make the aggregate/process fail. Claims are limited to
the actual evidence class.

`tests/evidence/acoustic/g2-core/` contains `source-inputs.json`, `commands.txt`,
`raw/` unmodified streams, mechanically derived `results.json`, interpretive `summary.md`,
and `vectors/` with independent generator source/provenance/fingerprints. An annotation is never
described as runner stdout. External registries use one opened no-follow descriptor, bounded read
of at most 1 MiB plus one byte, pre/post `fstat`, complete case aggregation, and nonzero exit on
any required failure.

Replacement order is mandatory:

| Gate | Work and exit |
|---|---|
| R0 | Integrate the two independent review inputs into this tracked contract; documents agree; docs-only; self-review finds no unresolved contract STOP |
| R1 | Authorized path/API skeleton, namespace guards, exact READY and unknown-kind tests |
| R2 | Independent primitives and vectors; Web Crypto adapter; punctured/fast/stretch disabled |
| R3 | AM1F/AM1M 1.1, exact schemas/flags/metadata/resume/FIN; all valid-CRC exploit vectors pass |
| R4 | Immutable ARQ, output-drain and transaction boundaries, schema 2 reducer/snapshots/final traces |
| R5 | Cursor TX, exact WOLA, dual-grid ring RX, LinkTracker, phase-accumulator channel and fingerprints |
| R6 | Real Worker pump, authorization, exact pools/credits/returns/task-yield reset; no whole waveform |
| R7 | Full-control deterministic vertical slices, raw/source-bound evidence, clean authorized diff and honest claims |
| R8 | Independent protocol/session/persistence rereview and independent DSP/streaming/Worker/channel rereview; exploit reruns; API freeze |

Lane 2 must not start before both R8 reviewers explicitly accept, no critical/high/medium finding
remains, R0–R7 evidence binds the exact replacement commit, the integration owner merges and reruns
the static/core gates, records a clean API-freeze commit, and confirms 0b2ff7d was not merged.

Browser persistence, AudioWorklet timing, generated-page operation, mobile, physical, release, and
deployment evidence remain later gates. Any source/API change after freeze requires a tracked
contract delta, both downstream rebases, and complete affected reruns.
