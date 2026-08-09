# ChromaLink

`chromalink.html` is a Local Suite Beta Tools page that moves one file between
two phones with light: the sender animates 8-color 2D frames on its screen and
the receiver decodes them through its camera. Payload bytes never use a
network path — no upload, relay, pairing server, or account. The hosted page
itself may be fetched normally; after the Local Suite service worker caches
it, the same HTTPS origin runs offline.

ChromaLink is a separate tool from Optical Transfer (`optical.html`) and Audio
Transfer (`audio.html`); it replaces neither and shares no wire format with
either. Implementation contract: `CHROMALINK-SPEC.md`. ChromaLink ships in
Local Suite v4.3.3 (2026-08-09) as the 104th manifest tool, the second Beta
Tools card; release evidence: `tests/evidence/v4.3.3-release/`.

## User-visible contract

- Send accepts one file of any type up to 64 MiB (the inline error for larger
  files is exactly `Max 64 MB`). Container packing, optional raw-deflate
  compression, SHA-256, RaptorQ encoding, and frame rendering are local
  browser operations.
- Grid density is selectable (`60 Robust / 100 Standard / 140 Dense`) with
  15/20/24 fps; both lock for the duration of a stream, and changing them
  starts a fresh transfer identity. The stream continues until stopped.
- The sender works from `file://`. Mobile browsers generally require the
  hosted HTTPS page for camera receive; the installed Local Suite PWA keeps
  that secure origin available offline.
- Receive asks only for camera permission (the denied state reads exactly
  `Camera permission required`). Captured frames are decoded in a worker and
  never leave the page. A centered square aiming guide whose side is 70% of
  the shorter viewport edge shows where to hold the code, and the status
  line follows an exact contract: `Searching for code…` after one second
  with no finder in sight, `Hold steady` when more than 40% of the last 30
  frames were blurred, `Move closer` when locked but the code is too small,
  else `{pct}% · {kbps} KB/s`.
- If a completed collection fails its integrity check, the receiver shows
  exactly `Transfer corrupted — restarting collection` and recollects with
  the same locked transfer; a second failure also releases the lock and
  listens for a fresh transfer.
- Completion appears only after the reassembled bytes reproduce the SHA-256
  carried inside the transfer itself; the receiver then shows the name, size,
  elapsed time, and average rate with a download link, a short 880 Hz tone,
  and optional vibration, and releases the camera, frame pump, and decode
  worker.
- Any camera that can see the sending screen can receive the file. This is a
  no-network transport, not encryption, and the digest check proves
  integrity, not sender identity.

## Wire and recovery architecture

1. A transfer container records the UTF-8 filename (≤255 bytes), exact
   original length, SHA-256, and a compression flag; raw deflate is used only
   when strictly smaller.
2. The container feeds `raptorq@1.7.24` (RFC 6330, wasm) through
   `chromalink/src/lib/fountain.ts`, the only module that touches the wasm.
   The 12-byte OTI and 4-byte PayloadIds are carried in every frame header.
   The sender emits every systematic symbol round-robin across source blocks,
   then deterministic repair symbols forever in batches of 500.
3. Each frame is an N×N grid (N ∈ {60, 100, 140}) of 3-bit color modules
   (R=bit2, G=bit1, B=bit0) with QR-style finders at three corners, a
   parity-alternating 6×6 beacon at the fourth, an 8-patch calibration strip,
   and a 42-byte RS(42,28)-protected header written twice where capacity
   allows. Payload bytes are split into ≤255-byte GF(256) RS codewords with
   32 parity bytes each and interleaved byte-wise, so burst damage spreads.
4. The receive worker downscales each camera frame to 160 px for detection,
   verifies finder structure, traces the grid's right/bottom boundaries,
   fits a least-squares homography over every trustworthy anchor, validates
   the measured calibration strip's channel structure, and classifies
   modules against the measured palette with per-band self-alignment. The
   finer 240/320 px passes are true fallbacks: they run only when the
   cheaper scale could not produce a decodable packet, so a steady locked
   stream pays for one 160 px pass per frame (blur is rejected before any
   detection).
5. A frame contributes a packet only after its header survives RS decoding
   plus magic/version/CRC16 checks, the payload survives per-codeword RS
   (errors-and-erasures, driven by classification confidence) plus the
   header's payload CRC32, and the packet's leading bytes equal the
   header's PayloadId. The first accepted packet locks the receiver to its
   transferId AND exact 12-byte OTI — a later frame with the same id but a
   different OTI never reaches the decoder. A received OTI must parse
   within wrapper bounds (transfer length capped at the largest possible
   64 MiB container, fixed reserved/N/Al fields, only the three per-grid
   symbol sizes, source blocks the symbol count can fill) and its packet
   size must match the detected grid before a RaptorQ decoder is even
   constructed; construction failures are contained as rejections. A digest
   mismatch resets the decoder once (same locked OTI), and a second
   mismatch also releases the lock.

## Verification status (honest boundaries)

Deterministic gates, all green in `chromalink/` (`npx tsc --noEmit`,
`npx vitest run` — 82 tests, `npm run build`):

- RS codec: 1,000 random codewords with 0–16 errors recover exactly; a
  constructed 17-error miscorrection is caught by the frame CRC; erasure
  decoding honors 2e + E ≤ 32.
- Layout capacity anchors (N60 934 / N100 2,896 / N140 5,930 payload bytes),
  header 7-byte recovery and 8-byte rejection, a corrupted-first-copy →
  intact-second-copy header fallback at N100/N140, fixed-seed frame pins,
  and exact finder/beacon/calibration RGB values.
- Hostile-input regressions: OTI bounds (oversized 40-bit lengths,
  impossible symbol sizes, non-fixed reserved/N/Al, unfillable source
  blocks), session locking (same-id/different-OTI rejection, grid/packet
  size agreement, PayloadId-vs-packet-bytes consistency, contained decoder
  construction failures, contained `addPacket` failures with safe disposal
  and lock release), the two-strike digest policy, session-scoped
  finalization ownership under Reset races, sender Start-button validity,
  frame-pump serialization under delayed bitmap creation, per-reason worker
  statistics, strictly consecutive finder streaks, and worker survival
  across malformed frames.
- Synthetic camera gates through the production receive path (staged
  scales, escalation only on decode failure): 100 random distorted frames
  per grid (±8° rotation, ±4% corner perspective, σ8 noise, ±20
  brightness) decode at **99% for N100 and 98% for N60** against the ≥95%
  / ≥98% floors. A camera pointed away from any code reports `nofinder`,
  driving the exact one-second `Searching for code…` state.
- Blur gate, measured honestly in the normal 720 px capture path
  (`tests/evidence/chromalink/blur-measurements.log`): box blur at the
  sharpness gate's calibration scale (radius 3 on the 160 px gate domain ≙
  radius 13–14 at capture resolution) is rejected as blur, while a
  radius-3 blur at capture resolution measures ~91–103 against the gate's
  25 and still decodes 88% of frames — the gate correctly does NOT reject
  it, and a regression pins that behavior.
- End-to-end Node loopback: 1 MiB through container → fountain → frames →
  full phase-3 synthetic distortion → production vision/decode path →
  session-locked fountain decode with uniform 20% frame loss, completing
  within K·1.35 emitted packets with an exact SHA-256. The receiving side
  builds its decoder from the first decoded frame header's OTI (never the
  sender's encoder object) and the final lock is compared against the
  sender's identity. A post-RS payload byte flip is rejected by CRC before
  the fountain decoder.

Local Suite gates: `python3 build.py --check` (104 tools),
`node tests/chromalink-built.mjs` — the built single file boots from
`file://` under its generated CSP with zero errors, initializes the RaptorQ
wasm, streams sender frames on an exact-white integer-scaled canvas,
surfaces the exact camera-denied state, runs the camera → worker loop
against a fake device to the exact `Searching for code…` state, verifies
the 70vmin aiming-guide geometry on desktop and mobile, and regresses the
concrete lifecycle races: a Retry storm opens one camera at a time,
repeated Reset reuses the open camera, getUserMedia resolving after
pagehide stops the track, a wake lock granted after Stop is released
rather than attached to stale state, and a sender failure after the
full-white stage is appended removes the stage and restores the controls.
`.github/workflows/pages.yml` runs this gate on every deploy.

**Not verified:** two-device physical over-air transfer. Synthetic and
browser gates do not prove real-phone compatibility, reliability, range, or
goodput — screen brightness, camera focus and exposure behavior, rolling
shutter, frame pacing, and Moiré effects are all real-world variables the
synthetic camera does not model. Until a documented hardware matrix exists,
physical performance remains an unverified beta claim, and the tool's page
says so.

## Build and provenance

The implementation is a strict TypeScript (7.0.2) / Vite (8.2.1) subproject
in `chromalink/` with `raptorq@1.7.24`, `fflate@0.8.3`, and `crc-32@1.2.2`
locked in `chromalink/package-lock.json`; npm never touches the rest of the
suite. `src/lib/**` is DOM-free (enforced by `test/constraints.test.ts`), the
decode worker imports lib only, and sender/receiver never import each other.

`npm run build` produces `chromalink/dist/`;
`node chromalink/scripts/export-suite.mjs` deterministically wraps that build
(bundle, inlined wasm bytes, inline-worker) in Local Suite chrome as
`tools/chromalink.html`; `python3 build.py` then inlines the shared core and
generates the committed, self-contained `dist/chromalink.html`. Never edit
Local Suite `dist/` by hand. The page's manifest entry adds only
`'wasm-unsafe-eval'`, `worker-src blob:`, and local media sources to its own
CSP; no other tool's policy changes.
