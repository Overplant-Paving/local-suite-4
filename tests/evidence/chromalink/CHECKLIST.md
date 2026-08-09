# ChromaLink integration evidence — 2026-08-09 (incl. same-day review-fix and final hardening passes)

Released and deployed as **Local Suite v4.3.3** on 2026-08-09. All local synthetic and
browser gates below are green; hosted publication, byte-for-byte artifact verification,
tagging, and the GitHub release are recorded in
`tests/evidence/v4.3.3-release/release-checklist.md`. Contract:
`CHROMALINK-SPEC.md`; tool doc: `CHROMALINK.md`.

A review-fix pass was applied and re-gated on 2026-08-09. RED regressions
were written first where the defect was expressible against the old code
(`red-regressions.log`): hostile OTI acceptance and the wrong no-finder
state. Fixes: hostile-OTI bounds and exact transferId+OTI session locking
(`lib/fountain.ts`, new `lib/receive-session.ts`), correct `nofinder`
reporting with strictly consecutive finder streaks, a serialized camera
frame pump (new `lib/frame-gate.ts`), receiver/sender lifecycle guards
(getUserMedia/play/wake-lock/worker-reply/SHA-finalize races, worker epoch
invalidation on Reset, worker termination + camera/pump/URL release on
completion, stage/encoder cleanup on failed sender start), the 70vmin
aiming guide with the exact status contract, per-reason worker statistics
(new `lib/receive-pipeline.ts`), decode-failure-only 240/320 px fallback
scales, restored exact verification gates, a first-header-copy corruption
fallback regression, and the built gate wired into
`.github/workflows/pages.yml`.

A final hardening pass followed the same day (RED regressions first, all
archived in `red-regressions.log`, then all gates re-run green):

1. **Decoder feed containment** — `decoder.addPacket` throwing inside
   `createReceiveSession.accept` (hostile-but-CRC-valid packet or wasm
   fault) is now caught, the decoder disposed with the dispose itself
   contained, the transfer lock released, and a typed
   `{kind:'rejected', reason:'decoder-failed'}` returned; a later clean
   transfer locks and completes (proved with an injected throwing decoder,
   including a decoder whose `dispose` also throws).
2. **Session-scoped finalization ownership** — the receiver's shared
   `finalizing` boolean is replaced by ownership keyed to the session
   instance (`finalizingFor`). A stale SHA-256 finalizer resolving after
   Reset — even after a new finalizer has started — can no longer clear the
   current finalizer's ownership and admit a duplicate finalization.
   Proved by `receiver-finalize.test.ts` with deferred digest promises:
   the stale finalizer mutates no UI, creates no Blob URL, and a third
   completion cannot start while the current finalization is pending;
   completion produces exactly one download URL.
3. **Sender Start validity** — Start is armed only while the selected file
   is non-empty, ≤ 64 MiB, not condemned by a start-time read, and no
   stream or start is in flight (`startAllowed()`/`refreshStartBtn()`);
   the old `finally` blanket-enabled Start whenever a file was selected,
   which also allowed overlapping streams from a second click. Built-gate
   checks pin: Start disabled while streaming, re-armed after Stop, kept
   disabled after a start-time empty read, re-armed by a fresh selection.

## Standalone gates (chromalink/, all green)

Log: `final-standalone-gates.log`

- `npm ci` — clean, 0 vulnerabilities (dev-only `happy-dom@20.11.2` added for
  the receiver lifecycle test; runtime dependencies unchanged).
- `npx tsc --noEmit` — exit 0 (TypeScript 7.0.2 strict, `noUncheckedIndexedAccess`, no `any`).
- `npx vitest run` — **82/82 across 13 files**:
  - `rs.test.ts` — alpha^255 = 1; 1,000 random codewords with 0–16 errors recover
    exactly; a constructed 17-error miscorrection is caught by the frame CRC harness.
  - `layout.test.ts` — capacity anchors N60 2919/1094/5/934, N100 8919/3344/14/2896,
    N140 18119/6794/27/5930; mask/order/patch/interleave invariants.
  - `header.test.ts` — 7 corrupted bytes recovered (300 seeds), 8 rejected (300
    seeds); magic/version/CRC16 forgeries rejected.
  - `fountain.test.ts` — raptorq wasm initializes in Node (no skip needed);
    100 KiB systematic roundtrip out of order; drop-and-repair recovery; OTI shape;
    **hostile OTI bounds** (F capped at the 64 MiB container +297-byte overhead,
    only per-grid symbol sizes, fixed reserved/N/Al, Z within 1..K) and catchable
    `createDecoder` failures.
  - `receive-session.test.ts` — transferId+OTI lock (same-id/different-OTI
    rejected), grid/packet-size agreement, PayloadId-vs-packet-bytes veto before
    RaptorQ, contained decoder-construction failures, **contained `addPacket`
    failures (typed `decoder-failed` rejection, safe disposal even when
    `dispose` throws, later clean transfer locks and completes)**, exact
    packet-size feeding, progress capped at 99%, first-mismatch restart /
    second-mismatch unlock.
  - `receiver-finalize.test.ts` (happy-dom) — finalization ownership under a
    Reset race with deferred SHA-256 promises: the stale finalizer resolves
    after Reset and after the new finalizer starts, mutates no UI, creates no
    Blob URL, cannot admit a third finalization while the current one is
    pending; completion yields exactly one download URL, terminates the
    worker, and stops the camera.
  - `receive-pipeline.test.ts` — production path decodes clean frames with running
    displayedSeen/decoded/dups/per-reason reject stats; `nofinder` (not `nogrid`)
    for code-free scenes; strictly consecutive finder streaks (focus freeze cannot
    arm across interleaved no-finder frames); dup after header before payload;
    locked-session filtering incl. same-id/different-OTI; payload-mismatch veto;
    malformed frames absorbed as errors with the loop continuing; grid lock after
    3 agreements and reset.
  - `frame-gate.test.ts` — at most one delayed bitmap acquisition in flight, later
    pulses dropped never queued; busy drops; stop→dispose; failure recovery;
    reentrancy-safe delivery.
  - `transfer.test.ts` — container roundtrip, deflate-only-if-smaller, bounded
    hostile parses, code-point-safe filename truncation, sanitization.
  - `frame-roundtrip.test.ts` — fixed-seed frame hashes pinned per grid; exact
    finder/beacon/calibration RGB values; transfer-id lock; malformed input
    returns null; **corrupted first header copy falls back to the intact second
    at N100/N140** (and the same corruption is fatal at single-copy N60,
    proving the test bites).
  - `vision.test.ts` — 100 random distorted frames per grid (±8° rotation, ±4%
    corner perspective, σ8 noise, ±20 brightness) through the **production
    receive path**: **N100 99.0% (gate ≥95), N60 98.0% (gate ≥98)**; `nofinder`
    for a code-free scene; gate-scale box blur (radius 13/14 ≙ radius 3 in the
    160 px gate domain) rejected as blur through the normal 720 px capture path,
    radius-3 capture blur pinned as decodable (see `blur-measurements.log`);
    N locks after 3 agreeing frames.
  - `e2e-loopback.test.ts` — 1 MiB file → container → fountain (N100) → frames →
    **full phase-3 distortion** → production vision/decode → session-locked
    fountain decode with uniform 20% frame loss: K=364, emitted 475 ≤ budget 492
    (K·1.35), decoder built from the first decoded header OTI, final lock equals
    the sender identity, SHA-256 exact; post-RS payload byte flip rejected by
    CRC before the fountain decoder.
  - `constraints.test.ts` — lib is DOM-free; only `fountain.ts` imports raptorq;
    worker imports lib only; sender/receiver never import each other; tests
    import lib only, with a single named exception for the receiver lifecycle
    test (`receiver-finalize.test.ts` may import `src/receiver`).
- `npm run build` — Vite 8.2.1, single JS asset (raptorq wasm embedded as bytes,
  decode worker inlined), no separate runtime assets.
- Export determinism — two full `npm run build` + `export-suite.mjs` cycles
  produce byte-identical `tools/chromalink.html` (final hardening pass:
  sha256 `af37d5be…3793`; the review-fix pass hash `44244e14…67fb06` belongs
  to the pre-hardening source).
- No absolute cwd leaked into the bundle.
- Phase 2 standalone preview + curl smoke: `phase2-preview-curl.log`.

## Local Suite gates (all green)

Log: `final-suite-gates.log`

- `python3 build.py` — 105 files built; `dist/chromalink.html` generated,
  never hand-edited; PWA precache regenerated (`suite-v4-…`, 109 entries).
- `python3 build.py --check` — all fatal gates green with 104 manifest tools;
  negative tests fire.
- `node tests/chromalink-built.mjs` — **58/58**: exact status-contract strings in
  the bundle (`Searching for code…`, both corruption texts, `Camera permission
  required`); file:// boot under the generated CSP with zero console/page
  errors, zero CSP violations, zero network requests; wasm init; sender streams
  (exact hint text, advancing frames, exact-white quiet zone, integer square
  canvas, locked selects, clean stop); exact denied state with retry;
  fake-camera worker loop reaching the exact `Searching for code…` state after
  1 s; **70vmin guide geometry (square, exact side, centered) on desktop and
  mobile**; lifecycle races: Retry storm opens one camera at a time, repeated
  Reset reuses the open camera and keeps the loop alive, getUserMedia resolving
  after pagehide stops the track, a wake lock granted after Stop is released,
  and a sender failure after the full-white stage is appended removes the stage,
  unlocks the controls, and reports a visible error; **Start-button validity
  (final hardening pass): Start disabled while a stream is active, re-armed
  after Stop, kept disabled after a start-time empty read of the selected
  file, re-armed by a fresh selection which then streams normally**. This
  gate now runs in `.github/workflows/pages.yml` before every deploy.
- `node tests/optical-built.mjs` — PASS (Optical Transfer unregressed).
- `node tests/audio-modem.mjs`, `node tests/audio-built.mjs` — PASS (Audio
  Transfer unregressed).
- `node tests/smoke.mjs` — 105/105 green (`final-smoke.log`).
- `git diff --check` — clean.

## Screenshots (refreshed by the final gate run)

- `built-desktop-chooser.png` — Send/Receive chooser, desktop, from file://.
- `built-desktop-sender-stream.png` — live sender stream (N100 frame on the
  white stage with counter/Stop/hint).
- `built-desktop-receiver-searching.png` — receiver with fake camera: centered
  square aiming guide and the exact `Searching for code…` status.
- `built-mobile-chooser.png` — 390×844 mobile layout.
- `built-mobile-receiver-guide.png` — 390×844 receive stage with the 70vmin
  guide and the exact `Searching for code…` status.

## Measurement evidence

- `red-regressions.log` — the RED failing runs captured before the fixes.
- `blur-measurements.log` — sharpness + decode rate vs box blur radius in the
  normal 720 px capture path; the basis for the honest blur-gate contract
  (radius-3 capture blur decodes 88% and must pass; gate-scale radius 13/14
  is rejected). The literal "radius-3@720 ⇒ blur" reading is contradicted by
  this table and was deliberately not implemented.
- `vision-tuning.log` — original tuning ladder plus the 2026-08-09 gate-path
  note (production-path gates, unchanged floors).

## Allowed-skip usage

None. The Node raptorq wasm initializes normally, and both synthetic vision
gates pass at their primary thresholds (N100 99% ≥ 95, N60 98% ≥ 98), so
neither the Node-wasm skip nor the relaxed N100 ≥ 90 rule was needed.

## Physical-device limitations (honest boundaries)

- No ADB device was attached at any point — `adb devices` was empty in the
  original session, during the 2026-08-09 review-fix pass, and again during
  the 2026-08-09 final hardening pass — so no real-device Android QA was
  possible. No physical two-phone run exists.
- Synthetic-camera and fake-device browser gates do not prove two-phone
  over-air compatibility, reliability, range, or goodput. Real screens and
  cameras add exposure/focus dynamics, rolling shutter, Moiré, color
  response, and frame-pacing effects the synthetic model does not cover.
  The tool page and all documentation state this explicitly; physical
  performance remains an unverified beta claim.
