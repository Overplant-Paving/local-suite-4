# CHROMALINK — implementation contract

## Product and integration scope

Build CHROMALINK, a browser app that moves one file optically between two phones. The sender animates 8-color 2D frames; the receiver decodes through the camera using RaptorQ fountain coding. Payload bytes never traverse a network. End users open a URL on two phones; there are no installs or accounts. Chrome for Android is primary, iOS Safari secondary, desktop browsers support development.

CHROMALINK is a NEW Local Suite tool. It MUST NOT replace, rename, rewrite, or regress `tools/optical.html`, Optical Transfer, its assets/tests/docs, or Audio Transfer. Base work on the current branch, which includes v4.3.2. Add a distinct manifest card/tool (prefer id `chromalink`, name `ChromaLink`, Beta Tools category if repository conventions support it). Preserve Local Suite’s source/dist discipline and self-contained generated page contract.

The protocol implementation lives as a strict TypeScript/Vite subproject under `chromalink/`. `npm run build` must produce `chromalink/dist/`. Also provide a deterministic export/integration step that creates or updates Local Suite source `tools/chromalink.html` from that build without hand-editing Local Suite `dist/`; then `python3 build.py` creates `dist/chromalink.html`. The final Local Suite page must be self-contained/double-clickable for sender/core functionality. Camera receive must honestly explain that mobile browsers generally require hosted HTTPS. If WASM/worker bundling requires build-system support, implement a deterministic narrowly scoped transform and provenance; do not weaken unrelated tools’ CSP. Keep all npm dependencies confined to `chromalink/`; Local Suite consumers still need no npm/runtime dependency.

Deployment is static HTTPS. No UI framework, React, or Tailwind. Plain TypeScript and DOM.

## Required standalone stack

- TypeScript 7.0.2 strict, ES2022; Vite 8.2.1; `base:'./'`; worker format `es`; top-level await allowed.
- `raptorq@1.7.24` (wasm-bindgen cberner/raptorq, RFC 6330). Inspect its installed `.d.ts`; actual exports override assumptions.
- `fflate@0.8.3`; `crc-32@1.2.2`; WebCrypto SHA-256 in app.
- Vitest locked in package-lock. Node test hashing may use `@noble/hashes@2.3.0` (the source prompt’s `@file:` tokens are formatting artifacts, not package names).
- In-project GF(256)/Reed–Solomon. No external RS dependency.
- Node >=20 and npm required. Use `npm ci` after the initial lockfile.

Expected subproject:

```
chromalink/
  index.html package.json package-lock.json vite.config.ts tsconfig.json
  src/main.ts
  src/lib/{constants,palette,layout,gf256,rs,crc,header,frame-encode,frame-decode,fountain,transfer}.ts
  src/lib/vision/{image,threshold,finder,homography,sampler,classify}.ts
  src/sender/{sender-app,renderer}.ts
  src/receiver/{receiver-app,camera,decode-worker}.ts
  src/ui/styles.css
  test/{rs,layout,header,frame-roundtrip,e2e-loopback}.test.ts
  test/synthetic.ts
  public/
```

`src/lib/**` is DOM-free and imports only `src/lib/**` or npm packages. No `document`, `window`, `navigator`, or `OffscreenCanvas`; enforce with Vitest. `src/lib/fountain.ts` is the sole `raptorq` importer. Worker imports lib only. Sender and receiver never import each other. Tests import lib only.

## Protocol constants and palette

In `constants.ts`:

```ts
MAGIC=0xC7; PROTOCOL_VERSION=1;
GRID_SIZES=[60,100,140] as const; DEFAULT_GRID=100;
SENDER_FPS_OPTIONS=[15,20,24] as const; DEFAULT_FPS=20;
RS_DATA=223; RS_TOTAL=255;
HEADER_BYTES=28; HEADER_RS_PARITY=14;
CAL_ROWS=2; FINDER_SIZE=7; BEACON_RESERVED=7;
SHARPNESS_MIN=25; WORKER_BUSY_POLICY='drop';
```

Palette indices 0..7 map bits `(R=bit2,G=bit1,B=bit0)` to exact sRGB: black, blue, green, cyan, red, magenta, yellow, white. Payload bitstream is MSB-first, 3 bits/module, zero-padded in the final module.

## Shared frame layout

N is 60, 100, or 140; coordinates `(col,row)`.

1. QR-style 7x7 binary finders at TL `(0,0)`, TR `(N-7,0)`, BL `(0,N-7)`, each with white inner-side separator, reserving each 8x8 corner block.
2. Bottom-right 6x6 beacon plus inner-side separator reserves 7x7; solid black on even displayed sequence, white on odd.
3. Calibration rows `N-2..N-1`, cols `8..N-9`, width `W=N-16`; eight palette patches using boundaries `8+floor(iW/8)` through `8+floor((i+1)W/8)-1`.
4. Header region rows 0..7, cols 8..N-9. Write the 42-byte/336-bit protected header row-major. If capacity >=672, write a second copy. Fill remaining bits by repeating header bits from bit zero. Thus N60=352 bits, N100=672, N140=992.
5. Data is every other module, row-major.

`layout.ts` exports `reservedMask(n)`, `dataModuleOrder(n)`, and `capacity(n)`. `rawBytes=floor(dataModules*3/8)`. Payload capacity follows RS interleaving below. No per-N geometry magic outside formulas.

## Header and CRC

28-byte big-endian header:

- 0: magic u8
- 1: version u8
- 2..5: transferId u32
- 6..17: exact 12-byte RaptorQ OTI
- 18..21: exact 4-byte RaptorQ PayloadId
- 22..25: CRC32 of post-inner-RS-decoded payload bytes
- 26..27: CRC16-CCITT poly 0x1021 init 0xFFFF over bytes 0..25

Append 14 RS bytes => RS(42,28), correcting 7 bytes. Decode first copy, then second if available. Verify magic/version/CRC16 before payload. First valid transferId locks receiver; never accept a differing ID while locked.

## Inner Reed–Solomon and payload interleaving

GF(256), primitive polynomial 0x11D, alpha=2; module-load exp/log tables. Export:

```ts
encode(data: Uint8Array, parityLen: number): Uint8Array // systematic data||parity
decode(codeword: Uint8Array, parityLen: number): Uint8Array | null
```

Decode using BM + Chien + Forney; correct <= parityLen/2; return null on failure.

For raw capacity R, `C=ceil(R/255)` and payload capacity `P=R-C*32`. Split P into C deterministic near-equal data chunks: chunk i length `floor(P/C)+(i<P%C?1:0)`. Encode each with 32 parity bytes and interleave byte-wise (`j*C+i` is codeword i byte j). Reverse exactly. Where raw capacity does not fill a final rectangular slot, define deterministic bounded lengths and test exact recovery—never read/write past R.

Test alpha^255=1; 1,000 random RS codewords with 0..16 byte errors recover exactly. A 17-error miscorrection must be caught by frame CRC in harness.

## Frame codec

`frame-encode` takes `{n, header, payload}` with payload exactly capacity payload bytes and returns n*n palette indices. It paints all binary/calibration/header regions, inner-RS-interleaves payload, and writes 3-bit modules. Sequence/beacon parity must be represented unambiguously in encode input/header scheduling.

`frame-decode` accepts n*n classified indices plus expected transfer ID or null and returns `{header,payload}|null`. Header validation precedes payload. Every codeword must decode, then payload CRC32 must match. No malformed input may throw; return null.

## Transfer container and RaptorQ wrapper

Transfer blob:

- u8 UTF-8 filename byte length (truncate safely to <=255 bytes)
- filename bytes
- original size uint64 BE
- original SHA-256 (32 bytes)
- compression u8 (1=deflate, 0=stored)
- compressed bytes only if `deflateSync` is smaller; else raw

Support one file, any type, <=64 MiB; larger inline error is exactly `Max 64 MB`.

`fountain.ts` exposes exactly:

```ts
initFountain(): Promise<void>
createEncoder(data: Uint8Array, symbolSize: number): {oti:Uint8Array; nextPacket():Uint8Array}
createDecoder(oti:Uint8Array): {addPacket(pkt:Uint8Array):Uint8Array|null}
```

OTI exactly 12 bytes, packet `4-byte PayloadId + symbolSize`. Adapt to actual wasm API; buffer batches and request repair batches of 500 if needed. Sender schedule: all systematic source symbols in order, round-robin blocks, then repair round-robin forever.

Receiver derives K from OTI, feeds only CRC-clean packets, completes only after parse/inflate and SHA-256 comparison. On first digest mismatch reset decoder with locked OTI and continue; second mismatch also unlock transferId. Progress is `min(uniquePayloadIds/K,.99)` until complete.

## Sender UI/renderer

Mode chooser has two full-width Send/Receive buttons and honors `?mode=send|receive`. Initialize fountain before mounting; show Loading; 10s timeout produces reload UI.

Sender: picker, grid select `60 Robust / 100 Standard / 140 Dense`, fps 15/20/24, Start. On stream: code, frame counter, Stop, and exact hint: `Prop both phones against something for best speed. Set screen brightness to max.` White page/background. Grid and FPS lock after start; changing either tears down and creates a new transfer/session ID.

Ordered start: build blob; choose locked N/fps; create encoder with payload capacity; random u32 transferId via `crypto.getRandomValues`; request wake lock and continue if unavailable.

Use `setInterval(1000/fps)`, not rAF. Pause interval/sequence while hidden and resume visible. One packet per displayed frame; never reuse beacon parity for different symbols.

Renderer canvas CSS size `min(viewportW,viewportH)-16px`, exact white, integer device pixels `floor(canvasCSSPx*dpr/(N+8))`, 4-module quiet zone. sRGB opaque context; smoothing off; exact module rects; no bitmap/CSS scaling.

## Camera

Request environment camera at ideal 1920x1080 and 60fps. NotAllowedError => exact `Camera permission required` with retry. Overconstrained => retry once with environment facing only.

Read capabilities once. Apply each supported constraint once/session, logging/continuing on rejection: manual exposure + exposureTime max(min,20); after 30 consecutive finder-positive worker frames freeze manual focus at current focusDistance and manual white balance at current colorTemperature. Safari/default-control fallback must work.

Pump via `requestVideoFrameCallback`; rAF fallback. If worker busy, drop. Else transfer an ImageBitmap. Never queue.

## Vision pipeline

Worker owns OffscreenCanvas, closes every bitmap, and catches all per-frame exceptions. Pipeline on plain image buffers:

1. nearest-neighbor grayscale downscale width 160; Laplacian variance below 25 => blur.
2. integral adaptive threshold, window width/8, bias -7.
3. Scan rows and columns for 1:1:3:1:1 black/white runs, +/-45%; cluster within 5 px, >=2 confirmations, retain strongest 3. Assign TL by closest perpendicular vectors and orient TR/BL for positive cross product. Fewer than 3 => nofinder.
4. BR estimate TR+BL-TL; search a 15%-grid window for largest uniform 6x6 beacon; fall back to parallelogram.
5. 4-point DLT via 8x8 Gaussian elimination with pivoting; bilinear warp/sample.
6. If N unknown, try each grid and select calibration strip with max inter-patch RGB variance plus patch0 darkest/patch7 brightest. Lock after 3 consecutive agreement.
7. Calibration patch mean from central 60%; white-black norm >=60 else washout.
8. Each module: bilinear sample 3x3 points over central 50%, average, nearest calibration RGB squared distance.
9. Frame-decode; success posts packet and running reject/display/decode stats.
10. Same PayloadId as last successful => `dup` after header decode and before payload work.

Target <=12ms/frame at N100 on 2022-class phone; cheap rejects first, buffers reused. Status: Searching after no finder for 1s; Hold steady when blur >40% last 30; Move closer when locked and pitch <3.5 camera px; else `{pct}% · {kbps} KB/s`.

Completion shows name, size, elapsed, average KB/s, download URL, 880Hz 200ms beep, optional vibration 200ms.

## Synthetic and E2E verification

Pure-math `test/synthetic.ts`: raw RGB frame renderer plus inverse-homography perspective, rotation, Gaussian noise, brightness, and box blur.

Phase gates, after every phase: `npx tsc --noEmit`, `npx vitest run`, `npm run build` all exit 0.

1. Core: capacity regression anchors for all N; headers recover 7 corrupt bytes and reject 8; fountain roundtrip 100KiB systematic packets; build. If Node WASM cannot initialize after 3 actual attempts, skip only that test with exact reason in `errors.log` and rely on browser/E2E.
2. Sender: fixed-seed encoded frame stability; raw RGB exact finder/beacon/calibration values; standalone preview and curl smoke.
3. Vision: 100 random distorted frames each. N100 >=95%, N60 >=98%; rotation +/-8deg, corner perspective +/-4%, sigma8 noise, brightness +/-20. Blur radius 3 rejected as blur. Tune only in this sequence if low: sample fraction 50->40, threshold bias -7->-10, finder tolerance 45->55. If still low, permit N100 >=90 only with all attempts logged.
4. E2E Node: 1MiB random file -> transfer -> fountain N100 -> frame -> synthetic distortion -> vision -> frame decode -> fountain decode, with uniform 20% pre-pipeline frame loss. Complete within K*1.35 emitted and SHA-256 equal. Flip a post-RS payload byte in one frame and prove CRC rejection before decoder.

Final standalone checks: full Vitest, build, and no absolute cwd leaked into bundle. Final Local Suite checks: deterministic integration/export, `python3 build.py`, new focused built-page/browser gate, `python3 build.py --check`, `node tests/smoke.mjs`, `git diff --check`; retain all existing Optical and Audio focused tests green. Add archived evidence under `tests/evidence/chromalink/`, including command logs and desktop/mobile screenshots. Do not publish, push, tag, or open a PR unless explicitly requested.

## Code conventions and failure policy

Files kebab-case; PascalCase types; camelCase functions/variables; shared constants only in constants/layout. Strict `noUncheckedIndexedAccess`; no `any`. Lib is pure or caller-buffer oriented; no mutable module state except GF tables. Fallible decode returns null; app async catches/logs and gives visible status.

Fix first specific failing error and rerun. Never fabricate/skips gates merely to finish. The source prompt allowed a narrow skip only for Node-incompatible RaptorQ and a reduced N100 vision threshold after exactly the prescribed tuning attempts; use no other test skip as a substitute for a working implementation. Record honest physical-device limitations: synthetic/browser gates do not prove two-phone optical performance. Use the connected Pixel 10 Pro XL via ADB for real Android browser/device QA if feasible, without changing system settings destructively.
