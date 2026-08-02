# Local Suite v4.2.0

Local Suite v4.2.0 adds **Optical Transfer**, a browser-only screen-to-camera transport for files and text.

## Optical Transfer

- Endless animated QR stream with deterministic LT fountain recovery
- Tolerates dropped, duplicated, and out-of-order frames
- Real inlined ZXing-WASM camera decoder and local QR encoder
- No payload upload, account, pairing, relay, app, or runtime asset request
- Optional bounded gzip compression
- FNV optical checksum plus SHA-256 verification before download or copy
- 16 MB file and 1 MB text ceilings
- Hardened frame/container validation, filename handling, session isolation, and camera/worker cleanup
- Sender works from `file://`; mobile receive uses hosted HTTPS and remains available offline through the PWA cache

## Suite release

- 102 tools plus the hub (103 generated HTML pages)
- 107 service-worker precache entries
- Full smoke suite: 103/103 green
- Optical protocol, real QR/WASM decode, security, camera lifecycle, mobile layout, and PWA tests green
- Strict live Flood Risk acceptance rechecked and green
- Headed Chromium PWA installability verified with zero manifest, CSP, console, or page errors

This release also corrects stale repository metadata that still described the already-deployed v4.1 Flood Risk release as a candidate. A retroactive `v4.1.0` tag and GitHub Release document the deployed v4.1 commit.

## Important camera note

Optical Transfer's sender is directly double-clickable. Mobile browsers generally require a secure HTTPS origin for camera access; opening or installing the hosted Local Suite PWA once preserves that origin for subsequent offline receiver use. Physical handset throughput varies with camera focus, screen refresh rate, QR density, distance, and device performance.
