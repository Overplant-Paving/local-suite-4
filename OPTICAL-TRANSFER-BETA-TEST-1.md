# Optical Transfer Beta Test 1

Optical Transfer Beta Test 1 is a separate Beta Tools product page for the selected H66-R2 faster
package. It does not replace stable `optical.html` or the existing `optical-beta.html`.

## Selected Package

- Product identity: `tools/optical-beta-test-1.html`, manifest id `optical-beta-test-1`, name
  `Optical Transfer Beta Test 1`, category `beta`.
- Carrier: QR V37 with 2,563-byte frames, ECC L, fixed mask 4, square symbols, and a 4-module quiet
  zone.
- Presentation: requestAnimationFrame scheduler presenting every second callback, about 30
  presentations/s, with reduced-motion falling back to a slow no-catch-up cadence.
- Sender: precompute ring depth 3.
- Receiver: four workers, processor capture when supported, calibrated fixed ROI resampled to
  640x768, ZXing fast decode options, and global-histogram binarization.
- Recovery: normal LT peeling remains authoritative; H40 residual completion is optional,
  adaptive, chunked, and safely falls back when not admitted or not completed.
- Lifecycle: hidden sender stop, stale camera/worker promise protection, epoch ownership, worker
  drain on teardown, and post-SHA receiver closure.

## Production Cleanup

The product page excludes the selected-package derivative's benchmark harness and campaign tree. It
does not depend on lab query selectors, `?hNN` flags, campaign/run identifiers, synthetic trials,
evidence writers, CDP/ADB/browser port controls, localhost endpoints, fixed test payload controls,
harness timeouts, debug-only pathways, or 1 MiB benchmark assumptions.

## Bounds

- Removed benchmark/artificial cap: the prior fixed 1.2 s and 8 MiB H40 benchmark guards are not
  production admission rules.
- Adaptive bound: H40 residual admission scales with payload size, source-block count, block length,
  retained rows, hardware concurrency, and reported device memory. Solving is chunked with browser
  yields and stops the optional residual attempt if adaptive work, time, or memory budgets are
  exceeded.
- Protocol correctness bound: DCF2 file/container lengths, frame headers, source-block count, QR
  frame capacity, FNV-1a container checksum, gzip length, and SHA-256 integrity must all pass.
- Resource safety bound: files remain capped at 16 MB, snippets at 1 MB, pending LT equation bytes
  at 32 MiB, H40 residual planning at 64 MiB, four receiver workers, bounded worker queues, bounded
  sender precompute, and bounded lifecycle drain waits.
- External browser/device limit: presentation cadence, camera capture and optics, decode yield and
  CPU, LT overhead, browser scheduling, and thermal state remain outside the protocol's control.

## Performance Evidence

The selected package's gross carrier ceiling is 76,890 B/s. It is not an unconstrained maximum.

Physical evidence from selection is reported separately:

- Strict 1 MiB: 65,919.16 B/s.
- 3 MiB observed: 57,221.06 B/s, non-counting because the prior benchmark guard interfered.
- 10 MiB observed: 53,575.31 B/s, non-counting because the prior benchmark guard interfered.

Larger production performance was not physically retested after extraction in this repository. The
production page removes the benchmark guard and keeps bounded adaptive fallback behavior; actual
throughput still depends on the browser and device path above.

## Security Language

SHA-256 verifies recovered payload integrity. It does not authenticate the sender, provide secrecy,
or prevent a camera with line of sight from receiving the visible optical stream.
