# Local Suite v4.3.5 Release Evidence Summary

Package target: Optical Transfer Beta Test 1 as the 106th manifest tool and fourth Beta Tools card.

## Scope

- Added `tools/optical-beta-test-1.html` as a clean product page, not the derivative benchmark
  harness or campaign tree.
- Preserved stable `optical.html`, generated stable `dist/optical.html`,
  `tests/optical-built.mjs`, and `OPTICAL-TRANSFER.md` byte-for-byte.
- Preserved existing `optical-beta.html` and its existing identity.
- Raised the current suite version metadata to v4.3.5 with 106 manifest tools and 107 generated
  HTML pages.

## Selected Package

H66-R2 selected QR V37/2,563, ECC L, fixed mask 4, about 30 presentations/s via rAF every second
callback, sender precompute ring depth 3, four receiver workers, processor capture, calibrated
fixed ROI, ZXing fast global histogram, adaptive H40 residual completion, and post-SHA lifecycle
closure.

## Bound Classifications

- Removed benchmark/artificial cap: the old fixed 1.2 s and 8 MiB H40 benchmark guards are not
  production admission rules.
- Adaptive bound: H40 is payload/device-aware, chunked, yielding, and safely optional.
- Protocol correctness bound: file/container, frame, source-block, checksum, gzip, and SHA-256
  checks remain fail-closed.
- Resource safety bound: file/snippet/frame/equation/H40/worker/queue/lifecycle ceilings remain
  bounded.
- External browser/device limit: cadence, camera optics/capture, decode yield/CPU, LT overhead,
  browser scheduling, and thermal state remain outside protocol control.

## Performance Boundary

Gross selected-package carrier ceiling: 76,890 B/s.

Physical evidence from selection:

- Strict 1 MiB: 65,919.16 B/s.
- 3 MiB observed: 57,221.06 B/s, non-counting due prior benchmark guard.
- 10 MiB observed: 53,575.31 B/s, non-counting due prior benchmark guard.

Larger production transfers were not physically retested after product extraction in this local
worktree.
