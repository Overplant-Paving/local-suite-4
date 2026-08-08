# Acoustic G1 Disposition and Stage-B Authorization

Status: accepted disposition, 2026-08-07
Disposition base: `15191f6cb1aa1171b55c03a8f13749d895c1f3f6`
Overall gate: **G1 PARTIAL; software implementation may proceed**

## Gate R0 addendum

The later Lane 1 candidate at `0b2ff7ded57ea99210f06442759fda6c0a004e8c` failed independent
protocol and DSP review and is quarantined. It is not one of the accepted G1 spike revisions above
and does not amend their narrow evidence labels. Do not merge, cherry-pick, or adopt that candidate,
its `core/` or `worker/` layout, APIs, tests, fixtures, or evidence.

Replacement Lane 1 is controlled by `LANE1_REPLACEMENT_CONTRACT.md` and the Gate R0 edits to
`ARCHITECTURE.md`, `PROTOCOL.md`, `DSP_DESIGN.md`, and `IMPLEMENTATION_PLAN.md`. Wire and
manifest version 1.1, persistence schema 2, and R0–R8 now supersede conflicting draft 1.0/G2
language. Lane 2 remains blocked until two independent R8 rereviews accept the exact replacement
commit and the integration owner records the clean API freeze.

## 1. Decision and authority

G1 is not a full pass. The reviewed browser/platform evidence establishes a usable desktop
Chromium direct-file packaging mechanism, and the repaired link/DSP spike establishes a narrow
software reference. Together they authorize the ordered Stage-B production implementation below.
They do not establish physical transfer, Android or installed-device support, product readiness,
parameter lock, release readiness, or a performance claim.

This document records the controlling post-G1 disposition. Where the Stage A architecture or plan
described browser packaging or G1 status as wholly provisional, this disposition and the aligned
edits to `ARCHITECTURE.md` and `IMPLEMENTATION_PLAN.md` control. The frozen logical protocol,
bounds, evidence classes, ownership rules, and physical/release gates remain in force. Historical
handoff, recovery, and spike reports remain historical records and are not rewritten.

The adoption rule is strict:

- do not cherry-pick or merge either spike wholesale;
- do not copy spike release files into production;
- Stage B may selectively reimplement or adapt reviewed algorithms and platform patterns under the
  production contracts and independently reviewed tests;
- spike-local behavior is not a product contract unless it is separately adopted in the tracked
  architecture and verified in production code.

## 2. Exact reviewed revisions and artifacts

### Repository revisions

| Scope | Branch / role | Commit | Tree | Disposition |
|---|---|---|---|---|
| Stage A and G1 integration base | `feat/acoustic-modem-codex` | `15191f6cb1aa1171b55c03a8f13749d895c1f3f6` | `3db67af02ce89e1863fde68884f8f82ee4e6811a` | Clean documentation base for this disposition |
| Browser initial spike | `spike/acoustic-g1-browser` | `1d1c30c5a2683d85f85a0009144dd2e7c44f69b3` | `06bd51967fd583af2eeef29a0cd713f1a0f0fb68` | Initial STOP/review input; superseded by remediation for accepted facts |
| Browser first remediation | `spike/acoustic-g1-browser` | `496cf3acdb1460880335f90c3060ae1353c10e83` | `790c091a7d9af9cce29e239be1b0d4c85ee7a557` | Rereview input; remaining findings repaired later |
| Browser reviewed code freeze | `spike/acoustic-g1-browser` | `52a44da63cd11c3810624d6891a38e47ba4dd48d` | `148b36e6bfb88cd29bb504345194c797a46496d1` | Accepted quarantined browser/API evidence and reviewed patterns |
| Browser evidence-only child / branch head | `spike/acoustic-g1-browser` | `9008e9a136dcdde4a3254ceb1052b66d456481dc` | `422449faf0a40549b5b3d4e9ea9fba77c86a00d2` | Binds evidence generated from the clean code freeze |
| Link initial spike | `spike/acoustic-g1-link` | `a5032f179678ba871aaefa1cf4f2cc82e737f95c` | `9e0e01d328e734ecc6036b2dbbefb6307985e696` | Repaired/superseded as an adoption input |
| Link remediation / branch head | `spike/acoustic-g1-link` | `67d435651389bb7354f99047455edd25485bc007` | `dd614d5d31c886b9dc825c5940121fef251f1e1c` | Narrow reference GO, subject to the findings below |

The browser evidence child records code commit `52a44da63cd11c3810624d6891a38e47ba4dd48d`
and tree `148b36e6bfb88cd29bb504345194c797a46496d1`; it does not claim to self-record its
future evidence-only commit hash.

### Tracked report and summary identities

These SHA-256 values are over the exact files at the branch heads above:

| Artifact | SHA-256 |
|---|---|
| Browser `docs/acoustic/G1_BROWSER_RESULTS.md` | `7214f2f7ebaf6201d5e3ad896e78e360ffdfcc568965bdc723699608f0079737` |
| Browser `tests/evidence/acoustic/g1-browser/results.json` | `87a5cfa3346827b210cdd40fd5bddd14b155a7d2202bac36427d35ff6f0ee8a5` |
| Browser `tests/evidence/acoustic/g1-browser/summary.txt` | `b6717ba441efca19fdd624cac2afa3a1d83e09a0f37ccf14bdff38ebb1d43f06` |
| Link `docs/acoustic/G1_LINK_RESULTS.md` | `5725d8a74631716be38e1710867cee78f70cfa1a54c93aab7de6c5586dc798db` |
| Link `docs/acoustic/G1_LINK_PROVENANCE.md` | `b35c81c6c96efa8d43a63d279e4c28093d015abda4d45501ba01bf8d49e48daf` |
| Link `tests/evidence/acoustic/g1-link/test-summary.txt` | `37a5e22eab4e9b6b4c29f5569c35b3f62c89596b7364859549b11663fdb3aed2` |
| Link `tests/evidence/acoustic/g1-link/source-inputs.json` | `617955c4358da7aea3ac830134f52082e2ec5ac1d7bfd4689f5ae602d5932010` |

### External deterministic acceptance

The external artifacts remain outside the tracked product tree:

| Artifact | SHA-256 | Recorded result |
|---|---|---|
| `/tmp/acoustic-codex/g1-external-acceptance-v1.json` | `7d69fb65e156820fbc6700a21b104b1d6e642a628da1d140b61789a367f28d4d` | 4,078-byte post-freeze input; four C0/R1 cases across 44.1/48 kHz; 16 trials |
| First `/tmp/acoustic-codex/g1-external-acceptance-v1-output.json` | `4f4a5ac42992ab0bf74768044fdde3e168ffbf16967f5d192fba75bd98066195` | 41,424 bytes; 16/16 passed; 16/16 exact fixture SHA-256; zero errors |

The expected per-trial fixture SHA-256 is
`82ba9ac2243a143db032ce315bf7671e36739966e0b7c3b99cb8986688ed7fe8`.
The final link rereview independently reran the frozen runner, reproduced the output byte for byte,
and matched all per-seed PCM digests. This is external-input deterministic simulation acceptance,
not an independently implemented impaired transmitter/channel/receiver.

## 3. Browser/platform disposition

Browser/platform status is **PARTIAL / software implementation may proceed**.

The reviewed code freeze demonstrates that a build-time
`data:text/javascript;base64,...` AudioWorklet module works from the generated direct-file desktop
Chromium page at requested and actual 44,100 and 48,000 Hz. The exercised path included the embedded
dedicated Worker, an eight-slot bounded 4,096-sample mono pool, generation/token ownership checks,
independent Worker and Worklet STOP acknowledgements, closed `AudioContext` state, and zero active
acoustic network requests. Browser-created structured-clone/event wrappers are outside the authored
allocation claim.

The Blob AudioWorklet candidate remains an exact **STOP candidate under `file://`** at both rates,
with `AbortError: Unable to load a worklet's module.` It is not a direct-file product fallback.

The exercised hosted-subpath and service-worker-controlled offline desktop paths passed both Blob
and data candidates at both requested/actual rates. Those results establish only the recorded
desktop Chromium/API paths. They do not establish an OS-installed standalone application or any
mobile/device/audio-hardware path.

Production requirements are therefore exact:

- generated direct-file implementation must select the reviewed build-time data-URL AudioWorklet
  mechanism;
- the same generated Worklet bytes must be source-allowlisted and embedded deterministically;
- there is no runtime fetch, module-network, Blob-module, `ScriptProcessorNode`, service, or relay
  fallback for AudioWorklet loading;
- the dedicated Worker may retain a tool-scoped Blob URL under `worker-src blob:`; the Worklet needs
  a tool-scoped `script-src data:` allowance, not the spike's dual-candidate Blob allowance;
- Lane 2 must independently test bounded ownership, lifecycle acknowledgements, teardown races,
  CSP, and zero active acoustic network from production code;
- browser release integration remains deferred until production Lane 1 and Lane 2 have been
  integrated and jointly reviewed.

Android, OS-installed-device behavior, physical microphone/speaker capture and playback, device
loss and routing changes, minimum-mobile memory, same-device acoustic loopback, and two-device
over-air remain blocked/unverified. These block corresponding compatibility, reliability,
performance, and release claims; they do not block software implementation.

All browser-spike release-path files remain quarantined. In particular, do not adopt its manifest
entry, release-count change, generated `dist` files, hub exposure, service-worker precache/cache key,
or origin-wide `suite-v4-*` cleanup behavior by wholesale cherry-pick.

## 4. Link/DSP disposition

Link/DSP status is **narrow reference GO; production repair/reimplementation required**.

Valid software evidence at `67d435651389bb7354f99047455edd25485bc007` includes:

- the post-remediation suite at 75/75 with deterministic fingerprint
  `676f8952208a67c490494a940fd54f134397d62c52327a2c092abeb67c60fb88`;
- bounds-before-allocation repairs for the exercised FFT, waveform, channel, registry schema, and
  receiver dimensions, including the four-second rate/profile ceiling;
- selected-profile receiver mechanisms for bounded candidate search, energy/repetition/training
  gates, coarse/fine CFO derotation, regularized equalization, clipped noise-scaled soft values, and
  finite-burst fractional timing correction;
- a separately implemented clean transmitter fixture decoded to payload SHA-256
  `1d64add2a6388367c9bc2d1f1b384b069a6ef382cdaaa89771dd103e28613a25`;
- clean and impaired-development 1 MiB paths with 1,366 bounded frames and exact final SHA-256
  `5feb25874f1ff36af20b0b51333384c74a3f5be639aef388ef51cb066fff5afb`;
- the fresh external-input deterministic acceptance above, 16/16 across four C0/R1 44.1/48 kHz
  conditions, reproduced byte-identically.

The clean 1 MiB path is a direct identity loopback and does not invoke the channel simulator. The
impaired-development path invokes `runChannel` on every transmission. Keeping those evidence classes
distinct is required.

This evidence is not an independent impaired implementation, the product wire protocol, a streaming
receiver, ARQ, persistence/resume, FINAL_ACK completion, completed-file goodput, browser/Worker/
AudioWorklet performance, physical audio, or release evidence.

### Remaining final-review findings

| Severity | Finding | Production disposition |
|---|---|---|
| Medium | External runner does not compute aggregate acceptance or fail its process on failed trials | Production evidence tooling must aggregate every required trial, emit an unambiguous result, and return nonzero on failure. Do not trust the spike's `acceptanceClaim` field or exit code alone. |
| Medium | Registry `stat` then path reopen can allocate after a replacement/growth race | Use one opened descriptor and a bounded read loop before parsing or allocating. |
| Medium | Simulator and receiver share fractional interpolation/Hilbert components | Treat impaired acceptance as external-input, same-implementation simulation. Add independent impaired/prerecorded/receiver evidence in Lane 3. |
| Medium | Impaired 1 MiB pre-run-freeze provenance is self-asserted | Preserve the observed pass but make no verified pre-run-freeze claim. Future baselines require a separately timestamped/hashed freeze before execution. |
| Medium | Clean 1 MiB bypasses the channel | Preserve its identity-loopback label. Add a distinct identity-channel case only if the production acceptance contract requires simulator traversal. |
| Low | Tuned-regression harness reads a stale ambiguity field, yielding null values | Repair production metric names and assert required fields are present and finite. Do not adopt the stale evidence schema. |
| Low | Link provenance names nonexistent `docs/acoustic/HANDOFF.md` | Use the tracked `docs/acoustic/HANDOFF_CURRENT_STATE.md`; do not copy the broken reference. |

Stage B may reimplement or adapt the reviewed primitives and receiver ideas, but the spike-local
`G1LK` framing and segmentation, synthetic turnaround, scalar clock-observation tracker, provisional
thresholds/profile parameters, tuned regression values, and Node wall/RSS extrapolation are not
product contracts. They must be replaced or justified under the production protocol, DSP design,
streaming model, independent tests, and physical gates.

## 5. Finding disposition table

| Area | Finding or fact | Disposition | Claim boundary |
|---|---|---|---|
| Direct-file Worklet | Data URL succeeds at requested/actual 44.1 and 48 kHz in exercised desktop Chromium | **Adopt pattern / GO for production implementation** | Desktop browser/API evidence only |
| Direct-file Worklet | Blob URL fails at both rates | **Candidate STOP** | No Blob fallback under `file://` |
| Hosted/offline desktop | Both candidates and rates completed bounded processing and teardown | **Accept recorded subset** | Not Android or OS-installed-device evidence |
| Worker/Worklet ownership and lifecycle | Final rereview closed authored hot-allocation, cancellation, teardown, token-wrap, and evidence-binding findings | **Adapt with independent production tests** | Not a production runtime approval |
| Browser release files | Catalog, build, manifest, generated output, PWA/cache changes expose the spike | **Quarantine** | No wholesale cherry-pick or release integration |
| Link primitives/receiver | Repaired bounds, mechanisms, vectors, 75/75, deterministic fingerprint | **Narrow reference GO** | Production reimplementation/repair required |
| Link 1 MiB | Clean and impaired-development exact SHA pass | **Accept with separate labels** | No ARQ, persistence, FINAL_ACK, completed-file goodput, or physical claim |
| External acceptance | Fresh post-freeze input, 16/16 exact hashes, byte-identical rerun | **Accept as external-input deterministic simulation** | Not independent impaired implementation or physical acceptance |
| Spike-specific protocol/models | `G1LK`, segmentation, turnaround/tracker, thresholds, Node performance | **Replace / do not contract** | Cannot define product wire or performance |
| Hardware/mobile | No qualifying Android, microphone/speaker, routing/loss, same-device, or two-device run | **Blocked/unverified** | Blocks only corresponding claims and release gates |

## 6. Claims matrix

| Claim | Disposition | Evidence sufficient now | Still required |
|---|---|---|---|
| Begin production software implementation | **Authorized** | Browser data-URL feasibility plus narrow link reference GO | Follow the lane order and review gates below |
| Generated desktop Chromium direct-file Worklet can load without network | **Supported for the exercised path** | Data candidate at requested/actual 44.1/48 kHz; zero active acoustic requests | Production implementation and built-page rerun |
| Blob Worklet is viable under direct-file Chromium | **Rejected candidate** | Exact AbortError at both rates | No retry required unless a future explicit research gate reopens it |
| Hosted and controlled-offline desktop Worklets are feasible | **Supported for exercised paths** | Both candidates/rates passed | Production built-page, exact hosted subpath, install/update review |
| Browser/platform G1 fully passed | **No** | Overall evidence is `G1_PARTIAL_BLOCKED` | Android, installed-device, hardware, lifecycle routes, memory, and physical gates |
| Link/DSP algorithms are useful production inputs | **Narrow reference GO** | 75/75, deterministic fingerprint, bounds, receiver mechanisms, independent clean transmitter | Production wire/DSP implementation and independent tests |
| Impaired simulator acceptance is independently implemented | **No** | External inputs are independent; simulator/receiver components are shared | Independent impaired/prerecorded/receiver evidence |
| One MiB software reconstruction was exact | **Yes, narrowly** | Clean and impaired-development hashes match | Product streaming/ARQ/persistence/finalization path |
| Product wire, streaming, ARQ, persistence, or completed-file goodput works | **Unverified** | Spike evidence is explicitly outside these contracts | G2/G3 production vertical slices and G4 independent validation |
| Same-device or two-device acoustic transfer works | **Unverified** | No physical evidence | Exact-candidate physical matrix |
| Android/mobile compatibility or minimum-memory support | **Unverified** | No qualifying device evidence | Android hosted/installed, thermal, route, and bounded-memory runs |
| Production ready or releasable | **No** | G1 is feasibility/reference evidence only | G2–G7, combined reviews, physical acceptance, security/license/release decision |

## 7. Recorded tests and results

### Browser code freeze and evidence child

| Command or check | Recorded result |
|---|---|
| `git diff --check`; `git diff --cached --check` | exit 0 from clean code freeze |
| `python3 build.py --check` | all fatal gates and negative fixtures green |
| Seven relevant `node --check` commands | all exit 0 |
| `node tests/acoustic-g1-browser.mjs` | 51/51 assertions; 9 GO; one Blob candidate STOP; zero required desktop/API STOP; `G1_PARTIAL_BLOCKED` |
| `node tests/optical-built.mjs` | 50/50 |
| `node tests/smoke.mjs` | 104/104 generated pages |
| `node tests/pwa-verify.mjs coexist` | recorded pass |
| `node tests/pwa-verify.mjs install` | 108/108 precache and offline/installability checks |
| Independent final review | 14 source, 3 artifact, and 30 raw-log hashes matched; code/evidence ancestry and tree binding verified |

These browser and PWA runs belong to the quarantined spike release path. They support the stated
feasibility facts, not product release integration.

### Link remediation and external acceptance

| Command or check | Recorded result |
|---|---|
| `node tests/acoustic-g1-link.mjs --quick` | pass |
| `node tests/acoustic-g1-link.mjs --evidence` | 75 passed, 0 failed; deterministic rerun/fingerprint gate pass |
| `python3 build.py --check` | all fatal gates and negative fixtures green |
| Source input manifest | 21/21 recorded SHA-256 values matched in final rereview |
| Independent clean transmitter fixture | decoded exact 24-byte payload SHA-256 |
| Clean 1 MiB | 1,366/1,366 frames; 0 failed attempts; exact final SHA-256; no channel invocation |
| Impaired-development 1 MiB | 1,366/1,366 transmissions through `runChannel`; 0 failed attempts/retries; exact final SHA-256 |
| External deterministic acceptance | 16/16 pass; 16/16 exact fixture hashes; byte-identical 41,424-byte reproduction |

## 8. Stage-B authorization and order

The commit containing this disposition is the only authorized Stage-B starting point.

1. **G2 / Lane 1 first:** create the production protocol, DSP, simulator, and Worker-core lane from
   this integration commit. Reimplement or selectively adapt reviewed ideas under `PROTOCOL.md`,
   `DSP_DESIGN.md`, production bounds, and independent tests. Do not cherry-pick the link spike.
2. **Review, then integrate Lane 1:** the serial integration owner verifies the owned-path diff, tests,
   API freeze, evidence labels, provenance, and clean state before integration. No Lane 2 production
   work is integrated against an unreviewed Lane 1 API.
3. **G3 / Lane 2 second:** after Lane 1 integration and review, create/rebase the browser runtime,
   UI, persistence, and live-session lane on that exact integration commit. Use the build-time data
   Worklet mechanism and no runtime module/network fallback. Do not cherry-pick the browser spike.
4. **Combined review, then Lane 2 integration:** review production Lane 2 against integrated Lane 1.
   Integrate Lane 2 only after that review accepts the production source and exact packaging plan.
   Browser catalog/manifest/build/generated/PWA release integration remains deferred until the
   combined review is complete.
5. **Lane 3 independent evidence/review:** only after production Lane 1 and Lane 2 integration,
   branch/rebase the independent vector, adversarial, built-page, lifecycle, security, provenance,
   and evidence work. Lane 3 reports defects to the owning lane and does not repair owner files.

One writable owner per worktree/path and review-before-integration remain mandatory. The serial
integration owner alone changes shared build/manifest/workflow/root/generated files. Physical and
Android gates remain explicit blockers for the claims they measure, not blockers to G2/G3 software
implementation.

## 9. Unresolved hardware and platform blockers

The following remain unverified and must stay visible in every support or release matrix:

- Android Chromium hosted behavior and an actually installed/offline device path;
- ordinary user-gesture/autoplay/visibility/background behavior on target devices;
- physical microphone capture and speaker playback, including requested/supported/effective
  EC/NS/AGC and channel/rate reporting;
- input/output route selection and change, track mute/end, `devicechange`, device loss, Bluetooth or
  headphone exclusions, AudioContext interruption, and recovery epochs;
- bounded 16 MiB hash/Blob/IndexedDB/runtime memory and 15–30 minute thermal behavior on the declared
  minimum mobile device;
- real render-thread/Worker queue budgets and physical clock drift without sample slips;
- physical C0 discovery, reverse ACK delivery, room tail, and p50/p95/p99 turnaround;
- same-device acoustic loopback, which remains a separate evidence class;
- reproducible two-device over-air compatibility, reliability, distance, noise, safe-level wording,
  and completed-file goodput.

No simulator, fake-media, desktop Web Audio, hosted PWA, same-device, cable, or WAV result may be
promoted to two-device over-air evidence.

## 10. Acceptance criteria still open

- **G1a remainder:** Android hosted/installed paths and production built-page packaging; direct-file
  desktop must be rerun from production code using only the data Worklet candidate.
- **G1b:** real capture controls, devices, permission policies, device loss, and route changes.
- **G1c:** at least 1,000 representative physical turns and the contracted reverse C0/ACK
  distributions; no open-loop fallback.
- **G1d:** production streaming drift/resampler behavior, worklet/Worker/main-thread budgets,
  overflow/underflow limits, minimum-device mobile thermal run, and physical drift hash gate.
- **G1e:** production atomic durable-ACK transaction matrix, reload/resume, file-origin identity,
  quota/corruption/eviction/private-mode behavior, and minimum-mobile 16 MiB memory limit.
- **G1f:** production generated-page install/update/cache/accessibility review without inheriting the
  spike's release/catalog/cache changes.
- **G2:** product wire/parser/manifest/ARQ/session and C0/R1 DSP/simulator vertical slice, hostile
  bounds, failure paths, API freeze, and production replacements for the link-review findings.
- **G3:** data-URL AudioWorklet runtime, Worker integration, persistence, UI/live session, lifecycle,
  final-hash, quota/corruption, resume, and state wording from production source.
- **Lane 1/Lane 2 combined review:** exact source integration and packaging plan before shared
  release files change.
- **Lane 3/G4:** independent protocol/DSP vectors, independent impaired or prerecorded evidence,
  adversarial parser/storage/session tests, built CSP/no-network tests, accessibility, security, and
  provenance review.
- **G5:** serial Local Suite release integration and complete regression suite from a clean exact
  candidate; this proves software integration only.
- **G6:** exact-candidate two-device physical acceptance. Any tuning creates a new candidate.
- **G7:** explicit security, dependency/license/provenance, support-matrix, physical-evidence, and
  release decision.

Parameter lock, physical success, production readiness, and release remain unauthorized until their
own gates pass.

## 11. Dependencies, licenses, and provenance

Neither spike added a runtime package dependency or changed a lockfile/license artifact. This
documentation disposition adds none. The repository still has no top-level license, so no blanket
compatibility or redistribution conclusion exists.

Stage B should prefer owned reimplementation. Any copied code, table, vector, recording, model
output, WASM, or dependency requires exact source/version, SHA-256, derivation, transitive license
and notice review, and reproducible evidence before integration. Algorithm references in the link
provenance ledger inform the spike; they do not establish original authorship, patent clearance, or
permission to copy the spike wholesale.
