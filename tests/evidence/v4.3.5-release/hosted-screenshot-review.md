# Hosted v4.3.5 screenshot review

Deployment verified from a fresh Playwright Chromium context with service workers blocked so the browser could not reuse an older app-shell cache.

## Hub

Reviewed: `hosted-hub.png`

- The hosted command-center hub reports 106 tools and renders all cards without horizontal overflow.
- Beta Tools contains four cards: Audio Transfer, ChromaLink, Optical Transfer Beta, and Optical Transfer Beta Test 1.
- The new card links to the hosted `optical-beta-test-1.html` page.
- No clipping, overlap, broken spacing, missing controls, credentials, personal data, device serials, or private paths are visible.

## Optical Transfer Beta Test 1

Reviewed: `hosted-optical-beta-test-1.png` and `hosted-optical-beta-test-1-receive.png`.

- The Send view exposes file/text selection, Prepare transfer, Start optical stream, Reset, carrier disclosure, and safety language.
- The Receive view exposes Start camera, Reset receiver, status, bounded receiver telemetry, requested width 1280, requested 60 FPS, four workers, and protocol/security disclosure.
- The page remains within the viewport without horizontal overflow in both views.
- No camera permission prompt was triggered because verification did not click Start camera.
- No console errors, CSP errors, visual defects, or sensitive values were observed.
