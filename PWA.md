# PWA.md — the optional installable layer

Phase 3 spec. Short on purpose: the PWA is **additive**, and the moment it threatens the
single-file story, the PWA loses.

## 1. The invariant

**`file://` double-click is the primary mode, forever.** The PWA activates only when the suite is
served over http(s) — locally via `build.py --serve`, or publicly via the documented sharing host
(GitHub Pages serving `dist/`, set up in Phase 3):

```js
// in core/suite.js — inert from disk
if (location.protocol.startsWith("http") && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
```

Nothing else about the files changes between modes. Phase 3's regression bar: dist output opened
from `file://` behaves byte-identically to the pre-PWA build.

## 2. Generated artifacts

`build.py` emits both from the manifest — nothing is hand-maintained:

- **`dist/manifest.webmanifest`** — name "Local Suite", short_name, icons from `core/icons/`,
  `theme_color`/`background_color` from the suite palette (light `#f5f3ee`, accent `#2f6f6a`),
  `start_url: index.html`, `display: standalone`. Per-tool deep links work because every tool is
  just a page.
- **`dist/sw.js`** — precache list = every dist HTML file + icons + webmanifest. Cache name
  includes a content hash of the precache set (`suite-v4-<hash>`; the activate handler deletes
  only older `suite-v4-*` caches), so any rebuild that changes anything produces a new cache
  without touching supported v3 caches on the same GitHub Pages origin.

## 3. Caching strategy

- **App shell: cache-first.** The HTML files *are* the app; serve from cache, update in the
  background (stale-while-revalidate on navigation requests is acceptable; plain cache-first with
  hash-busting is simpler and fine).
- **API calls: network-only pass-through.** The SW never caches data-source responses. Tools
  already do localStorage caching with visible timestamps (`{t, v}` envelopes) — a second, invisible
  SW cache layer would serve stale data without the "cached from <time>" honesty. One caching
  brain, not two.
- **Update policy:** new SW calls `skipWaiting()`; on `activate`, `clients.claim()` + delete old
  `suite-v4-*` caches. CacheStorage is origin-wide rather than service-worker-scope-wide, so v3's
  `suite-v3-*` namespace is preserved when both supported releases are visited on GitHub Pages.
  Worst case a user sees fresh HTML one reload late — acceptable for this suite; never let an old
  v4 cache pin the whole v4 suite stale.

## 4. Offline matrix

| Class | Installed-PWA offline behavior |
|---|---|
| ~23 zero-network tools (password, notes, timers, convert…) | fully functional |
| CORS-open fetchers (weather, quakes…) | shell loads; data comes from localStorage stale cache with the "cached from…" card (existing v1 behavior) |
| keyed / CORS-blocked tools | shell loads; same stale-cache story; embedded data and link-out cards work offline by nature |

## 5. Storage origin nuance (important)

`file://` pages and `http://localhost:8000` are **different origins** — separate localStorage.
A user who lives in file:// mode and then installs the PWA starts with empty settings there.

- Documented in the hub's first-run hint when served over http with empty `suite.*` storage:
  "Coming from the double-click files? Export your data there (Settings → Backup) and import here."
- **settings.html export/import is the sanctioned bridge.** No automatic sync, no cleverness.

## 6. Install UX

- Icons: 192/512 px + maskable variant, drawn from the suite design language (teal accent on
  warm paper / dark slate) — produced in Phase 3, live in `core/icons/`.
- Verify install prompts + standalone launch on Chrome and Edge (primary), confirm graceful
  no-op on Firefox/Safari file:// usage.

## 7. Implementation addendum (Phase 3, 2026-07-16 — as built)

- **file:// parity, exactly:** every dist file differs from the pre-PWA build by (1) the
  protocol-gated registration block in the inlined `suite.js`, (2) one
  `<link rel="manifest">`, (3) `worker-src 'self'; manifest-src 'self'` appended to the CSP
  (all three inert from `file://`); the hub additionally carries the §5 origin hint.
  Asserted by diff: `tests/evidence/phase3/file-parity-diff.txt`.
- **Precache is sequential and revalidating** (`cache: "no-cache"` per request, one at a
  time), not `addAll`: a host's `max-age` (GitHub Pages: 600 s) must never precache stale
  bytes on update, and the earlier all-at-once `addAll` burst was observed to fail its install during
  verification. Cache name `suite-v4-<sha256[:12]>` over the full precache contents. The v3
  release also allows same-origin images in generated CSP so Chromium can load the manifest icons;
  the headed installability gate checks this explicitly.
- **`--check` gains a fatal `pwa-sync` gate** (dist sw.js + webmanifest must match a fresh
  render; negative-tested like every fatal gate).
- **Update-path verification** uses `registration.update()` as the deterministic stand-in
  for Chrome's own scheduled check (which spec-bypasses the HTTP cache for the SW script
  exactly the same way) — the natural check is hours-delayed and throttle-guarded, which a
  test cannot wait out. Verified end to end: `tests/evidence/phase3/pwa-update-verify.txt`.
- **Same-origin coexistence verification** seeds a v3 cache and an obsolete v4 cache before v4
  activation, then proves that v3 remains byte-readable while only the obsolete v4 cache is
  removed: `node tests/pwa-verify.mjs coexist`.
- **Icons** are rendered once from `core/icons/icon.svg` by `core/icons/make-icons.mjs`
  (Playwright) and checked in; the maskable variant is the same full-bleed art with the
  glyph inside the central safe zone.

## 8. Non-goals

No push notifications. No background sync. No periodic background refresh. No web-share targets.
The PWA is exactly: installable icon + offline shell. Anything more re-opens the "no tracking,
no accounts, calm" conversation, and the answer is no.
