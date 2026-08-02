# Optical Transfer — Sol engineering report

Date: 2026-08-01

Upstream snapshot: `ed4cbcf558b80913fcba2e91193f71801f8e919c`

Local Suite artifact: `dist/optical.html`

## Result

Implemented a production-oriented, single-page Send/Receive Optical Transfer
tool. Files and text become an endless animated QR stream. Receive uses the
real inlined ZXing-WASM camera decoder and deterministic LT fountain recovery,
then withholds all download/copy actions until the reconstructed DCF2 container
passes its optical checksum, structural checks, bounded decompression, and
SHA-256 verification.

The generated page is 1,399,848 bytes, makes no external runtime request, and
is included in the 107-entry PWA precache. Send runs from `file://`. Mobile
camera receive is accurately described as generally requiring hosted HTTPS;
the installed/cached Local Suite PWA retains that secure origin for later
offline use.

## Files

- `tools/optical.html` — source UI, protocol, sender, fountain recovery,
  receiver state machine, camera lifecycle, and test surface.
- `assets/optical/qrcode.js` — pinned local QR encoder browser bundle.
- `assets/optical/zxing-worker.js` and `zxing_reader.wasm` — pinned camera
  decoder inputs embedded by the build.
- `assets/optical/PROVENANCE.md` and `LICENSE-APACHE-2.0` — hashes, MIT notices,
  ZXing attribution, and Apache-2.0 text.
- `manifest/tools.json`, `build.py` — tool registration, scoped CSP, vendor
  inlining, worker/WASM data-URI transform, and PWA generation.
- `tests/optical-built.mjs` — deterministic protocol/security/browser gate.
- `.github/workflows/pages.yml` — focused test added to CI.
- `OPTICAL-TRANSFER.md`, `CATALOG.md`, `README.md`, `CLAUDE.md`,
  `ARCHITECTURE.md`, `QUALITY.md`, `ROADMAP.md` — product and suite docs.
- `dist/optical.html`, `dist/index.html`, `dist/sw.js` — generated only by
  `build.py`; none were hand-edited.

## Architecture and boundaries

1. Send constructs a bounded DCF2 container with safe metadata, exact original
   and transmitted lengths, optional beneficial gzip, and SHA-256.
2. A pinned deterministic robust-soliton LT encoder selects source-block
   subsets from session/sequence values and emits 20-byte-header fountain
   frames. The sender renders them continuously as QR symbols.
3. Receive captures frames only while a decoder worker is idle. The worker and
   ~919 KB WASM reader are inlined into the generated page; no decoder fetch is
   performed at runtime.
4. Frame fields are validated before decoder allocation. The peeling decoder
   accepts drops, duplicates, and arbitrary order. Unique unsolved equations
   are bounded to prevent hostile valid-looking frames from growing memory.
5. A different session must present two distinct valid frames before replacing
   current recovery. Generation tokens prevent stale camera callbacks from
   entering replacement state, late permission grants from opening a camera
   after a mode switch, and verification completion after a receiver reset.
6. Completion remains at most 99% until FNV reconstruction, DCF2 parsing,
   length/decompression bounds, and SHA-256 all pass. Failure creates no
   download. Success uses a sanitized filename and safe media type.
7. Stop, mode changes, reset, completion, and `pagehide` stop camera tracks,
   terminate workers, revoke Blob URLs, and clear session state.

Default limits are 16 MB per file, 1 MB UTF-8 text, 1,465 data bytes/frame,
24 FPS, QR ECC L, and one worker. Two workers and conservative frame-size/FPS
tuning are explicit opt-ins.

## Verification

### Focused optical gate

Command:

```text
node tests/optical-built.mjs
```

Exact terminal result:

```text
ok   built page exposes the deterministic protocol API
ok   page load makes no HTTP(S) request
ok   page boot has no console/page errors
ok   page boot has no CSP violations
ok   20-byte little-endian frame golden vector
ok   frame golden vector parses exactly
ok   deterministic log golden vector
ok   robust-soliton CDF fingerprints
ok   fountain block-subset golden vector
ok   30% dropped frames recover exactly
ok   duplicate frames are ignored without corruption
ok   shuffled/out-of-order frames recover exactly
ok   changed payload fails SHA-256
ok   malformed/hostile frame headers are rejected before allocation
ok   malformed container magic and lengths are rejected
ok   gzip inflation stops at the declared ceiling
ok   unsolved unique equations stop at a bounded memory ceiling
ok   received filename sanitization handles paths, bidi, invalid and reserved names
ok   one stray valid frame cannot replace an active session
ok   two distinct frames replace and isolate the session
ok   UI Send flow packs locally and enables streaming
ok   UI Send flow renders a real animated QR frame
ok   animated stream has an explicit pause control
ok   rendered QR decodes through the real ZXing worker to a valid fountain frame
ok   receiver exposes a download only after SHA-256 verified completion
ok   corrupt recovered bytes create no download
ok   receiver reset invalidates an in-flight verification
ok   embedded ZXing worker and data-URI WASM warm under generated CSP
ok   worker warm-up makes no HTTP(S) request
ok   Receive reports unavailable camera / secure-context state
ok   Receive permission denial is explicit and retryable
ok   camera stop tears down tracks, workers, and Blob lifecycle slots
ok   Optical Transfer has no 390px mobile horizontal overflow
ok   late camera permission resolution cannot outlive a mode switch
ok   generated artifact is self-contained
ok   PWA app-shell cache includes optical.html
ok   generated CSP scopes WASM/data/blob allowances
ok   mobile HTTPS and PWA offline caveat is visible
ok   confidentiality warning is explicit

optical: PASS
```

### Build and suite gates

```text
$ python3 build.py --check
GATE release-tool-count   pass
GATE source-text-integrity pass
GATE manifest-files-sync  pass
GATE markers              pass
GATE dist-staleness       pass
GATE no-inline-handlers   pass
GATE csp                  pass
GATE escaping-heuristic   pass
GATE catalog-crosscheck   pass
GATE settings-signup-sync pass
GATE key-hygiene          pass
GATE no-example-urls      pass
GATE pwa-sync             pass
NEGATIVE TESTS          pass (all fatal gates seen to fail on fixtures)

manifest: 102 tools + hub  (71 v1 migrations, 31 suite-native)  by network: {'offline': 41, 'cors-open': 48, 'keyed': 10, 'blocked': 3}  flagged: 29

--check: all fatal gates green

$ node tests/smoke.mjs
smoke: 103/103 green

$ node tests/pwa-verify.mjs coexist
sw ready; caches: ["suite-v3-coexistence-fixture","suite-v4-2308f35ede90"] (expected suite-v4-2308f35ede90)
coexistence state after v4 activation: {"keys":["suite-v3-coexistence-fixture","suite-v4-2308f35ede90"],"currentEntries":107,"v3Body":"v3 offline shell","obsoleteV4Present":false}
V3/V4 CACHE COEXISTENCE OK
```

Visual evidence is saved as `sol-send-light.png`, `sol-send-dark.png`, and
