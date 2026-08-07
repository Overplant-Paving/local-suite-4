# Local Suite v4.3.1

Local Suite v4.3.1 is a compatibility-preserving Optical Transfer hardening release. It retains the 102-tool manifest and 103-page generated distribution and does not change the DCF2 container or deterministic LT optical wire format.

## Optical Transfer corrections

- Sizes the sender QR from the rendered stage instead of the viewport, preserving a square symbol across desktop columns, the 760/761 px breakpoint, live resizing, and narrow layouts.
- Stops hidden sender generation when Receive opens and resets receiver/camera state when Send opens.
- Keeps verification progress visible, prevents failed or invalid UTF-8 transfers from displaying completed progress, and invalidates asynchronous verification on reset or mode switch.
- Rejects the impossible 2,953-byte/ECC M configuration before preparation or streaming.
- Refreshes actual camera settings after live constraints and prevents stale promises from updating torn-down UI state.
- Adds a 32 MiB padded equation-buffer budget alongside the existing fountain-frame ceiling.
- Labels SHA-256 as transfer integrity rather than sender authentication.
- Warns about high-contrast animation and limits reduced-motion presentation to 2 FPS without catch-up bursts.
- Verifies vendored QR/ZXing assets against their recorded SHA-256 provenance.

## Regression coverage

The focused Optical gate now covers composited QR geometry, maximum-density live resizing, hidden sender shutdown, receiver verification races, invalid UTF-8 and corruption progress, QR/ECC compatibility, reduced-motion pacing, live and stale camera-setting updates, memory budgets, integrity wording, and vendor hashes in addition to the existing protocol, recovery, CSP, WASM, and camera lifecycle contracts.

## Compatibility and scope

- Exactly **102 tools plus the generated hub (103 HTML pages)**.
- No storage-schema, provider, runtime dependency, account, service, or required relay change.
- Existing DCF2/LT senders and receivers remain wire-compatible.
- `dist/optical.html` remains self-contained and available through the 107-entry PWA precache.

## Evidence

- Local and publication checklist: `tests/evidence/v4.3.1-release/release-checklist.md`
- Local gate output: `tests/evidence/v4.3.1-release/`
- Hosted byte-for-byte and browser verification: `tests/evidence/v4.3.1-release/hosted-verify.txt`
