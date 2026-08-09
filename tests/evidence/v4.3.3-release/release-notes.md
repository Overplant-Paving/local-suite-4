# Local Suite v4.3.3

Local Suite v4.3.3 adds **ChromaLink** as the 104th manifest tool, the second card in the **Beta Tools** hub category. Audio Transfer is retained unchanged; Optical Transfer and its DCF2/LT wire format are untouched.

## ChromaLink beta

- Separate `chromalink.html` Send/Receive tool for phone-to-phone file transfer with light: the sender animates 8-color N×N frames (N ∈ {60, 100, 140} at 15/20/24 fps) on its screen; the receiver decodes them through its camera.
- Payload bytes never use a network path — no upload, relay, pairing server, or account.
- One file up to 64 MiB per transfer; a container carries the UTF-8 filename, exact length, SHA-256, and a raw-deflate flag (compression only when strictly smaller).
- RaptorQ (RFC 6330, `raptorq@1.7.24` wasm) fountain recovery: every systematic symbol round-robin, then deterministic repair symbols forever. Frames add an inner GF(256) RS(255,223) byte-interleave, RS(42,28)-protected dual-copy headers, and CRC32/CRC16 fail-closed validation.
- SHA-256-gated completion: no download is exposed unless the reassembled bytes reproduce the digest carried inside the transfer. A first digest mismatch restarts collection under the same locked transfer; a second also releases the lock.
- The sender works from `file://`; mobile camera receive generally requires the hosted HTTPS page, and the installed PWA keeps that secure origin available offline. The integrity check proves integrity, not sender identity, and any camera that can see the screen can receive — the page says both.
- Implementation is a strict TypeScript 7.0.2 / Vite 8.2.1 subproject in `chromalink/` (npm confined there, locked `package-lock.json`); `chromalink/scripts/export-suite.mjs` deterministically regenerates `tools/chromalink.html`, and `python3 build.py` emits the self-contained `dist/chromalink.html`.

## Integration, security, and lifecycle hardening

Two same-day hardening passes (2026-08-09, RED regressions written first where expressible) landed before this release:

- **Hostile-input bounds** — a received RaptorQ OTI must parse within wrapper bounds (transfer length capped at the 64 MiB container + overhead, fixed reserved/N/Al fields, only the three per-grid symbol sizes, fillable source blocks) and match the detected grid's packet size before a decoder is constructed; construction failures are contained as typed rejections.
- **Session locking** — the first accepted packet locks the receiver to its transferId AND exact 12-byte OTI; same-id/different-OTI frames never reach the decoder. A PayloadId-vs-packet-bytes veto runs before RaptorQ.
- **Decoder feed containment** — `decoder.addPacket` throwing inside the receive session is caught, the decoder disposed (dispose itself contained), the lock released, and a typed `decoder-failed` rejection returned; a later clean transfer locks and completes.
- **Session-scoped finalization ownership** — a stale SHA-256 finalizer resolving after Reset cannot mutate UI, create a Blob URL, or admit a duplicate finalization; completion yields exactly one download URL.
- **Sender Start validity** — Start is armed only while the selected file is non-empty, ≤64 MiB, not condemned by a start-time read, and no stream/start is in flight; overlapping streams from a second click are impossible.
- **Lifecycle guards** — serialized camera frame pump (at most one delayed bitmap acquisition in flight), one camera per Retry storm, camera reuse across Reset, getUserMedia resolving after pagehide stops the track, a wake lock granted after Stop is released, worker epoch invalidation on Reset, worker/camera/URL release on completion, and sender stage/encoder cleanup on failed start.
- **Receiver UX contract** — 70vmin centered square aiming guide; exact status texts (`Searching for code…`, `Hold steady`, `Move closer`, `Camera permission required`, both corruption texts); per-reason worker statistics; 240/320 px detection scales run only on decode failure.

## Suite integration

- 104 manifest tools plus the generated hub: 105 HTML pages.
- ChromaLink joins Audio Transfer under `🧪 Beta Tools`; manifest `since` is `v4.3.3`.
- PWA precache contains 109 entries (`suite-v4-` content-hash cache name).
- ChromaLink's manifest entry adds only `'wasm-unsafe-eval'`, `worker-src blob:`, and local media sources to its own generated CSP; no other tool's policy changes.
- Pages CI now runs `node tests/chromalink-built.mjs` before every deploy.
- Existing Optical Transfer (v4.3.1 hardening) and Audio Transfer (v4.3.2) behavior is retained; their focused gates were re-run green.

## Verification

Exact verified figures, all from synthetic/browser gates (detailed logs and screenshots: `tests/evidence/chromalink/`, not duplicated here):

- `npx tsc --noEmit` exit 0 (strict, `noUncheckedIndexedAccess`, no `any`); `npx vitest run` **82/82 tests across 13 files**, including 100-random-distorted-frame production-path gates at **N100 99.0% (floor ≥95%)** and **N60 98.0% (floor ≥98%)**, gate-scale blur rejection through the normal 720 px capture path with the measured radius-3-still-decodable pin, and a 1 MiB Node E2E loopback under full phase-3 distortion with 20% frame loss completing within K·1.35 emitted packets (K=364, emitted 475 ≤ budget 492) with an exact SHA-256.
- Export determinism: two full build + export cycles produce byte-identical `tools/chromalink.html`.
- `python3 build.py` — 105 files built, 109-entry precache; `python3 build.py --check` — all fatal gates green at 104 manifest tools with negative fixtures firing.
- `node tests/chromalink-built.mjs` — **58/58 checks**: file:// boot under the generated CSP with zero console/page/CSP/network events, wasm init, sender streaming on an exact-white integer-scaled canvas, exact camera-denied state, fake-camera worker loop to the exact `Searching for code…` state, 70vmin guide geometry on desktop and mobile, lifecycle-race regressions, and Start-button validity.
- `node tests/optical-built.mjs`, `node tests/audio-modem.mjs`, `node tests/audio-built.mjs` — PASS (no regression); `node tests/smoke.mjs` — 105/105 green; `git diff --check` — clean.

## Not verified — physical over-air transfer

**No real two-phone physical run exists.** No ADB device was ever attached during implementation or either hardening pass, so no real-device QA was possible. Synthetic-camera and fake-device browser gates do not prove two-phone over-air compatibility, reliability, range, or goodput: real screens and cameras add exposure/focus dynamics, rolling shutter, Moiré, color response, and frame pacing the synthetic model does not cover. Physical performance remains an unverified beta claim, stated on the tool page and in all documentation, until a documented hardware matrix exists.
