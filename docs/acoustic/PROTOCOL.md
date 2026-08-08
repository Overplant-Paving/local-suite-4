# Acoustic Transfer Protocol 1.1

Status: **Superseded planning contract**, archived 2026-08-08. It is not the wire protocol shipped
by the v4.3.2 Audio Transfer beta; see `assets/acoustic/app/` and the release tests for shipped behavior.

Historical status: Gate R0 replacement logical wire contract
Wire version: major `1`, minor `1`
Byte order: network order (big-endian) for every multibyte integer

`LANE1_REPLACEMENT_CONTRACT.md` is normative for the exhaustive exploit fixtures, internal APIs,
Worker boundary, and R0–R8 gates. This document contains the controlling wire/manifest rules.
Draft 1.0 is incompatible and fails closed. Commit
`0b2ff7ded57ea99210f06442759fda6c0a004e8c` remains quarantined; none of its APIs or evidence may
be merged, cherry-picked, or adopted.

## 1. Protocol boundary

Protocol v1 transfers one file-like byte string from the original sender to the original receiver
over a bidirectional, half-duplex acoustic link. The same roles persist even while the receiver is
transmitting an ACK. A peer may implement both roles, but one session has one original sender.

The logical protocol in this document is stable. Physical profile values in `DSP_DESIGN.md` are
provisional until feasibility gates pass. Acoustic v1 is plaintext and unauthenticated. It detects
accidental corruption but does not prove sender identity, confidentiality, replay resistance
against an active party, or anti-jamming protection.

## 2. Primitive conventions

- Unsigned integers are `u8`, `u16`, `u32`, or `u64` in big-endian order.
- `u64` must be parsed with exact integer arithmetic. Values above the implementation limit are
  rejected before conversion to an allocating JavaScript `Number`.
- Byte strings are length-delimited. Text is UTF-8; malformed UTF-8 is rejected where text is
  required.
- Protocol bits within a byte are consumed most-significant bit first.
- Reserved fields and reserved flag bits must be zero. Nonzero reserved values are `BAD_RESERVED`.
- Integer addition/multiplication is checked before use as an offset, count, or allocation length.

### CRC32C

Every CRC in v1 is CRC-32C/Castagnoli with:

| Parameter | Value |
|---|---|
| Normal polynomial | `0x1EDC6F41` |
| Reflected implementation polynomial | `0x82F63B78` |
| Initial register | `0xFFFFFFFF` |
| Input/output reflection | true / true |
| Final XOR | `0xFFFFFFFF` |
| Empty input | `0x00000000` |
| ASCII `123456789` | `0xE3069283` |
| Serialization | four bytes, big-endian |

CRC32C is error detection, not authentication.

## 3. Logical frame

```text
0                                                     55
+--------+----+----+------+-------+--------+-----------+
| AM1F   |ver |type|flags | lengths/profile/epoch      |
+--------+----+----+------+----------------------------+
| frame sequence |          session ID (16 bytes)      |
+----------------+--------------------------------------+
| session ID cont. | manifest tag | primary index       |
+------------------+--------------+---------------------+
| item count | window | total chunks | header CRC32C    |
+------------+--------+--------------+------------------+
| payload: payloadLength bytes                          |
+------------------------------------------------------+
| frame CRC32C over header (including header CRC)+body |
+------------------------------------------------------+
```

### Fixed 56-byte header

| Offset | Size | Field | v1 rule |
|---:|---:|---|---|
| 0 | 4 | magic | ASCII `AM1F` (`41 4d 31 46`) |
| 4 | 1 | major | `1` |
| 5 | 1 | minor | `1` |
| 6 | 1 | frame type | registered value below |
| 7 | 1 | flags | only defined bits may be set |
| 8 | 2 | header length | exactly `56` |
| 10 | 2 | payload length | `0..4096`, with narrower type limits |
| 12 | 1 | PHY profile ID | body profile; control requires `C0` |
| 13 | 1 | FEC ID | body code; control requires `K7_R12` |
| 14 | 2 | epoch | starts at 0; increases on resume/recalibration/profile reset |
| 16 | 4 | frame sequence | strictly increasing per direction and epoch; no wrap |
| 20 | 16 | session ID | nonzero 128-bit value from `crypto.getRandomValues` |
| 36 | 4 | manifest tag | first four manifest-ID bytes as a `u32`; discovery aid only |
| 40 | 4 | primary index | type-specific offset/base/index; otherwise zero |
| 44 | 2 | item count | type-specific bounded count; otherwise zero |
| 46 | 2 | window size | negotiated chunks; zero before negotiation |
| 48 | 4 | total chunks | canonical manifest count; zero before known |
| 52 | 4 | header CRC32C | CRC over bytes `0..51` |

The trailing frame CRC32C covers the 56-byte header, including its header CRC, followed by the exact
payload. It is not included in `payload length`.

Parser order is fixed: total input length; magic; header length; header CRC; major/minor/type/flags;
profile/FEC; payload length and exact frame length; session/epoch/sequence; type-specific counts and
implementation limits; frame CRC; only then payload parsing or decoder/storage allocation.

### Flags

| Bit | Name | Meaning |
|---:|---|---|
| 0 | `FROM_RECEIVER` | physical transmitter is the original receiver |
| 1 | `RETRANSMIT` | new frame sequence carrying a previously sent logical item |
| 2 | `MORE` | more fragments/pages follow |
| 3 | `RESUME` | frame belongs to explicit resume reconciliation |
| 4 | `FINAL` | final page/burst/control instance |
| 5 | `ENCRYPTED` | reserved; unsupported in 1.1 and rejected |
| 6–7 | reserved | must be zero |

Direction must match frame type and current turn. A flag never substitutes for the session ID,
epoch, or sequence checks.

### Frame types

| Value | Name | Direction and purpose |
|---:|---|---|
| `0x01` | `HELLO` | sender discovery/capabilities |
| `0x02` | `ACCEPT` | receiver selection/capabilities |
| `0x03` | `TRAIN` | either direction, calibrated training request/data |
| `0x04` | `CAL_REPORT` | peer's bounded calibration observations |
| `0x05` | `MANIFEST` | sender canonical-manifest fragment |
| `0x06` | `MANIFEST_ACK` | receiver accepts exact full manifest |
| `0x10` | `DATA` | sender one chunk |
| `0x11` | `TURN` | sender closes a data burst and yields the channel |
| `0x12` | `ACK` | receiver durable selective-repeat report |
| `0x13` | `PROFILE` | negotiated downgrade/recalibration request |
| `0x14` | `PAUSE` | either peer requests a bounded pause |
| `0x15` | `RESUME_QUERY` | sender asks for durable state by full manifest ID |
| `0x16` | `RESUME_STATE` | receiver pages durable state |
| `0x17` | `FIN` | sender states all chunks sent and expected identity |
| `0x18` | `FINAL_ACK` | receiver reports exact final SHA-256 success |
| `0x19` | `FINAL_CONFIRM` | sender confirms receipt of `FINAL_ACK` |
| `0x1A` | `CANCEL` | best-effort remote cancellation notice |
| `0x1B` | `ERROR` | bounded machine error and optional detail |

Core error codes are stable:

| Value | Name |
|---:|---|
| `0x0001` | `BAD_VERSION` |
| `0x0002` | `BAD_FRAME` |
| `0x0003` | `BAD_CRC` |
| `0x0004` | `BAD_RESERVED` |
| `0x0005` | `INCOMPATIBLE_CAPABILITY` |
| `0x0006` | `INCOMPATIBLE_FEATURE` |
| `0x0007` | `LIMIT_FILE` |
| `0x0008` | `LIMIT_RESOURCE` |
| `0x0009` | `MANIFEST_MISMATCH` |
| `0x000A` | `SESSION_MISMATCH` |
| `0x000B` | `CHUNK_CONFLICT` |
| `0x000C` | `STORAGE_FAILURE` |
| `0x000D` | `HASH_MISMATCH` |
| `0x000E` | `LINK_UNUSABLE` |
| `0x000F` | `CANCELLED` |
| `0x0010` | `RUNTIME_UNSUPPORTED` |

`ERROR` uses `ERROR_DETAIL`; its UTF-8 suffix is diagnostic only and is never parsed as protocol
state. Unknown error codes are displayed as unknown peer errors and terminate the current state.

Unknown frame types are rejected. Unknown majors and minors are rejected before payload parsing or
candidate creation. A future minor is accepted only by an implementation that explicitly supports
and advertises its complete frame, flag, TLV, and state registry.

### Type-specific header accounting

| Type | `primary index` | `item count` | `total chunks` |
|---|---|---|---|
| `MANIFEST` | byte offset in canonical manifest | fragment byte length | manifest-declared count if known, else 0 |
| `DATA` | chunk index | exactly 1 | exact canonical count |
| `TURN` | first actually OUTPUT_DRAINED DATA chunk | actually OUTPUT_DRAINED DATA frames, 1–16 and within negotiated burst | exact canonical count |
| `ACK` | lowest non-durable chunk (`ackBase`) | extra range count | exact canonical count |
| `RESUME_STATE` | receipt-page base chunk | durable-bit popcount in this 512-bit page | exact canonical count |
| `FIN`/`FINAL_ACK`/`FINAL_CONFIRM` | exact durable/expected chunk count | 0 | exact canonical count |
| other | 0 unless its payload schema says otherwise | 0 | 0 before manifest, exact count after |

Inconsistent duplicate accounting is a corrupt frame even when CRCs pass.

### Exact direction, flag, and state matrix

`FROM_RECEIVER` exactly identifies the original receiver as physical transmitter.
`RETRANSMIT` is permitted only for a previously emitted byte-identical logical item with a new
outer frame sequence. `MORE` and `FINAL` never coexist. No flag omitted from this table is valid.

| Frame | Direction and required/base flags | Accounting | State |
|---|---|---|---|
| `HELLO` | sender; none, optional valid retransmit | all accounting 0 | sender discovery |
| `ACCEPT` | receiver; `FROM_RECEIVER`, optional valid retransmit | all accounting 0 | selected-candidate negotiation |
| `TRAIN` | either; `FROM_RECEIVER` iff receiver, optional valid retransmit | primary/item 0; negotiated window/total after manifest | calibration/profile transition |
| `CAL_REPORT` | either; same direction rule as TRAIN, optional valid retransmit | same as TRAIN | reply for current calibration ID |
| `MANIFEST` | sender; exactly `MORE` or `FINAL`, optional valid retransmit | byte offset, payload length, manifest count | manifest delivery |
| `MANIFEST_ACK` | receiver; `FROM_RECEIVER|FINAL`, optional valid retransmit | primary/item 0; exact window/total | accepted complete manifest |
| `DATA` | sender; none or valid retransmit | chunk index, item 1, exact window/total | sender DATA burst |
| `TURN` | sender; none, optional valid retransmit | first/count of actually output-drained DATA; exact window/total | end of sender DATA burst |
| `ACK` | receiver; `FROM_RECEIVER`, add `FINAL` iff complete, optional valid retransmit | global ackBase/rangeCount; exact window/total | current TURN response |
| `PROFILE` | either; `FROM_RECEIVER` iff receiver, optional valid retransmit | primary/item 0; exact window/total | one authorized transition |
| `PAUSE` | either; `FROM_RECEIVER` iff receiver, optional valid retransmit | primary/item 0; negotiated accounting when known | active session |
| `RESUME_QUERY` | sender; `RESUME`, optional valid retransmit | primary/item 0; exact manifest window/total | resume negotiation |
| `RESUME_STATE` | receiver; `FROM_RECEIVER|RESUME` plus exactly `MORE` or `FINAL`, optional valid retransmit | fixed-page base/popcount; exact window/total | accepted query reply |
| `FIN` | sender; `FINAL`, optional valid retransmit | primary=total, item 0; exact window/total | all chunks acknowledged durable |
| `FINAL_ACK` | receiver; `FROM_RECEIVER|FINAL`, optional valid retransmit | primary=total, item 0; exact window/total | verified transaction complete |
| `FINAL_CONFIRM` | sender; `FINAL`, optional valid retransmit | primary=total, item 0; exact window/total | accepted FINAL_ACK |
| `CANCEL` | either; `FROM_RECEIVER` iff receiver, optional valid retransmit | primary/item 0 | active session; best effort |
| `ERROR` | either; `FROM_RECEIVER` iff receiver, optional valid retransmit | primary/item 0 | state-permitted bounded error |

Stateless decoding checks version, exact payload/schema, flags, header accounting, CRCs, and limits.
Stateful `Wire.validateFrame` then checks current role/turn, selected capabilities, full
session/manifest, epoch, direction sequence, logical duplicate, and expected chunk length. Only a
validated frame may become a reducer event.

## 4. Capability TLVs and negotiation

Control payloads other than the fixed schemas below use bounded TLVs:

```text
type:u8 | flags:u8 | length:u16 | value:length bytes
```

TLV flag bit 0 is `CRITICAL`; bits 1–7 are zero. A control payload has at most 32 TLVs and 192 bytes.
Unknown critical TLVs cause `ERROR(INCOMPATIBLE_FEATURE)`; unknown noncritical TLVs are skipped.
Duplicate singleton TLVs are rejected.

| Type | Name | Exact value |
|---:|---|---|
| `0x01` | `VERSION_RANGE` | minMajor, minMinor, maxMajor, maxMinor: four `u8` |
| `0x02` | `PROFILE_LIST` | count `u8` then distinct profile IDs |
| `0x03` | `FEC_LIST` | count `u8` then distinct FEC IDs |
| `0x04` | `GRID_RATES` | count `u8` then `u32` rates; v1 permits 44100/48000 |
| `0x05` | `FILE_LIMIT` | accepted `u32` bytes |
| `0x06` | `CHUNK_RANGE` | minimum and maximum `u16` |
| `0x07` | `WINDOW_RANGE` | minimum and maximum `u16` |
| `0x08` | `BURST_LIMITS` | max frames `u16`, max milliseconds `u16` |
| `0x09` | `AUDIO_PROCESSING` | four `u8` bitsets: requested-off, supported, effective-known, effective-enabled; bits 0/1/2 are EC/NS/AGC |
| `0x0A` | `ENDPOINT_NONCE` | 16 random bytes |
| `0x0B` | `MANIFEST_ID` | full 32-byte ID, when known |
| `0x0C` | `TURN_PARAMS` | tail guard and ACK timeout in milliseconds, two `u16` |
| `0x0D` | `ERROR_DETAIL` | error code `u16`, then at most 96 valid UTF-8 bytes |
| `0x0E` | `FORWARD_SELECTION` | grid rate `u32`, profile `u8`, FEC `u8`, control repetition `u8`, reserved `u8=0` |
| `0x0F` | `REVERSE_SELECTION` | the same eight bytes |
| `0x10` | `CALIBRATION_ID` | one nonzero `u32` |
| `0x11` | `CAL_RESULT` | outcome `u8`, grid code `u8`, profile `u8`, FEC `u8`, tail guard `u16`, ACK timeout `u16`, discontinuities `u16`, reserved `u16=0` |

`gridCode` is 1 for 44,100 Hz and 2 for 48,000 Hz; outcome is 0 fail or 1 pass. Control
repetition is exactly 2. `REVERSE_SELECTION` is C0/K7_R12. The enabled baseline forward
selection is R1/K7_R12.

Type-specific payload ceilings override the normal TLV ceiling but never the 4096-byte frame ceiling:

| Payload class | Maximum |
|---|---:|
| TLV control (`HELLO`, `ACCEPT`, `TRAIN`, `CAL_REPORT`, `PROFILE`, `PAUSE`, `CANCEL`, `ERROR`) | 192 bytes |
| `MANIFEST` fragment | 512 bytes |
| `MANIFEST_ACK` | 40 bytes |
| `DATA` | 2060 bytes (12-byte prefix plus 2048-byte chunk) |
| `TURN` | exactly 0 bytes |
| `ACK` | 96 bytes |
| `RESUME_QUERY` | 1058 bytes (32-byte ID, 2-byte manifest length, up to 1024 manifest bytes) |
| `RESUME_STATE` | exactly 120 bytes |
| `FIN` / `FINAL_ACK` / `FINAL_CONFIRM` | 80 bytes |

`HELLO` requires exactly `VERSION_RANGE`, `PROFILE_LIST`, `FEC_LIST`, `GRID_RATES`,
`FILE_LIMIT`, `CHUNK_RANGE`, `WINDOW_RANGE`, `BURST_LIMITS`, `AUDIO_PROCESSING`,
`ENDPOINT_NONCE`, `MANIFEST_ID`, and `TURN_PARAMS`. The receiver requires two valid HELLO
frames with distinct sequences and identical session/capabilities before selection.

In HELLO, list/range TLVs advertise the original sender's forward transmitter. In ACCEPT,
`FORWARD_SELECTION` chooses one advertised forward grid/profile/FEC and
`REVERSE_SELECTION` declares the receiver's actual reverse C0 grid. The two directions may use
different grids. `CHUNK_RANGE` and `WINDOW_RANGE` have equal selected endpoints.

`ACCEPT` requires exactly `VERSION_RANGE`, `FILE_LIMIT`, equal-endpoint `CHUNK_RANGE`,
equal-endpoint `WINDOW_RANGE`, `BURST_LIMITS`, `AUDIO_PROCESSING`, `ENDPOINT_NONCE`,
the echoed `MANIFEST_ID`, `TURN_PARAMS`, `FORWARD_SELECTION`, and
`REVERSE_SELECTION`. Selected values are intersections of HELLO and local limits. An empty
intersection is terminal `INCOMPATIBLE_CAPABILITY`; no open-loop or network substitute exists.

`TRAIN` is exactly `CALIBRATION_ID`. `CAL_REPORT`, from either role only as the current
calibration reply, is exactly `CALIBRATION_ID` followed by `CAL_RESULT`. `PROFILE` is exactly
`CALIBRATION_ID`, both selection TLVs, and `TURN_PARAMS`. `PAUSE` and `CANCEL` are empty.
`ERROR` contains exactly `ERROR_DETAIL`.

Unknown critical control TLVs fail. HELLO and ACCEPT alone may contain unknown noncritical
extensions after all required types in increasing order; the other exact-set controls allow none.
Missing/duplicate fields, an unrelated manifest ID, or a selected value outside the advertised
intersection fails before a state transition.

Negotiation is not authenticated in v1. An active party can alter or downgrade it. The UI describes
that limitation; v1 does not claim downgrade resistance.

## 5. Physical coding order and identifiers

Wire bytes are produced before physical coding. For each section:

```text
logical header/payload
→ header CRC32C and trailing frame CRC32C
→ whitening
→ convolutional FEC and termination/puncturing
→ deterministic bit interleaving
→ BPSK/QPSK mapping
→ pilots/training/OFDM, cyclic prefix, shaping, and ramp
```

The 56-byte header is always whitened with the fixed nonzero seed `0x4D3B`, encoded with
`K7_R12`, deterministically interleaved with fixed seed `0xA31C5EED`, and physically transmitted
twice. The decoder must obtain two matching valid decoded headers, or one valid header plus a
profile-approved confidence threshold established by the feasibility gate, before allocating the
body. Until that gate, two matching headers are mandatory.

The body is payload plus trailing frame CRC. Its whitening seed is the low 15 bits of CRC32C over:

```text
sessionID[16] || epoch:u16 || frameSequence:u32 || profileId:u8 || 0x57
```

with zero replaced by one.

Whitening uses a 15-bit right-shifting LFSR. For each input bit (MSB first), XOR `state & 1`, then:

```text
feedback = ((state >> 0) ^ (state >> 1)) & 1
state = (state >> 1) | (feedback << 14)
```

FEC IDs:

| ID | Name | Contract |
|---:|---|---|
| `0x01` | `K7_R12` | rate 1/2, K=7, generators octal 171/133, six zero tail bits |
| `0x02` | `K7_R23` | same mother code, provisional puncture mask `1110` repeated |
| `0x03` | `K7_R34` | same mother code, provisional puncture mask `111001` repeated |

For each input bit, `reg=((reg<<1)|bit)&0x7F`; output is parity of `reg&0x79` followed by parity of
`reg&0x5B`. Input bytes and output pairs are MSB-first. Decoder start/end state is zero. Punctured
codes remain disabled until independent soft-decision vectors and channel gates pass.

For equal Viterbi path metrics, choose the predecessor with the lower numeric prior state; if still
equal, choose input bit zero. Renormalization subtracts the minimum live metric from every live path.

For an `n`-bit section, interleaving writes input bit `i` to output position `(a*i+b) mod n`.
`b=seed mod n`; initial `a=((seed>>>16)|1) mod n`, with zero replaced by one; increment `a` by two
modulo `n` until `gcd(a,n)=1`. The header uses the fixed seed above. Body seed is CRC32C over the
same seed material with terminal byte `0x49`. Length 0 bypasses interleaving.

Profile IDs and symbol construction are in `DSP_DESIGN.md`. Control frames use `C0`/`K7_R12` and
the negotiated physical repetition. `DATA` bodies may use a selected data profile; their headers
remain robust.

## 6. Canonical manifest

The manifest is a canonical byte string, at most 1024 bytes:

| Offset | Size | Field |
|---:|---:|---|
| 0 | 4 | ASCII `AM1M` |
| 4 | 1 | manifest major = 1 |
| 5 | 1 | manifest minor = 1 |
| 6 | 2 | flags; all zero in 1.1 |
| 8 | 2 | total manifest length |
| 10 | 2 | chunk size |
| 12 | 8 | original file length |
| 20 | 4 | chunk count |
| 24 | 32 | SHA-256 of exact original bytes |
| 56 | 2 | filename UTF-8 byte length |
| 58 | 1 | media-type byte length |
| 59 | 1 | reserved zero |
| 60 | variable | filename bytes, then media type, then optional manifest TLVs |

`fileLength` is exactly 1 through 16,777,216 bytes and `chunkCount` equals
`ceil(fileLength/chunkSize)`; zero is rejected before hashing or session creation. Filename is NFC
UTF-8 and at most 255 bytes.
Media type is at most 127 printable ASCII bytes and advisory only. Optional manifest TLVs use the
control TLV syntax, must fit the 1024-byte total, and follow strictly increasing TLV type order;
duplicates are rejected. No creation time, local path, or device identity is included.

`manifestID = SHA-256(canonical manifest bytes)`. The four-byte header tag is its first four bytes
interpreted big-endian and is never sufficient for resume or final verification.

The 1.1 manifest extension registry is empty. Extension type `0x00` and `0xFF` always fail;
`0x01..0xEF` are public registry space and `0xF0..0xFE` are noncritical-only private use.
Unknown critical extensions fail `INCOMPATIBLE_FEATURE`. Unknown noncritical extensions remain
identity-bearing canonical bytes and are exposed without semantic effect; they cannot authorize
profiles, FEC, encryption, interpretation, or allocation. The product encoder emits none.

Sender sanitization does not make received metadata trusted. Both sides apply the exact
`sanitizeFilename` algorithm in `LANE1_REPLACEMENT_CONTRACT.md` §3: NFC, basename for both
separator styles, complete control/bidi stripping, dangerous-character replacement, whitespace
and trailing-dot/space removal, empty/dot fallback, reserved-device prefixing, and code-point-safe
255-byte UTF-8 truncation.

The media field is advisory. It is lowercased only when it is a parameter-free valid token and is
in this allowlist: `application/octet-stream`, `application/json`, `application/zip`,
`image/avif`, `image/gif`, `image/jpeg`, `image/png`, `image/webp`, `audio/mpeg`,
`audio/ogg`, `audio/wav`, `text/plain`, `video/mp4`, or `video/webm`. Every other value,
including HTML, SVG, XML, JavaScript, multipart, message, and parameterized values, sanitizes to
`application/octet-stream`. The download Blob is always `application/octet-stream`; metadata
is text-only and never causes inline rendering.

### Manifest delivery

`MANIFEST.primaryIndex` is its byte offset and `itemCount` equals the fragment length. The payload is
that exact raw fragment. Fragments may overlap only when bytes are identical. The sender transmits
the complete manifest in offset order for at least three full cycles and continues until
`MANIFEST_ACK` or control retry exhaustion.

The receiver bounds the reassembly buffer at 1024 bytes, validates the fixed prefix before accepting
the declared length, parses the complete canonical value, computes the full manifest ID, and checks
the discovery tag and negotiated limits. `MANIFEST_ACK` payload is the 32-byte manifest ID followed
by selected chunk size `u16`, window size `u16`, and file limit `u32`. It is sent only for an exact,
accepted manifest and repeated as a robust control frame.

## 7. DATA and durable selective-repeat ACK

### DATA payload

```text
chunkIndex:u32 | validLength:u16 | reserved:u16=0 |
chunkCRC32C:u32 | chunkBytes[validLength]
```

Header `primaryIndex` equals `chunkIndex`, `itemCount` is 1, and header chunk/window totals match the
manifest and negotiation. Nonfinal chunks have exactly `chunkSize` bytes; the final chunk has the
remaining exact length. `chunkCRC32C` covers only `chunkBytes`.

The receiver validates all fields and CRCs before storage. It then atomically commits the chunk,
receipt bit, durable count, and session timestamp. An exact byte duplicate is idempotent and does
not affect hash input, stored length, progress, retry counts, or goodput. Different bytes for an
existing chunk mark the session suspect, retain the first durable value, and yield NACK/error.

### Burst and turnaround

The sender selects only chunks inside `[sendBase, sendBase+windowSize)`, prioritizing explicit
missing bits then unsent chunks. A burst ends at the first of negotiated frame count, negotiated
audio-duration limit, pause/cancel, or window exhaustion. Planning, reading, encoding, queueing,
PCM generation, and output start do not make DATA sent. Only an owned `OUTPUT_DRAINED` event does
so, increments its transmission attempt, and makes it ACK-eligible.

`TURN` is emitted only after at least one DATA in the burst is `OUTPUT_DRAINED`. Its payload is
exactly empty; `primaryIndex` is the first drained DATA chunk and `itemCount` is the count of
drained DATA frames, 1 through the negotiated maximum of at most 16. A failed or uncertain partial
output is excluded and forces epoch invalidation/reacquisition rather than guessed accounting.

Initial negotiation ranges are 1–16 DATA frames and 500–8000 ms, with a provisional 3000 ms target.
One frame already started may finish beyond the duration target; no second frame may start. These
are bounds, not goodput claims.

One logical TURN attempt is two complete C0 AM1F frames. The first has a new sequence and no
`RETRANSMIT`; the second has the next sequence and `RETRANSMIT`, with identical empty payload
and accounting. After the second frame drains, the receiver waits the calibrated speaker/room-tail
guard (bounded 100–1500 ms) before ACK transmission. It then sends the robust ACK as the same
two-complete-frame logical attempt. The original sender must
listen through ACK preamble/body and reverse tail before reacquiring its transmit turn.

The two-complete-frame rule also applies to ACCEPT, MANIFEST_ACK, FIN, FINAL_ACK, and
FINAL_CONFIRM. Each AM1F frame still contains two PHY header copies. Logical retries retain exact
payload/accounting, use new frame sequences, add `RETRANSMIT`, and remain within the ten-attempt
ceiling. Duplicate TURN resends the latest durable ACK without incrementing progress.

This full cycle—output drain, ringing guard, reverse acquisition, ACK, reverse drain, and forward
reacquisition—is included in all payload-goodput timing. Initial guard/timeout values are
provisional; p50/p95/p99 hardware measurements determine them. A guessed UI timer is not evidence.

### ACK payload

```text
0   ackBase:u32              lowest chunk not durably committed
4   bitmapBits:u16           exactly 128 in v1
6   rangeCount:u8            0..8
7   reserved:u8              zero
8   ackSequence:u32          increases for each logical ACK
12  durableCount:u32         total distinct durably committed chunks
16  bitmap[16]               bit i: chunk ackBase+i is durable
32  ranges[rangeCount]       each 8 bytes

range = start:u32 | length:u16 | flags:u8 | reserved:u8
```

Bitmap bits are MSB-first within each byte. A one is ACK; a zero is compact NACK/unknown. Ranges are
strictly increasing, nonoverlapping durable (`flags bit0=1`) runs beyond the bitmap; other flag bits
and reserved bytes are zero. No range crosses `totalChunks`. `durableCount`, `ackBase`, bitmap, and
ranges must be mutually possible or the ACK is corrupt. Every chunk below `ackBase` is durable,
and bitmap bit 0 is zero unless `ackBase=totalChunks`. When complete, `ackBase=totalChunks`, the
bitmap/ranges are empty/zero, and `durableCount=totalChunks`.

ACK payload is at most 96 bytes. Header `primaryIndex=ackBase` and `itemCount=rangeCount`.
Unauthenticated ACK injection remains an explicit v1 threat; session/direction/epoch/sequence/window
checks reduce accidental stale acceptance but are not a MAC.

### Retries and fallback

- DATA retry ceiling: eight transmissions per chunk across one epoch.
- HELLO/ACCEPT/MANIFEST/TURN/ACK/FIN-family control ceiling: ten logical attempts per state.
- ACK timeout: negotiated 1000–10000 ms and computed from calibrated guard plus robust-control
  duration and margin; provisional initial value is 3000 ms.
- Silence: 10 seconds without a valid expected frame triggers reacquisition diagnostics; 30 seconds
  pauses the session; three consecutive user-resumed silent attempts are terminal.
- After first retry exhaustion, peers may recalibrate and downgrade exactly once to a mutually
  supported more robust profile, incrementing epoch.
- Exhaustion after downgrade enters terminal `LINK_UNUSABLE`; there is no open-loop fallback.

Timeouts use the monotonic audio/session clock while active. Page suspension invalidates them and
enters `SUSPENDED`; it never lets UI timer throttling advance the protocol.

Frame sequence and ACK sequence must not wrap. Epoch must not wrap. Approaching a limit is a
terminal version-capacity error, not modular reuse.

## 8. Resume

Resume is best-effort and origin-local. The sender first reselects and fully hashes the source. It
uses a fresh nonzero session ID and a strictly higher stored attempt epoch. `RESUME_QUERY` is:

```text
manifestID[32] | manifestLength:u16 | canonical AM1M 1.1 bytes
```

The receiver parses and hashes the canonical bytes and requires equality with the full payload ID,
header tag, stored bytes/version, negotiated bounds, and current session/epoch before reading
receipts.

Each `RESUME_STATE` payload is exactly 120 bytes:

| Offset | Size | Field |
|---:|---:|---|
| 0 | 32 | manifest ID |
| 32 | 4 | nonzero snapshot revision |
| 36 | 4 | page base |
| 40 | 4 | global ackBase |
| 44 | 4 | global durable count |
| 48 | 2 | page ordinal |
| 50 | 2 | page count |
| 52 | 2 | bitmap bits, exactly 512 |
| 54 | 2 | page durable popcount |
| 56 | 64 | 512-bit bitmap, MSB-first |

`pageCount=ceil(totalChunks/512)` (1–128), ordinal is `0..pageCount-1`, and
`pageBase=ordinal*512`. Every page, including all-zero pages, is present. Tail bits are zero.
The repeated manifest ID, revision, global count/base, page count, session, and epoch are identical.
`ackBase` is the complete receipt set's first zero or `totalChunks`.

Nonfinal pages use `FROM_RECEIVER|RESUME|MORE`; the final page uses
`FROM_RECEIVER|RESUME|FINAL`; exact retries additionally use `RETRANSMIT`. Header
`primaryIndex=pageBase` and `itemCount=pageDurableCount`.

The receiver creates one immutable validated snapshot in a readonly transaction. The sender
collects at most 8,192 receipt bytes into temporary state and does not mutate ARQ per page. Only
after FINAL does it validate every ordinal/domain, order, duplicate, revision, popcount, ackBase,
tail bit, flag, sequence, manifest/session/epoch/version/negotiation binding, and source identity.
One transition then replaces the durable set and schedules missing chunks in the fresh epoch.
Incomplete, conflicting, malformed, stale, or mismatched sets are discarded with the prior state
byte-for-byte unchanged. Schema 1 state is rejected, never migrated.

Resume cannot cross `file://` and hosted origins through Settings backup.

## 9. Final verification and completion

`FIN` payload is:

```text
manifestID[32] | expectedSHA256[32] | fileLength:u64
```

The receiver accepts FIN only when every chunk is durably committed exactly once and all accounting
matches. It reconstructs the exact file length in chunk order, computes SHA-256 with bounded Web
Crypto, and compares all 32 bytes. Until that completes, progress is below 100% and no download or
copy action exists.

On success, the reducer emits one `MARK_VERIFIED` effect. A single readwrite transaction
revalidates schema 2, manifest/ID, chunk/durable accounting, lengths/CRCs/ordered byte total,
expected digest, and receipt revision; marks the session verified; allocates the next nonwrapping
`finalAckSequence`; writes the exact final record/tombstone with
`confirmationSeen=false` and 24-hour expiry; and reaches transaction complete. Only that current
generation completion authorizes `FINAL_ACK`.

`FINAL_ACK` is exactly the FIN 72 bytes followed by `durableCount:u32` and
`finalAckSequence:u32`, for 80 bytes total. Durable count equals total chunks. Retries/tombstone
answers retain the exact payload and logical final sequence.

`FINAL_CONFIRM` is exactly the byte-for-byte 80-byte FINAL_ACK accepted by the sender. Every
manifest/hash/length/count/final-sequence/session/epoch/window/total binding must match. The sender
marks remote SHA verification only after FINAL_ACK and marks confirmation sent only after both
confirmation frames are `OUTPUT_DRAINED`.

The receiver retries the FINAL_ACK pair at most ten logical attempts. A valid confirmation triggers
an idempotent `MARK_CONFIRMED` transaction; transaction complete moves to `COMPLETE`.
Exhaustion moves to `COMPLETE_CONFIRMATION_UNKNOWN`: verified/download-ready remains true but
sender receipt is not claimed. An identical FIN addressed to a live verified record or unexpired
tombstone returns the stored exact FINAL_ACK without rehashing. Duplicate exact confirmation is
idempotent; conflicting confirmation cannot alter the tombstone.

User-visible meanings are exact:

- **received:** bytes are durably committed, not yet end-to-end verified;
- **SHA-256 verified:** reconstructed bytes match the received canonical manifest;
- **download ready:** a verified Blob/action exists;
- **save requested:** the browser was asked to download;
- **saved:** prohibited wording unless a future write API confirms completion.

SHA-256 verification does not authenticate the sender.

## 10. State machine and exceptional transitions

```text
IDLE
 → PERMISSION
 → AUDIO_READY
 → CALIBRATION
 → DISCOVERY
 → NEGOTIATION
 → MANIFEST or RESUME_RECONCILE
 → DATA_BURST ↔ TURNAROUND ↔ ACK_WAIT
 → VERIFYING
 → FINALIZING
 → COMPLETE
```

`PAUSED`, `SUSPENDED`, `TERMINAL_FAILURE`, `FINAL_ACK_WAIT_CONFIRM`, and
`COMPLETE_CONFIRMATION_UNKNOWN` are explicit states, not UI labels.

| Event | Required transition/action |
|---|---|
| Permission denied/unavailable | `TERMINAL_FAILURE(PERMISSION)` for that attempt; retry only by user gesture |
| Unsupported launch context/worklet | `TERMINAL_FAILURE(RUNTIME_UNSUPPORTED)`; no deprecated/network fallback |
| Calibration cannot hear either direction | retry within control ceiling, then `LINK_UNUSABLE` |
| Incompatible version/profile/bounds | send robust machine error when possible; terminal |
| Corrupt frame/header/FEC failure | discard before allocation; increment bounded metric; remain/reacquire |
| Candidate/mismatched session | require two matching HELLOs; never replace active progress from one frame |
| Stale epoch/sequence/ACK | ignore and count; repeated abuse is rate-limited |
| Duplicate DATA | byte-compare/idempotent; ACK durable original; no progress inflation |
| Conflicting DATA | preserve original, mark suspect, NACK/error, require user-visible recovery |
| Quota/transaction failure | send no ACK for affected chunk; `PAUSED(STORAGE)` and offer cleanup |
| Silence | reacquire at 10 s, pause at 30 s, bounded user-resumed attempts |
| Page hidden/context suspended/device lost | persist reducer snapshot, stop/gate audio, enter `SUSPENDED`; explicit gesture + new epoch to resume |
| User pause | finish or abort current bounded buffer safely, send PAUSE if possible, persist, stop output/capture policy |
| User cancel | immediate local generation invalidation and teardown; optional best-effort CANCEL |
| Worker/worklet failure/overflow | stop output, persist durable state, reacquire or terminal by retry policy |
| Final hash mismatch | no completion/download; terminal corrupt result |
| Duplicate FIN after success | answer from tombstone with same FINAL_ACK; do not reconstruct twice |

Late permission, storage, hash, Worker, or device promises carry a controller generation and are
ignored after reset, cancel, mode change, or teardown.

## 11. Published implementation bounds

| Resource | v1 bound |
|---|---:|
| Accepted file content | 1 byte–16 MiB |
| Wire `u64` file field future parser ceiling | 64 MiB; values above 16 MiB are refused by this implementation before allocation |
| Manifest | 1024 bytes |
| Filename | 255 UTF-8 bytes |
| Media type | 127 ASCII bytes |
| General frame payload | 4096 bytes |
| Normal control payload | 192 bytes, 32 TLVs |
| Chunk size | 256–2048 bytes; provisional defaults 512 robust / 1024 normal |
| Chunk count | 1–65,536 and exactly derived from length |
| Window | 8–128 chunks; provisional default 64 |
| DATA burst | 1–16 frames and 500–8000 ms; provisional target 3000 ms |
| ACK bitmap/ranges | 128 bits plus at most 8 ranges; 96-byte payload max |
| DATA retries | 8 per chunk |
| Control attempts | 10 per state |
| Profile downgrade | once per session attempt |
| Incomplete stored sessions | 4 |
| Stored acoustic payload | 64 MiB aggregate, further quota/headroom limited |
| Candidate sessions | 2 simultaneous; 8 HELLO candidates/minute |
| Event log | 2,000 records / 1 MiB |
| Diagnostic raw audio | off by default; explicit 10-second / 2 MiB cap |
| Frame/ACK sequence | no `u32` wrap |
| Epoch | no `u16` wrap |

These checks occur before arrays, receipt maps, FEC state, or IndexedDB writes are created.

## 12. Versioning and independent vectors

Major changes include byte order, fixed-header meaning, CRC convention, canonical manifest, session/
epoch interpretation, encryption/authentication semantics, or incompatible state behavior. Peers
with unknown major versions refuse the session.

This implementation accepts exactly wire 1.1 and manifest 1.1. HELLO advertises
`01 01 01 01`; ACCEPT selects it exactly. Unknown major or minor fails before candidate creation
or payload allocation, and every post-negotiation frame equals the selected tuple. A future minor
is accepted only after its complete decoder/registries/transitions/vectors are implemented and
advertised; understanding the fields observed in one frame is insufficient. Reserved bits never
mean “ignore.” Stored sessions bind both exact versions and are never silently migrated.

Before implementation is accepted, Lane 3 must produce independently generated, provenance-recorded
known-answer vectors for:

- fixed header serialization and both CRCs;
- CRC32C empty and `123456789` cases;
- manifest canonical bytes and manifest ID;
- whitening sequences for fixed and session-derived seeds;
- convolutional encoder, termination, puncturing, soft-decode success/failure;
- interleaver permutation/inversion;
- every frame payload schema, malformed/truncated/over-limit cases;
- selective-repeat ACK bitmap/ranges, duplicates, conflicts, stale epochs, and retry exhaustion;
- fixed 120-byte resume-page complete-set reconciliation and final SHA-256 gating.

Round trips performed only by the product encoder/decoder are supplementary, not independent proof.
