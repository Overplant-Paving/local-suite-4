# Acoustic Modem Implementation Plan and Lane Contracts

Status: Stage B downstream contract aligned to the 2026-08-07 G1 disposition
Entry commit: the documentation commit containing `G1_DISPOSITION.md`
Current gate after that commit: G2 / Lane 1 production protocol, DSP, simulator, and Worker core

## 1. Execution rules

- Use isolated writable worktrees/branches for implementation lanes. One path has one writable
  owner. Reviewers report defects instead of editing another lane's files.
- The integration worktree has one serial writer. `core/`, `build.py`, manifest, workflow, root
  documents, Settings, and `dist/` are never edited concurrently.
- Run the branch/HEAD/status preflight before each lane starts and before each integration. Stop on
  unexpected changes or a second writer.
- Review each lane before integration. Integration does not convert an unresolved finding or an
  evidence-class limitation into an accepted claim.
- Never hand-edit generated output. Only the integration owner builds and commits `dist/`.
- No dependency, vendored code, recording, vector, or license is added without explicit provenance
  and compatibility review.
- A red gate is evidence, not an inconvenience. Do not weaken a requirement, substitute a network
  path, or relabel simulator output to pass.
- Performance numbers are archived with evidence class, exact commit, configuration, seed/hardware,
  raw/coded/wire/durable/verified definitions, and failure counts.

## 2. Gate sequence

### G0 — architecture contract (this stage)

Exit:

- repository assessment, architecture, protocol, DSP design, and this plan agree;
- branch and baseline are recorded;
- `git diff --check` and `python3 build.py --check` are green;
- the five documents are one clean documentation-only commit.

G0 does not prove browser or acoustic feasibility.

### G1 — existential feasibility disposition (PARTIAL)

The completed spikes remain disposable reference/evidence branches. They used dedicated branches and
tracked fixtures/evidence, but neither branch is product source and neither may be cherry-picked
wholesale. `G1_DISPOSITION.md` records the accepted facts, remaining blockers, adoption boundary,
and authorization for ordered production work.

| Spike | Required evidence and GO condition | STOP/fallback boundary |
|---|---|---|
| G1a generated packaging/launch | Minimal pass-through AudioWorklet + Worker embedded by the proposed generator; exact generated meta CSP; desktop `file://`, actual Pages project subpath, and installed-offline PWA; Android hosted/PWA; zero hidden network/CSP errors | If a required launch mode cannot load/process the self-contained worklet, stop for an explicit product-contract decision. Do not use ScriptProcessor or a runtime module fetch. |
| G1b capture controls/routes | Requested, supported, and effective EC/NS/AGC, channels, context/grid rates, permission errors, device loss, and route change on the target matrix | If processing cannot be disabled and C0/R1 fails, stop that platform/profile; never claim requested settings were granted. |
| G1c reverse C0/turnaround | At least 1,000 representative 1 m quiet turns; ACK delivery ≥99% within two repetitions; p50/p95/p99 output-end-to-decodable-ACK, ringing tail, retries; typical round trip target ≤1.5 s | Increase training/repetition/guard within bounds. If still unreliable, stop selective-repeat product work; no open-loop fallback. |
| G1d sample drift/real time | Seeded ±300 ppm; 10-minute physical run without slips/hash error; zero pool overflow; worklet p99 <20% observed quantum; Worker ≥2× real time; bounded main-thread/heap | Simplify/disable profiles or optimize bounded code. Worklet FFT/FEC and unbounded queues are forbidden fallbacks. |
| G1e IndexedDB/memory | Atomic commit/ACK crash matrix; reload/resume; quota/corruption/eviction/private-mode/file-origin tests; bounded 16 MiB Web Crypto + Blob peak on minimum mobile device | If ACKed data can disappear through application logic, stop resume. If file-origin resume is unstable, do not silently make resume hosted-only. If memory misses, reduce file limit or review incremental SHA plan. |
| G1f PWA/cache/accessibility | Generated-page install/update with inlined size, no stale Optical artifact, keyboard/Stop/textual calibration path, bounded announcements | Reduce embedded diagnostics or scope. No CDN/external-module fallback. |

`G1_DISPOSITION.md` records **G1 PARTIAL / software implementation may proceed**. The reviewed
desktop Chromium direct-file data-URL Worklet path and narrow link/DSP software reference authorize
G2 and the later ordered G3 lane. The direct-file Blob candidate remains STOP. Android, installed
device, physical audio, routing/loss, minimum-mobile memory, same-device acoustic, and two-device
over-air remain unverified and block only their corresponding claims and release gates.

Parameter lock remains prohibited until the open criteria have passed. A stopped platform or
profile is removed from the support claim rather than waived. The suite's direct-file requirement
cannot change inside an implementation lane.

### G2 — Lane 1 core vertical slice

This is the first authorized production lane from the clean commit containing
`G1_DISPOSITION.md`. Selectively reimplement or adapt reviewed ideas under the production contracts;
do not cherry-pick `spike/acoustic-g1-link`.

Implement frozen byte contracts, bounds, CRC32C, manifest, whitening, rate-1/2 FEC, interleaver,
selective-repeat reducer, SHA adapter, FFT, C0/R1 profiles, acquisition, resampler, seeded simulator,
and Worker entry. Fast/punctured/stretch profiles remain disabled.

Exit:

- exact independent protocol constants are consumable;
- Lane 1 unit and simulation tests pass;
- malformed dimensions cannot allocate;
- R1 deterministic vertical slice reconstructs exact bounded fixtures and exercises failure paths;
- API version/namespace and Worker schemas are frozen at `1`;
- no DOM/Web Audio/IndexedDB dependency exists in pure modules.

### G3 — Lane 2 browser/application vertical slice

Begin only after G2 has been reviewed and integrated, then rebase onto that exact API-freeze commit.
Implement source-mode page, controller, worklet/runtime, Worker client, IndexedDB store, bounded Web
Crypto preparation/finalization, UI, diagnostics, and test adapters. The generated direct-file path
must use the build-time data-URL AudioWorklet selected in `G1_DISPOSITION.md`, with no Blob module or
runtime module-network fallback. First deliver one C0/R1 live path; no encryption,
near-ultrasonic, 16-QAM, or WAV feature surface. Do not cherry-pick
`spike/acoustic-g1-browser`.

Exit:

- permission, effective settings, lifecycle, cancellation, pools/backpressure, durable-ACK,
  quota/corruption, resume, final-hash, and state wording tests pass in source mode;
- local teardown wins every late-promise race;
- accessibility is keyboard/text complete;
- no unbounded buffer, raw-audio default, or false “saved/authenticated/safe” wording exists.

Adding `tools/audio.html` before shared integration will intentionally make the repository-wide
manifest-sync gate red. Lane 2 must record that exact expected transition; it may not edit shared
files to hide it. The integration owner first reviews Lane 2 together with integrated Lane 1. Only
after that combined review may the serial owner add the shared bundle/generator/manifest/CSP/Settings
and generated-page changes needed to restore the full green gate before G4 begins. Browser release
integration is not authorized before that review.

### G4 — Lane 3 independent validation, security, and documentation

Branch only after Lane 1 and Lane 2 are integrated and the serial owner has generated a testable
self-contained page. Produce independent vectors/reference outputs, adversarial parser/session/
storage tests, generated-page CSP/no-network/worker/worklet tests, lifecycle/accessibility checks,
evidence tooling, security review, provenance, and user-facing acoustic documentation.

Lane 3 does not repair Lane 1 or Lane 2 source. A defect returns to its owner; that owner rebases,
fixes only owned files, and supplies a new commit. Lane 3 then rebases and reruns.

### G5 — serial Local Suite integration

The integration owner updates shared files, performs the deterministic embedding, builds once,
commits generated output, and runs the complete suite.

Exit:

- acoustic focused tests and independent vectors pass;
- Optical focused test remains green and its protocol/vendor artifacts are unchanged except normal
  PWA cache-list regeneration;
- full static, smoke, PWA, settings, location, current focused, and security gates pass;
- direct-file and hosted generated pages have no unexpected network or CSP activity;
- repository counts, docs, provenance, settings-backup wording, and workflow are current;
- working tree and self-diff review are clean.

G5 proves software integration, not over-air compatibility.

### G6 — two-device physical acceptance

From the exact G5 candidate commit, run the documented physical matrix. Record sender/receiver
device, OS/browser, audio hardware/routes, actual context/grid rates, requested/effective processing,
distance/orientation/room/noise, digital level/system-volume instructions, file seed/size/hash,
turnaround, retry/loss, clipping, CFO/SRO, CPU/thermal, and completion state.

Run at least ten 64 KiB transfers per declared condition for a distribution, then a 1 MiB hash-gated
transfer. Cover 0.5 m, 1 m, and 3 m in quiet and representative noise on the declared minimum device
matrix. Report p10/p50/p90 verified goodput and all failures. Parameter tuning uses separate
development channels/devices from held-out acceptance.

Only G6 can establish two-device over-air claims.

### G7 — security/license/release decision

Review final threat wording, parser/resource findings, dependency/provenance record, top-level
license implications, support matrix, physical evidence, and all release gates. Encryption remains
absent unless a separate complete Web Crypto authenticated protocol has been specified, implemented,
and independently reviewed. A release decision is explicit; passing simulation or G5 is not enough.

## 3. Exclusive file ownership

### Lane 1 — protocol, DSP, simulator, Worker core

Only Lane 1 may write:

```text
assets/acoustic/protocol/constants.js
assets/acoustic/protocol/bytes.js
assets/acoustic/protocol/crc32c.js
assets/acoustic/protocol/sha256.js
assets/acoustic/protocol/whitening.js
assets/acoustic/protocol/fec.js
assets/acoustic/protocol/interleave.js
assets/acoustic/protocol/wire.js
assets/acoustic/protocol/manifest.js
assets/acoustic/protocol/arq.js
assets/acoustic/protocol/session.js
assets/acoustic/dsp/fft.js
assets/acoustic/dsp/profiles.js
assets/acoustic/dsp/preamble.js
assets/acoustic/dsp/resampler.js
assets/acoustic/dsp/transmitter.js
assets/acoustic/dsp/receiver.js
assets/acoustic/sim/prng.js
assets/acoustic/sim/channel.js
assets/acoustic/sim/benchmark.js
assets/acoustic/worker-entry.js
tests/acoustic-core.mjs
tests/acoustic-simulator.mjs
tests/fixtures/acoustic/core/**
tests/evidence/acoustic/g2-core/**
```

Lane 1 must not edit application, worklet, browser persistence, build, manifest, workflow, root docs,
independent vectors, generated files, or Optical files.

### Lane 2 — browser runtime, application, UI, persistence

Only Lane 2 may write:

```text
tools/audio.html
assets/acoustic/app/audio-runtime.js
assets/acoustic/app/worker-client.js
assets/acoustic/app/session-store.js
assets/acoustic/app/transfer-controller.js
assets/acoustic/app/diagnostics.js
assets/acoustic/app/ui.js
assets/acoustic/app/page-entry.js
assets/acoustic/worklet/audio-io.js
tests/acoustic-runtime-unit.mjs
tests/acoustic-store-unit.mjs
tests/fixtures/acoustic/runtime/**
tests/evidence/acoustic/g3-runtime/**
```

Lane 2 must not edit Lane 1 files, `bundles.json`, build, manifest, Settings, workflow, shared docs,
generated files, or Optical files.

### Lane 3 — independent integration tests, security, provenance, acoustic docs

Only Lane 3 may write:

```text
tests/acoustic-independent.mjs
tests/acoustic-built.mjs
tests/acoustic-security.mjs
tests/acoustic-lifecycle.mjs
tests/acoustic-physical-run.mjs
tests/fixtures/acoustic/independent/**
tests/fixtures/acoustic/held-out/**
assets/acoustic/PROVENANCE.md
ACOUSTIC-MODEM.md
docs/acoustic/THREAT_MODEL.md
docs/acoustic/EVIDENCE_METHOD.md
docs/acoustic/COMPATIBILITY_MATRIX.md
docs/acoustic/PHYSICAL_TEST_PLAN.md
docs/acoustic/SECURITY_REVIEW.md
docs/acoustic/ACCESSIBILITY_REVIEW.md
tests/evidence/acoustic/g4-validation/**
```

Lane 3 may inspect all code and file defects, but may not repair Lane 1/Lane 2/shared files.
Independent fixtures must not be generated by importing product encoder/decoder functions.

### Serial integration owner — shared/high-conflict/generated files

Only the integration owner may write:

```text
assets/acoustic/bundles.json
build.py
manifest/tools.json
tools/settings.html
tests/smoke.mjs                         # only if the generic smoke contract needs a change
tests/package.json
tests/package-lock.json                 # only if an approved test dependency is unavoidable
.github/workflows/pages.yml
CLAUDE.md
README.md
ROADMAP.md
ARCHITECTURE.md
QUALITY.md
PWA.md
CATALOG.md
dist/**
docs/acoustic/REPOSITORY_ASSESSMENT.md
docs/acoustic/ARCHITECTURE.md
docs/acoustic/PROTOCOL.md
docs/acoustic/DSP_DESIGN.md
docs/acoustic/IMPLEMENTATION_PLAN.md
docs/acoustic/G1_DISPOSITION.md
tests/evidence/acoustic/g1-feasibility/**
tests/evidence/acoustic/g5-integration/**
tests/evidence/acoustic/g6-physical/**
tests/evidence/<release>-release/**
```

The integration owner does not rewrite lane-owned source or tests. A required fix goes back to its
owner. Reviewed post-G0 contract deltas to the five Stage A documents are serialized by the
integration owner; the handoff and recovery-audit records remain immutable. Release tags are also
created only by the integration owner after G7. No file appears in more than one writable list.

## 4. Import, global, and bundle contract

Lane 1 classic scripts attach frozen members to `globalThis.AcousticV1`; Lane 2 page scripts attach
to `window.AcousticV1App`. Member names are unique and a duplicate definition throws during startup.
There is no CommonJS, ESM import, runtime package resolution, or directory auto-discovery.

The initial frozen Lane 1 namespaces are:

```text
AcousticV1.Constants
AcousticV1.Bytes
AcousticV1.Crc32c
AcousticV1.Sha256
AcousticV1.Whitening
AcousticV1.Fec
AcousticV1.Interleave
AcousticV1.Wire
AcousticV1.Manifest
AcousticV1.Arq
AcousticV1.Session
AcousticV1.Fft
AcousticV1.Profiles
AcousticV1.Preamble
AcousticV1.Resampler
AcousticV1.PhyTx
AcousticV1.PhyRx
AcousticV1.Prng
AcousticV1.Channel
AcousticV1.Benchmark
```

The initial Lane 2 namespaces are:

```text
AcousticV1App.AudioRuntime
AcousticV1App.WorkerClient
AcousticV1App.SessionStore
AcousticV1App.TransferController
AcousticV1App.Diagnostics
AcousticV1App.Ui
AcousticV1App.Page
```

`api:1` Worker envelopes and public function results follow `ARCHITECTURE.md`. Any API-shape change
after Lane 1 integration requires an explicit contract-delta note, Lane 2/Lane 3 rebase, and all
tests rerun. Stringly typed ad hoc messages are rejected.

`assets/acoustic/bundles.json` is created only after lane source lists stabilize and the combined
Lane 1/Lane 2 review accepts the production source. The integration owner copies the exact ordered
arrays from the architecture contract, validates source HTML and Worker import order, and uses the
deterministic transform specified in `ARCHITECTURE.md`. The generated transform embeds the validated
Worklet bytes as a build-time base64 data URL; it provides no Blob-Worklet or runtime module-network
fallback.

## 5. Test seams

### Pure core

Node tests load explicit Lane 1 files in bundle order into an isolated `vm` global and read only
`AcousticV1`. Tests inject clock, random bytes, limits, sample rate, and channel configuration.
There is no `window` shim hidden in production modules.

### Worker

The Worker accepts only the versioned envelopes and transferred typed arrays. A deterministic test
adapter captures returned buffer identities, queue depth, backpressure, discontinuities, and teardown.
Unknown API/kind, malformed transfer, stale request ID, and late response are negative tests.

### Application/runtime

Before `Page.start()`, tests may install one frozen adapter record containing `clock`, `randomBytes`,
`mediaDevices`, `audioContextFactory`, `workerFactory`, `indexedDBFactory`, and `storageManager`.
Production defaults are captured once at startup; later global mutation has no effect. The seam is
not a security boundary and cannot bypass parser, commit, or hash gates.

`window.AcousticModemTest` exposes immutable constants, reducer snapshots, adapter installation
before start, bounded metric snapshots, and teardown counters. It does not expose selected file or
received payload contents except explicit deterministic fixtures.

### Independent validation

Lane 3 implements a separate reference encoder/vector generator (Python standard library or a small
reviewed script) without importing product modules. Vector provenance includes source hash, command,
byte order, expected bytes/hash, and algorithm references. Product round-trip tests are retained but
not counted as independent vectors.

Browser mocks prove state/UI/cleanup only. A real generated AudioWorklet under CSP, prerecorded held-
out channels, and two-device hardware runs are separate required evidence.

## 6. Integration and rebase order

1. **Contract base:** create Lane 1 from the clean commit containing `G1_DISPOSITION.md`. Record the
   branch, worktree, base, and expected owned paths.
2. **Lane 1:** implement and review G2. Only after review does the integration owner merge it, run
   Lane 1 tests plus the unchanged repository static gate, and record the API-freeze commit.
3. **Lane 2 update point:** create/rebase Lane 2 onto that exact reviewed API-freeze commit. Resolve
   only Lane 2 files and deliver one reviewed G3 commit series.
4. **Combined review and integration:** review Lane 2 against integrated Lane 1 before merging it.
   After acceptance, the integration owner alone adds `bundles.json`, generator/manifest/CSP/Settings
   integration, and regenerated artifacts needed for a green generated page. Run focused source,
   runtime, packaging, CSP, no-network, and generated-page boot tests.
5. **Lane 3 update point:** create/rebase Lane 3 only after the production Lane 1/Lane 2 integration
   above. Author G4 independent validation/docs; return defects to the owning lane.
6. **Defect update point:** owner rebases onto current integration, fixes only owned paths, and
   supplies a narrow commit. Integration owner merges; Lane 3 rebases and reruns affected plus full
   tests.
7. **Final integration:** merge Lane 3, update workflow/root/release documentation, regenerate once
   if source inputs changed, and run G5 in full.
8. **Physical freeze:** tag or record the exact G5 candidate commit; run G6 without retuning the
   candidate. Any tuning change creates a new candidate and invalidates prior acceptance aggregation.

No lane merges generated output. No lane rebases by overwriting another owner's resolution.

## 7. Commands and evidence contract by owner

Every lane report contains outcome/gate; branch/worktree/base/final commit; changed paths; commands
and pass/fail counts; measurements with evidence labels; unresolved issues; dependency/license
changes; self-diff review; final status; and out-of-scope confirmation.

### Common preflight/final checks

```text
pwd
git branch --show-current
git rev-parse HEAD
git status --short --branch --untracked-files=all
git diff --check
git diff --name-status <base>...HEAD
```

### Lane 1 minimum commands

```text
rg --files assets/acoustic/protocol assets/acoustic/dsp assets/acoustic/sim assets/acoustic/worker-entry.js -g '*.js' | xargs -r -n1 node --check
node tests/acoustic-core.mjs
node tests/acoustic-simulator.mjs
python3 build.py --check
```

Evidence: `tests/evidence/acoustic/g2-core/` with command transcript, vector provenance/fingerprints,
seed/config/output hashes, raw/coded/wire/verified metric table, memory/queue ceilings, and explicit
“deterministic simulation only” labels. Existing `dist` must remain untouched.

### Lane 2 minimum commands

```text
rg --files assets/acoustic/app assets/acoustic/worklet -g '*.js' | xargs -r -n1 node --check
node tests/acoustic-runtime-unit.mjs
node tests/acoustic-store-unit.mjs
python3 build.py --check
```

Before shared integration, the final command is expected to report only the deliberate unmanifested
`tools/audio.html` `manifest-files-sync` failure; every other new failure is a blocker. Evidence:
`tests/evidence/acoustic/g3-runtime/` with permission/settings matrices, lifecycle/late-promise
traces, pool identities/depth, IndexedDB crash/duplicate/quota cases, memory high-water, and exact
state wording. No mock result is labeled real audio.

### Lane 3 minimum commands

```text
node tests/acoustic-independent.mjs
node tests/acoustic-built.mjs
node tests/acoustic-security.mjs
node tests/acoustic-lifecycle.mjs
python3 build.py --check
node tests/optical-built.mjs
```

Evidence: `tests/evidence/acoustic/g4-validation/` with independent generator source/hash, malformed
corpus summary, CSP/no-network logs, generated Worker/Worklet execution, accessibility report, held-
out fixture provenance, and threat/license review. Physical runner output is not fabricated or
required without attached hardware.

### Integration owner minimum commands

```text
python3 build.py
python3 build.py --check
node tests/acoustic-core.mjs
node tests/acoustic-simulator.mjs
node tests/acoustic-runtime-unit.mjs
node tests/acoustic-store-unit.mjs
node tests/acoustic-independent.mjs
node tests/acoustic-built.mjs
node tests/acoustic-security.mjs
node tests/acoustic-lifecycle.mjs
node tests/optical-built.mjs
node tests/multiple-locations.mjs
node tests/location-cross-tab.mjs
node tests/favorites-recents.mjs
node tests/flight-built.mjs
node tests/parks-built.mjs
node tests/arcade-built.mjs
node tests/flood-built.mjs
node tests/smoke.mjs
node tests/pwa-verify.mjs coexist
git diff --check
```

Also verify direct `file://`, served subpath, installed-offline PWA, no HTTP(S) acoustic request,
generated self-containment, manifest/card navigation, exact precache membership, scoped CSP, Settings
backup disclosure, Optical artifact behavior, and clean final status. Archive under
`tests/evidence/acoustic/g5-integration/` and the eventual release evidence directory.

G6 adds `node tests/acoustic-physical-run.mjs` around manual hardware setup and archives raw run
records under `tests/evidence/acoustic/g6-physical/`. It never replaces manual recording of the
physical configuration.

## 8. Twelve-criterion acceptance matrix

| # | Minimum acceptance criterion | Planned source/contract | Required tests | Evidence |
|---:|---|---|---|---|
| 1 | Genuine no-network speaker-to-microphone transfer of arbitrary bytes within 1–16 MiB | `tools/audio.html`, controller/runtime, `PROTOCOL.md` manifest/DATA | built no-network gate; 1 MiB final-hash path | G5 logs + G6 two-device runs |
| 2 | Self-contained generated page with correct `file://`, HTTPS, PWA, CSP, and subpath behavior | `bundles.json`, `build.py`, manifest, `ARCHITECTURE.md` §6 | `acoustic-built`, smoke, PWA, CSP negative fixture | G1a and G5 launch/network logs |
| 3 | Deterministic bounded wire/parser/version contract | protocol modules, `PROTOCOL.md` §§2–5/11–12 | core + independent byte/malformed vectors | G2/G4 vector provenance and corpus summary |
| 4 | Capability handshake, repeated manifest, half-duplex selective-repeat, compact durable ACK/NACK, bounded retry/fallback | ARQ/session modules, `PROTOCOL.md` §§4/6–8 | state traces for loss, duplicate, stale, retry, downgrade | G2 deterministic traces + G1c/G6 turnaround distributions |
| 5 | Actual-rate audio operation, effective processing disclosure, deterministic lifecycle/teardown | profiles/resampler, audio runtime/worklet | 44.1/48 vectors; permission/device/suspend/route races | G1b/G1d matrix + G3/G4 lifecycle logs |
| 6 | Robust audible C0 and R1; gated QPSK A2; complete acquisition/equalization/CFO/SRO/soft FEC chain | DSP/FEC files, `DSP_DESIGN.md` | DSP known answers, held-out simulator/prerecorded, worklet budget | G2/G4 labeled results; G6 only for physical claims |
| 7 | Crash-safe best-effort resume and idempotence; ACK means durable commit | session store + ARQ, DB schema in `ARCHITECTURE.md` | crash at every transaction boundary, quota/corrupt/duplicate/resume | G1e/G3 transaction traces |
| 8 | Exact final SHA-256 gate and honest received/verified/download/save states | bounded SHA adapter, controller/UI | 0/1/max files, corrupt final, cancel during hash, allocation failure | G3/G4 state screenshots/logs and hashes |
| 9 | Enforced file/session/memory/parser/retry/log/audio bounds | constants, parser, pools, store, diagnostics | boundary ±1, hostile dimensions, queue/heap/cleanup | G2/G3 security and high-water reports |
| 10 | Explicit plaintext threat/privacy model and accessible safe controls | UI plus threat/accessibility docs | injection/replay semantics, metadata sanitation, keyboard/live-region/Stop | G4 security/accessibility review |
| 11 | Honest performance accounting and evidence separation; no over-air claim without hardware | simulator/benchmark, `DSP_DESIGN.md` §§8–10 | metrics formula checks, failure=zero goodput, label validation | G2 sim, G4 held-out, G6 physical separately |
| 12 | Local Suite regression, scoped license/provenance, Settings disclosure, and clean release workflow | shared integration files + provenance/docs | static/full focused/Optical/smoke/PWA suite | G5 transcripts, dependency/license diff, clean candidate |

No criterion can be accepted solely by a same-implementation round trip or a UI screenshot.

## 9. Later documentation required

Before G5/G7, author and review:

- `ACOUSTIC-MODEM.md`: user operation, public-channel warning, limits, browser modes, resume limits,
  state meanings, accessibility, and troubleshooting;
- `docs/acoustic/THREAT_MODEL.md`: assets/adversaries, malformed input, injection/replay/jamming,
  unauthenticated ACK/manifest implications, privacy, non-goals, future encryption requirements;
- `docs/acoustic/EVIDENCE_METHOD.md`: exact evidence labels, metric formulas, seeds/fixtures, held-out
  policy, run schema, failure reporting;
- `docs/acoustic/COMPATIBILITY_MATRIX.md`: measured browser/device/launch/route status with dates and
  exact commits; unknown remains unknown;
- `docs/acoustic/PHYSICAL_TEST_PLAN.md`: rooms, devices, distances, levels, repetitions, hash files,
  turnaround and environmental recording;
- `docs/acoustic/SECURITY_REVIEW.md` and `ACCESSIBILITY_REVIEW.md`: completed findings/dispositions;
- `assets/acoustic/PROVENANCE.md`: owned implementation statement, references, independent vector/
  recording origins and hashes, all dependency/license notices;
- updates to `README.md`, `ROADMAP.md`, root `ARCHITECTURE.md`, `QUALITY.md`, `PWA.md`, `CATALOG.md`,
  `CLAUDE.md`, Settings copy, and workflow/release checklist;
- release notes and final evidence index only at the release gate.

The Stage A handoff and recovery-audit documents remain historical records and are not rewritten to
claim later feasibility or implementation.

## 10. Current unresolved decisions after G1

- The production generated direct-file path must reverify the selected data-URL AudioWorklet at
  44.1/48 kHz with no runtime module/network fallback; the Blob candidate remains STOP.
- Android hosted/installed behavior and physical microphone/speaker operation remain unverified;
  desktop Chromium/API evidence cannot substitute for those platforms or evidence classes.
- Whether keeping both speaker/microphone routes open or switching them produces acceptable reverse
  ACK tail/latency and EC behavior.
- Whether direct Worklet-to-Worker port transfer is reliable; bounded main-thread relay is the only
  candidate fallback.
- Which requested EC/NS/AGC controls are effective on minimum devices.
- Whether the initial CP/preamble/pilot/profile parameters survive held-out and physical channels.
- Whether bounded whole-buffer Web Crypto + Blob fits minimum mobile memory; standard Web Crypto has
  no incremental digest API.
- Whether file-origin IndexedDB persists consistently; Settings backup does not include it.
- Which browsers/devices/routes, if any, meet the physical and thermal gates.
- Whether the repository owner will adopt a top-level license; until then every reused artifact needs
  scoped provenance/compatibility review.
- Encryption/authentication design. v1 has none; no custom cryptography or informal pairing is
  authorized.

These are mandatory gates, not deferred release-note caveats.
