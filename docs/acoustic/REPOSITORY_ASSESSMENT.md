# Acoustic Modem Repository Assessment

Assessment date: 2026-08-07
Repository state assessed: `feat/acoustic-modem-codex` at `70d55ff22d67019d14f46d3ccdf7446d706709e3`
Product baseline assessed: Local Suite v4.3.1 at `725e5863429fc2b7b41f5f6ab797ee0d67f66023`

## Decision and evidence boundary

The repository is a suitable clean base for acoustic feasibility work. It contains no acoustic
implementation to reuse or recover. The current decision is **GO for the bounded feasibility
spikes and contracted vertical slices in `IMPLEMENTATION_PLAN.md`; NO-GO for broad product
implementation, parameter lock, release, or acoustic performance claims**.

This assessment combines repository inspection with the recovery audit, lead architecture, and
adversarial critique. Repository facts are distinguished from planned decisions and unverified
browser or hardware assumptions. No simulated, digital, WAV, cable, or same-device result may be
reported as two-device over-air evidence.

## Static, build-free product architecture

Local Suite is a static collection with no application server, account, framework, bundler, or
runtime package dependency. Consumers use committed files from `dist/`; contributors edit source
and run the Python standard-library generator.

| Concern | Repository evidence | Acoustic consequence |
|---|---|---|
| Consumer path | `README.md` directs users to `dist/index.html`; each generated page is intended to be self-contained and double-clickable. | The acoustic page must be a generated single HTML file and make no runtime module, CDN, WASM, API, or relay request. |
| Source path | `tools/*.html`, `core/`, `assets/`, `manifest/tools.json`, and `build.py` are authoritative. | Acoustic modules belong under `assets/acoustic/`; `tools/audio.html` is the application source. |
| Generated path | `dist/` is committed, deterministic output. `build.py --check` rejects stale or hand-edited HTML. | No lane may hand-edit `dist/audio.html`, `dist/sw.js`, or `dist/manifest.webmanifest`. |
| Toolchain | `build.py` uses Python standard-library modules and performs inlining, hub injection, CSP hashing, and PWA generation. | Acoustic embedding must be another deterministic, allowlisted build transform; it must not introduce a build dependency. |
| Source development | Source tools are valid HTML and use relative source assets directly. | The modular acoustic source must also run from its source paths; the build then removes those runtime source references from generated output. |

At the assessed baseline, the manifest contains 102 distinct tools, `tools/` and `dist/` each
contain 103 HTML pages including the hub, and the PWA precache contains 107 entries. These are
baseline measurements, not permanent constants. Adding one tool through the normal integration
path is expected to produce 103 manifest tools, 104 HTML pages, and normally 108 precache entries;
the generator remains the authority.

## Manifest, navigation, CSP, PWA, and deployment

`manifest/tools.json` is machine truth for hub navigation, storage/network metadata, endpoint
allowlists, generated CSP inputs, and PWA membership. `build.py` currently enforces an exact release
count of 102. An acoustic release therefore requires a coordinated count change, an `audio` manifest
entry, catalog and release documentation, regenerated artifacts, and tests. None belongs in this
architecture-only commit.

The generated CSP hashes every inline script. Network hosts come from manifest endpoints;
non-network scheme exceptions are restricted by `CSP_EXTRA_ALLOW`. Optical Transfer is the only
current page with a Blob/WASM worker exception. A dedicated Worker uses `worker-src`, but an
AudioWorklet Blob module is authorized through `script-src` (or its effective fallback), not merely
`worker-src`. The current allowlist permits no `script-src blob:` entry. Acoustic packaging therefore
requires a narrowly scoped generator change plus a real browser execution gate. A global CSP
relaxation is prohibited.

The PWA is additive and HTTP(S)-only. `core/suite.js` registers `sw.js` only when the protocol starts
with `http`. The service worker sequentially precaches generated application-shell files, never API
or transfer payload data, and uses relative paths suitable for the GitHub Pages project subpath.
Increasing the generated page size increases install/update/cache pressure; that cost must be
measured. Service-worker caching does not make a `file://` page a controlled client and does not
persist received chunks.

The Pages workflow runs `python3 build.py --check`, installs the locked Playwright test dependency,
runs focused tool gates including Optical Transfer, then full smoke and PWA coexistence tests before
publishing `dist/`. The workflow is Chromium-based; it supplies no Android, Firefox, WebKit, real
microphone, speaker, route-change, or physical-room evidence.

## `file://`, HTTPS, and browser capability boundary

The suite's primary-mode invariant is `file://`. Microphone capture and AudioWorklet loading depend
on secure-context and user-agent policy, and file origins may be opaque or unstable for storage.
API presence is not proof that permission, module loading, or persistence works.

Consequently:

- hosted HTTPS and an already-cached installed PWA are expected to be the most reliable full-modem
  contexts, but that expectation is not yet an acceptance decision;
- full microphone + AudioWorklet behavior from generated `file://` pages remains unverified;
- the feature may not silently redefine `file://` as UI-only or send-only;
- if the mandatory launch-mode spike cannot satisfy the existing product contract, work stops for
  an explicit product-scope decision instead of substituting `ScriptProcessor`, a server, or a
  hidden network path;
- localhost is useful laboratory evidence, not a substitute for the real GitHub Pages subpath,
  installed-offline PWA, or direct-file tests.

The initial declared laboratory matrix is desktop Chromium, Firefox, and WebKit/Safari where
available; Android Chromium is mandatory for mobile feasibility. Final supported browsers are set
only from recorded results. Browser mocks can prove UI and cleanup paths, not permission prompts,
the audio render thread, system processing, or acoustic compatibility.

## Reusable Optical Transfer patterns and isolation boundary

Optical Transfer is a strong repository pattern for:

- explicit payload, metadata, frame, decompression, and pending-buffer ceilings;
- validation before decoder allocation;
- cryptographically random session creation;
- final SHA-256 gating and integrity-versus-authenticity wording;
- safe filename/media handling and text-only metadata rendering;
- duplicate suppression, candidate-session isolation, and idempotent completion;
- generation-token cancellation, deterministic device teardown, transferred buffers, and Blob URL
  cleanup;
- generated one-page worker packaging, scoped CSP exceptions, pinned provenance, and focused tests;
- distinct recovery, verification, and download states.

It is not an acoustic protocol dependency. DCF2, its little-endian 20-byte header, FNV-1a, LT
fountain equations, QR encoder, ZXing worker/WASM, camera pipeline, and optical rate display remain
isolated. They do not provide CRC32C, acoustic FEC, OFDM acquisition, reverse ACKs, durable resume,
or half-duplex timing. Acoustic v1 deliberately uses a different versioned wire format.

## Audio, Worker, and allocation patterns

Existing audio tools provide only limited precedent. `metronome.html` creates/resumes an
`AudioContext` from a user gesture and schedules against the audio clock. `sound.html` uses the
actual `AudioContext.sampleRate`. Neither uses microphone input, AudioWorklet, deterministic DSP,
clock-drift recovery, or real-time buffer pools; Sound Machine also uses `Math.random` and is not a
seeded simulator.

Optical Transfer shows a generated Blob Worker with transferable buffers and bounded busy slots.
The modem can reuse that lifecycle concept, not the decoder. The planned runtime keeps only bounded
sample movement in an AudioWorklet, heavy DSP in one dedicated Worker, and UI/storage work on the
main thread. `SharedArrayBuffer` is not assumed because the repository does not provide COOP/COEP
response headers and `file://` cannot depend on them.

All real-time queues, typed-array pools, retransmission windows, logs, and diagnostic recordings
must have explicit ceilings. Worklet callbacks may not allocate per quantum, log, hash, access
IndexedDB, run FFT/FEC, or make protocol decisions. Capture overflow forces reacquisition; playback
underflow emits silence and a counter. Actual render-quantum lengths are observed rather than
hard-coded.

## Persistence, backup, and hashing

`Suite.store` is a `suite.*` localStorage wrapper with an in-memory fallback. The fallback preserves
tool operation but not persistence. The repository has no IndexedDB abstraction.

Settings backup directly enumerates raw `suite.*` localStorage values. It neither discovers nor
exports IndexedDB. Its current wording that every tool keeps all data in localStorage becomes false
once acoustic sessions exist and must be corrected during product integration. Acoustic partials:

- live in a dedicated, strongly namespaced IndexedDB database;
- are best-effort, origin-local resume convenience, not durable custody;
- do not cross between `file://` and hosted origins through Settings backup;
- are not included in the JSON backup;
- require in-tool inspect, expiry, delete, quota, corruption, and cleanup controls.

`hash.html` and Optical Transfer call `SubtleCrypto.digest()` on complete buffers. Standard Web
Crypto exposes no incremental digest API. Acoustic v1 therefore chooses a bounded whole-buffer
strategy: accept arbitrary binary content only from 1 byte through 16 MiB, hash one exact 16 MiB-or-
smaller buffer with Web Crypto, and release sender preparation buffers before streaming. The
receiver assembles at most 16 MiB from durable chunks into one exact buffer for final SHA-256, then
creates a download only after success. This is a correctness decision, not a peak-memory claim;
browser-internal digest and Blob copies still require a memory feasibility gate. If that gate fails,
the fallback is a separately reviewed incremental SHA-256 implementation with standard and
independent vectors—not an unbounded Web Crypto call or an increased file limit.

## Tests and evidence workflow

Repository quality has three established layers:

1. `python3 build.py --check` validates release count, source integrity, source/manifest sync,
   markers, generated staleness, inline handlers, CSP hashes, escaping/catalog/key advisories,
   example URLs, PWA sync, and negative fixtures.
2. `tests/smoke.mjs` opens every generated HTML page from `file://` in Chromium, checks visible
   chrome/theme operation, and rejects script/CSP failures.
3. Focused Playwright tests exercise deterministic tool contracts and generated artifacts.

The Optical gate is a useful structural model: byte vectors, malformed-input rejection, bounded
memory, duplicate/drop/reorder behavior, no-network assertions, real embedded worker warmup under
CSP, lifecycle races, responsive UI, generated PWA membership, and vendored hashes. Acoustic tests
must add independent encoder/decoder vectors, deterministic channel grids, real AudioWorklet
execution, IndexedDB transaction failures, and physical evidence. Same-implementation round trips
alone are insufficient.

Acoustic evidence uses exactly these labels:

1. deterministic simulation;
2. digital in-memory loopback;
3. digital WAV export/import;
4. wired audio connection;
5. same-device acoustic loopback;
6. two-device over-air.

Only label 6 can support an over-air compatibility, reliability, distance, turnaround, audibility,
or goodput claim. Physical compatibility is currently unverified.

## Security and privacy baseline

The modem has no network transport, but audible data is a public local channel. Nearby parties can
hear, record, replay, replace, inject, or jam it. CRC32C detects accidental decoded corruption; it
is not a MAC. SHA-256 proves that reconstructed bytes match the received manifest; without an
authenticated manifest it does not identify the sender.

Acoustic v1 provides neither encryption nor sender authentication. Reserved encryption flags fail
closed. A future encrypted mode requires a complete, independently reviewed authenticated design
using standard Web Crypto primitives, downgrade protection, transcript binding, and a persisted
nonce lifecycle. No custom encryption or informal short-code pairing is permitted.

Microphone capture stops on cancel, terminal error, device loss, or lifecycle teardown. Raw audio
is not stored by default. Diagnostic recording is explicit opt-in, visibly active, bounded, local-
only, and deletable. Logs exclude payload bytes, secrets, raw samples, and full filenames.

## Dependency, license, and provenance assessment

There is no top-level repository `LICENSE`, `NOTICE`, or `COPYING`. That absence prevents a blanket
compatibility claim for newly copied code. The test package is isolated under `tests/` and locks
Playwright 1.61.1 / Playwright Core 1.61.1 (Apache-2.0) plus optional `fsevents` 2.3.2 (MIT).

Optical Transfer demonstrates the required scoped standard: exact upstream snapshot, local artifact
hashes, component licenses, full Apache text where needed, and no hidden runtime download. Acoustic
v1 plans no modem runtime dependency and copies no third-party implementation. Standards and
permissively licensed projects may inform design, but any later code, WASM, lookup table, vector, or
recording must have:

- an exact source commit or publication;
- recorded derivation and SHA-256;
- transitive license and notice review against the repository's still-unresolved distribution
  position;
- reproducible build instructions when generated;
- independent correctness and maintenance assessment.

GPL modem code remains reference-only absent an explicit repository licensing decision. Legacy
prebuilt modem blobs and LGPL transitive code are not accepted by implication.

## Unresolved repository-grounded issues

The following remain mandatory feasibility questions, not implementation assumptions:

- Blob AudioWorklet loading under the exact generated meta CSP from `file://`, Pages HTTPS, and an
  installed offline PWA;
- real microphone permission and effective EC/NS/AGC settings in those contexts;
- direct Worklet-to-Worker `MessagePort` transfer versus a bounded main-thread relay;
- IndexedDB identity and reload stability for file origins, quota/eviction behavior, and crash-safe
  multi-store transactions;
- bounded Web Crypto + Blob peak memory on minimum mobile hardware;
- PWA install/update impact from the inlined acoustic source;
- speaker/room tail, reverse-link acquisition, and ACK p50/p95/p99 turnaround;
- acquisition, CFO/SRO/clock-drift, clipping, safe level, CPU, thermal, and two-device compatibility.

Until those gates pass, the correct repository claim is only that the existing static suite is
clean and its current build contract remains green—not that an acoustic modem works.
