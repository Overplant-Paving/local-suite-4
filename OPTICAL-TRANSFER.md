# Optical Transfer

`optical.html` is a Local Suite send/receive page for moving a file or text
snippet from a screen to another device's camera. Payload bytes never use a
network path. The hosted page itself may be fetched normally; after the Local
Suite service worker caches it, the same HTTPS origin can run offline.

The implementation is based on the [Tom's Hardware report](https://www.tomshardware.com/networking/streaming-qr-codes-at-60-fps-achieves-nearly-190-kb-s-data-rate-in-phone-to-phone-tests-browser-based-method-requires-no-app-no-networking-no-pairing-and-no-permissions-beyond-camera-access)
and independently adapts Decimen Optical Transfer snapshot
`ed4cbcf558b80913fcba2e91193f71801f8e919c`. Upstream's ~128 KB/s handheld and
~186 KB/s stationary/propped parent-experiment results are observations from
that setup, not promises for Local Suite. Camera focus, screen refresh, distance,
frame density, and device performance dominate real throughput.

## User-visible contract

- Send accepts one non-empty file up to 16 MB or one UTF-8 text snippet up to
  1 MB. Packing, optional gzip, SHA-256, fountain encoding, and QR rendering are
  local browser operations.
- The stream is endless until paused, reset, or the page changes mode. The safe
  default is 1,465 bytes per QR frame at 24 FPS and QR ECC L.
- Sender QR sizing is derived from the rendered stage and uses an integer module
  scale, so responsive desktop columns cannot stretch the symbol. A resize
  recalculates the square while preserving the wire format.
- High-contrast animation can affect people sensitive to flashing. Pause freezes
  the symbol, and `prefers-reduced-motion` limits sender presentation to 2 FPS
  without catch-up bursts.
- Receive requests only camera permission. It never uploads a captured frame.
- Any camera with a view of the sender can recover the payload. This is a
  no-network transport, not encryption or confidentiality.
- The sender works from `file://`. Desktop browsers may allow a local-file
  receiver, but iOS Safari and Android Chrome generally do not. Mobile receive
  should use hosted HTTPS. A cached/installed Local Suite PWA then continues to
  work offline while retaining that HTTPS origin.

## Wire and recovery architecture

The format remains compatible with the audited Decimen DCF2 protocol:

1. A DCF2 container stores compression mode, bounded UTF-8 filename/media type,
   exact original and transmitted lengths, payload SHA-256, and bytes.
2. The container is divided into fixed source blocks.
3. Every frame carries a 20-byte little-endian header: magic, session id,
   sequence, source block count, block length, container length, and FNV-1a
   optical checksum.
4. A deterministic robust-soliton LT encoder XORs a sequence-selected subset of
   source blocks. The exact deterministic logarithm and integer PRNG avoid
   sender/receiver disagreement across JavaScript engines.
5. The receiver peels equations from any order. Dropped frames slow arrival;
   duplicate frames are counted and ignored.
6. FNV-1a rejects a corrupted recovered container before parsing. DCF2 bounds,
   optional bounded gzip expansion, and SHA-256 verification must all pass
   before the UI reaches 100% or creates a download/copy action.

“SHA-256 integrity verified” means the reconstructed bytes match the digest in
the same transfer. It does not authenticate or establish trust in the sender.

The one-page combination does not mix sender and receiver state. Selecting a
new tab stops the sender or resets the receiver and tears down active camera
workers. Sender tuning creates a fresh random session. Receive requires two
distinct valid frames from another identity
before replacing an active decoder, which prevents one stray QR from discarding
progress. Generation tokens also invalidate late camera-permission resolutions
and asynchronous verification after a reset, mode switch, or page lifecycle end.

## Security and memory boundaries

Frame validation runs before creating a fountain decoder. It rejects:

- frames beyond QR v40 byte capacity;
- zero or inconsistent `k`, block length, and container length;
- container sizes above the 16 MB payload plus bounded metadata envelope;
- a block count that is not exactly `ceil(totalLen / blockLen)`.

Container parsing limits names to 1,024 UTF-8 bytes and media types to 255,
requires exact length equality, restricts original/transmitted data to 16 MB,
checks gzip magic/method/trailer, and counts decompressed chunks against the
declared original length. Received filenames are reduced to a basename,
normalized, stripped of controls/bidirectional formatting and reserved path
characters, bounded, and guarded against Windows device names.

One ZXing worker is the default because each worker instantiates its own
~919 KB WASM module and working memory. A second worker is an opt-in tuning
choice. Busy workers drop rather than queue camera frames. Stop, mode switch,
reset, completion, and `pagehide` all terminate workers, revoke Blob URLs, stop
camera tracks, and invalidate capture callbacks with a generation counter.

The fountain decoder caps retained unique equations at four times the source-
block count and additionally constrains their padded equation buffers to a
32 MiB budget (with fixed lower and upper bounds). The payload limit is not a
peak-memory claim: solved blocks, camera RGBA frames, WASM, compression, and
browser overhead are additional. Exceeding the
ceiling aborts and resets that optical session instead of allowing hostile,
valid-looking frames to grow memory indefinitely.

## Self-contained build and CSP

Source inspection assets live under `assets/optical/`. `build.py` performs two
optical-specific deterministic transforms:

- inline the local node-qrcode browser bundle;
- rewrite the pinned worker's WASM locator to a data URI, then inline the worker
  source as a Blob string.

Generated `dist/optical.html` makes no runtime asset request and remains a
single file. Its manifest entry adds only the CSP sources needed by this page:
`'wasm-unsafe-eval'`, `connect-src data:`, `worker-src blob:`, and local
Blob/media sources. Other tools keep their existing policy. PWA precaching is
manifest-derived, so `optical.html` is included automatically.

Licenses, exact artifact hashes, and upstream provenance are preserved in
`assets/optical/PROVENANCE.md` and `assets/optical/LICENSE-APACHE-2.0`.

## Verification

The focused gate is:

```sh
node tests/optical-built.mjs
```

It pins protocol/CDF/subset vectors; reconstructs with dropped, duplicate, and
shuffled frames; tests corruption, malformed lengths, gzip expansion, filename
sanitization, and session replacement; exercises file Send and verified/no-
download Receive UI paths; warms the real inlined ZXing worker/WASM under CSP;
tests unavailable/denied camera states with deterministic stubs; and exercises
late camera permission and in-flight verification cancellation races. It also
checks composited QR geometry at desktop breakpoints, hidden-sender shutdown,
camera metric refresh, tuning compatibility, integrity wording, and vendored
asset hashes.
