# Optical Transfer Beta

`optical-beta.html` is a separate Beta Tools variant of the stable
[`optical.html`](tools/optical.html) Optical Transfer page. It preserves the same
DCF2/LT wire format, payload limits, local-only processing, security boundaries,
and self-contained `file://` sender behavior while adding experimental receiver
camera-rate choices.

The stable Optical Transfer source, built page, documentation, and focused test
remain unchanged.

## Beta difference

Receive tuning can request **30, 60, 90, or 120 FPS**. The default remains 30 FPS.
These values are browser media constraints, not performance guarantees:

- the camera or browser may cap the requested rate;
- a high frame rate may reduce delivered resolution;
- `Camera mode` reports the settings returned by `MediaStreamTrack.getSettings()`;
- if the browser omits the delivered frame rate, the UI says `FPS unreported`
  instead of substituting the requested value.

Live camera constraints are serialized. If the user changes settings while an
older `applyConstraints()` call is pending, the newest selection is applied last;
stale completions cannot become the final camera mode or update torn-down UI.

## Build and verification

`build.py` embeds the same pinned ZXing worker/WASM and QR vendor assets used by
the stable tool, producing the self-contained `dist/optical-beta.html` page. The
manifest places it in **Beta Tools** and gives it the same narrowly scoped CSP
allowances as stable Optical Transfer.

Focused gate:

```sh
node tests/optical-beta-built.mjs
```

The gate retains the stable protocol, recovery, security, lifecycle, geometry,
CSP, and real ZXing round-trip coverage, then adds checks for 90/120 FPS options,
a device-capped delivered rate, an omitted delivered frame rate, and rapid
out-of-order live-setting changes.
