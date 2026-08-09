# Local Suite v4.3.4

Local Suite v4.3.4 adds **Optical Transfer Beta** as the 105th manifest tool and the third card in **Beta Tools**. The stable Optical Transfer page remains available under its existing identity and is preserved byte-for-byte.

## Optical Transfer Beta

- Separate `optical-beta.html` Send/Receive tool built from the stable DCF2/LT optical-transfer foundation.
- Receiver camera-rate choices are 30, 60, 90, and 120 FPS; 30 FPS remains the compatibility-safe default.
- High frame rates are browser/device requests, not guarantees. The browser or camera may cap the rate or reduce delivered resolution.
- Camera mode reports the values returned by `MediaStreamTrack.getSettings()`. When frame rate is absent, the UI says `FPS unreported` rather than substituting the request.
- Live `applyConstraints()` operations are serialized so an older delayed request cannot become the final camera configuration after a newer selection.
- The DCF2/LT wire format, payload limits, compression/integrity model, filename hardening, memory ceilings, reduced-motion behavior, and sender/receiver security boundaries are unchanged from stable Optical Transfer.

## Stable preservation

The following stable artifacts are byte-for-byte identical to v4.3.3:

- `tools/optical.html`
- `dist/optical.html`
- `tests/optical-built.mjs`
- `OPTICAL-TRANSFER.md`

The Beta variant reuses the same pinned node-qrcode and ZXing-C++ WASM artifacts. Build support is restricted to the exact `optical.html` and `optical-beta.html` filenames, and each page receives only its manifest-scoped CSP allowances.

## Suite integration

- 105 manifest tools plus the generated hub: 106 HTML pages.
- PWA precache: 110 entries under the content-hashed `suite-v4-` cache.
- Optical Transfer Beta is a distinct `cat: beta` manifest entry; stable Optical Transfer remains `cat: util`.
- The generated hub renders Optical Transfer Beta inside `🧪 Beta Tools`.
- Pages CI runs both `tests/optical-built.mjs` and `tests/optical-beta-built.mjs` before deployment.

## Verification

- Stable Optical Transfer focused gate: PASS.
- Optical Transfer Beta focused gate: PASS, including startup/live 90/120 FPS requests, capped and omitted delivered settings, and rapid out-of-order constraint regression coverage.
- Authoritative build/CSP/staleness gates: PASS at 105 manifest tools.
- Whole-suite smoke: 106/106 generated pages.
- PWA coexistence: PASS with 110 current entries and preserved v3 cache.
- Stable artifacts: byte-for-byte identical to v4.3.3.

## Claim boundary

No physical-device test in this release proves that a particular browser/camera combination delivers 90 or 120 FPS or improves end-to-end transfer throughput. High-FPS modes remain explicit Beta requests; the delivered Camera mode is the authoritative runtime report.
