# Acoustic Modem Handoff: Current State

Captured: 2026-08-07T17:28:37-05:00

## Purpose

This document freezes the state inherited by the Codex-orchestrated acoustic modem mission. It is an orchestration and recovery record, not a claim that acoustic modem implementation has begun.

## Repository inventory

- Repository root: `/home/intelligence-zero/local-suite-4`
- Remote: `origin https://github.com/Overplant-Paving/local-suite-4.git` (fetch and push)
- Remote default branch: `origin/main`
- Original branch: `main`
- Original HEAD: `725e5863429fc2b7b41f5f6ab797ee0d67f66023` (`v4.3.1`)
- Original upstream: `origin/main`
- Original status: clean and synchronized (`+0/-0`)
- Tracked modifications: none
- Staged changes: none
- Deletions: none
- Untracked files: none
- Stashes: none
- Original worktrees: one, at the repository root
- Existing local branches before recovery: `main` only

The complete command transcript was saved outside the repository at `/tmp/local-suite-4-acoustic-phase0-inventory.txt`.

## Recoverable checkpoint

- Checkpoint branch: `checkpoint/hermes-acoustic-pre-codex-20260807T172837-0500`
- Checkpoint commit: `725e5863429fc2b7b41f5f6ab797ee0d67f66023`
- Integration branch: `feat/acoustic-modem-codex`
- Integration branch base: `725e5863429fc2b7b41f5f6ab797ee0d67f66023`

There were no acoustic-task source changes to checkpoint. The checkpoint branch therefore preserves the exact clean v4.3.1 baseline. No reset, force checkout, deletion, stash, or force push was used.

## Work completed before the Codex handoff

1. Loaded the repository, GitHub, software-delivery, Codex-delegation, and Hermes operating guidance.
2. Verified GitHub authentication for the repository owner account and cloned the repository.
3. Read the repository's `CLAUDE.md` instructions emitted during clone.
4. Attempted to inspect the deployed optical page and GitHub page with browser automation; both attempts timed out while the browser daemon was starting. No product claim is based on those failed attempts.
5. Verified the Hermes gateway is running and Telegram support is configured at the gateway level.
6. Inventoried Git state, branches, worktrees, stashes, diffs, and task-related processes.
7. Found no active Hermes/Codex project writer. A stopped `claude` process dating from 2026-07-25 was visible, but it predates this task and was not terminated as part of this mission.
8. Created the checkpoint and clean integration branches listed above.
9. Updated the user-local Codex CLI from 0.145.0 to 0.147.0 at its existing NVM installation path. Authentication and provider connectivity remained healthy. `codex doctor` still notes that the shell's generic npm global prefix differs from the NVM installation prefix; this does not prevent running the installed Codex binary.

## Acoustic implementation state

- Application code: not started.
- Protocol/DSP code: not started.
- Browser audio runtime: not started.
- Tests/simulator/benchmarks: not started.
- Acoustic documentation: this handoff is the first task document.
- Prior acoustic diffs to adopt, repair, replace, or quarantine: none.

## Tests and evidence inherited

No acoustic tests have been run because no acoustic implementation existed at handoff. Existing Local Suite v4.3.1 release evidence is present under `tests/evidence/v4.3.1-release/`, but it has not yet been revalidated for this feature branch.

## Known failures and constraints

- Browser automation timed out twice before repository work began; deployed-page inspection must be retried through an alternative browser path or after repairing/starting the browser runtime.
- No physical-device acoustic test has been performed. Physical compatibility and over-air performance remain unverified until actual hardware evidence exists.
- The Codex CLI's self-update diagnostics report a generic npm-prefix mismatch even though the user-local NVM installation was explicitly updated and `codex --version` reports 0.147.0.
- No model fallback has been selected. The requested `gpt-5.6-sol`, `xhigh`, and Fast-mode combination must be validated by an actual Codex invocation before substantive work.

## Assumptions requiring Codex verification

- Local Suite remains a no-framework build-generated static suite where source changes belong outside `dist/` and `python3 build.py --check` is authoritative.
- `audio.html` should be generated through the repository's normal tool manifest/build path rather than edited directly in `dist/`.
- Existing optical transfer code may provide reusable UI/session/storage patterns, but reuse must follow inspection rather than assumption.

## Immediate next action

Run a read-only Codex recovery audit at the checkpoint commit using `gpt-5.6-sol`, `xhigh`, Fast mode, and the installed CLI's supported non-interactive flags. The audit should verify that there is no hidden acoustic diff, inspect relevant repository architecture and optical-transfer integration constraints, and produce the adopt/repair/replace/quarantine recovery classification used by `RECOVERY_AUDIT.md`.
