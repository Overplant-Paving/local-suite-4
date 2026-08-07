# Acoustic Modem Recovery Audit

Audit completed: 2026-08-07

## Decision

The pre-Codex checkpoint is a clean, exact Local Suite v4.3.1 baseline. There is no prior acoustic implementation to recover, repair, replace, or quarantine. The only approved recovery action is to **adopt the clean baseline** and begin evidence-led feasibility and architecture work.

Current gate: **Gate 0 — safe recovery complete after this record is committed.** No implementation, live-link, over-air, resumability, or performance claim exists yet.

## Verified checkpoint

| Item | Result |
|---|---|
| Checkpoint branch | `checkpoint/hermes-acoustic-pre-codex-20260807T172837-0500` |
| Checkpoint commit | `725e5863429fc2b7b41f5f6ab797ee0d67f66023` (`v4.3.1`) |
| Compared with | locally available `origin/main` |
| Ahead / behind | `0 / 0` |
| Tracked, staged, deleted, untracked | none |
| Diff by name, stat, and content | empty |
| Post-audit worktree | clean |
| Network refresh of `origin/main` | not performed by the read-only audit |

Hermes independently rechecked the empty diff and clean worktree after the worker exited.

## Recovery decision table

| Path or scope | Classification | Evidence | Integration disposition |
|---|---|---|---|
| Entire checkpoint `725e586…` | **adopt** | Clean status; identical to local `origin/main`; authoritative static gate green | Use as the project baseline |
| Acoustic task delta | no delta | No files differ from baseline; acoustic/modem source searches returned no implementation | Nothing to cherry-pick or merge |
| Adopt-after-repair candidates | none | No partial acoustic source, protocol, DSP, runtime, persistence, test, or documentation implementation exists | None |
| Replace candidates | none | No acoustic architecture or implementation exists | None |
| Quarantine candidates | none | No recordings, generated modem assets, experiments, caches, or untracked task debris exist | None |
| Phase-0 inventory and raw Codex logs under `/tmp` | orchestration evidence, not release content | External temporary records only | Keep outside the tracked product tree |
| Integration handoff commit `f44ac40…` | **adopt** | Factual repository/task-state record only; independently consistent with Git state | Retain on `feat/acoustic-modem-codex` |

## Baseline verification

Hermes reran:

```text
python3 build.py --check
```

Result: all fatal gates green, including release-tool count, source/manifest synchronization, generated `dist` staleness, inline-handler policy, CSP, catalog cross-check, key hygiene, PWA synchronization, and fatal negative fixtures.

The Codex audit independently reported 13/13 static gate groups passed and a clean post-check worktree. Browser/Playwright tests were not rerun during the audit because `tests/node_modules` was absent and the read-only worker was prohibited from installing dependencies.

## Existing constraints to adopt

- Source lives in `tools/`, `core/`, `manifest/`, and the build pipeline; committed `dist/` is generated and must never be hand-edited.
- Every generated page must remain self-contained and double-clickable under `file://`.
- `manifest/tools.json` drives hub navigation, CSP, and PWA generation.
- The current release cardinality is 102 tools plus the generated hub; adding the acoustic tool requires all count and generated-artifact updates through the normal build.
- GitHub Pages paths are relative and the hosted-only service worker precaches the application shell.
- Generated CSP hashes inline scripts; existing Blob/WASM allowances are narrowly scoped to Optical Transfer and must not be relaxed globally without evidence.
- Local Suite has no existing IndexedDB abstraction or acoustic DSP/protocol primitive.
- The repository has no top-level `LICENSE`; any third-party DSP/FEC implementation requires explicit scoped license review, attribution, exact artifacts, and hashes.

## Reusable patterns

Adopt patterns—not optical wire-format code—from `tools/optical.html`:

- bounded metadata parsing and hostile-input limits;
- safe filename/media/download handling;
- final SHA-256 gating and explicit integrity-versus-authenticity wording;
- generation-token cancellation and deterministic teardown;
- focused browser-test hooks and third-party provenance discipline.

Other reusable suite patterns include manifest-driven navigation, Local Suite chrome, live regions and keyboard behavior, object-URL cleanup, user-gesture AudioContext creation, actual `AudioContext.sampleRate` reads, relative PWA paths, and scoped CSP generation.

Keep optical-specific DCF2, FNV-1a, LT fountain coding, QR/ZXing worker/WASM, and camera logic isolated. They do not satisfy acoustic CRC32C, FEC, ACK/retransmission, or DSP requirements.

## Highest-risk architecture constraints

1. Prove AudioWorklet and microphone behavior under hosted HTTPS and the suite's `file://` contract before locking packaging or CSP.
2. Prove half-duplex speaker/microphone turnaround and robust reverse-link ACK acquisition before accepting goodput estimates.
3. Design sample-rate-derived carrier plans and test browser/device resampling, SRO/clock drift, AGC, EC, NS, clipping, and room impulse response.
4. Define IndexedDB schema, corruption/eviction behavior, resume identity, idempotence, and settings-backup policy.
5. Define explicit file/session/memory limits and final SHA-256 strategy; standard Web Crypto does not provide incremental digest streaming.
6. Separate simulator, digital loopback, same-device acoustic loop, cable, and physical over-air evidence in every benchmark claim.
7. Preserve Optical Transfer's focused gate, generated artifact, CSP allowances, and wire format except for normal manifest/PWA regeneration.

## Audit provenance

- Worker role: read-only Codex recovery auditor
- Codex CLI: `0.147.0`
- Requested/accepted invocation: `gpt-5.6-sol`, `model_reasoning_effort="xhigh"`, `service_tier="fast"`, `features.fast_mode=true`
- Sandbox: `read-only`
- Approval policy: `never` at the global CLI position required by Codex 0.147
- Worktree: `/home/intelligence-zero/worktrees/local-suite-4-acoustic-audit`
- Base/final commit: `725e5863429fc2b7b41f5f6ab797ee0d67f66023`
- Changed files / commits / dependencies / licenses: none
- Captured report: `/tmp/acoustic-codex/recovery-audit.md`
- Report SHA-256: `bfc8f65570155a36d35bbaffee3e6f371a7a4a551d1323f1d3b5ac116b8530b6`
- JSONL SHA-256: `0fbb21f7cba63e6cd14a9d717a5a4508c92aa74de26ae0dac805033706dd7ab2`

The worker encountered a read-only sandbox `bwrap` loopback setup failure (`RTM_NEWADDR: Operation not permitted`) for its first command batch, then completed the same repository reads successfully without altering the worktree. This is an execution-environment limitation to track; it is not evidence of a repository defect.

## Next integration order

1. Independent lead-architect and adversarial-critic passes from the checkpoint.
2. Codex synthesis of repository assessment, architecture, protocol, implementation plan, profiles, and stable lane contracts.
3. Commit reviewed contracts before any parallel writable implementation worktree is created.
4. Run isolated implementation lanes with exclusive ownership and integrate only verified commits.
