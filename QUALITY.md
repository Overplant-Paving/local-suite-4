# QUALITY.md — security, accessibility, testing, release

The bar every tool must clear — applied in full at migration time and **re-verified** in the
Phase 4 audit. The developer is Claude, so no checklist item is "too tedious": everything here is
mandatory, mechanically checked where possible, and evidenced where not. The v1 audit found a
genuinely clean baseline — no secrets, no `eval`, sound crypto (rejection-sampled
`crypto.getRandomValues` in password.html), disciplined escaping alongside 387 `innerHTML` uses.
v2's job is to make that discipline *enforced* instead of habitual.

## 1. Security

### 1.1 Content-Security-Policy (ADR D6)

v1 ships zero CSP. v2: `build.py` generates a per-file
`<meta http-equiv="Content-Security-Policy">` in every dist file:

```
default-src 'none';
script-src 'sha256-<hash1>' 'sha256-<hash2>';   ← recomputed every build from actual script contents
style-src 'unsafe-inline';                        ← inline styles are structural to single-file
img-src data: <hosts from manifest>;              ← e.g. radar.weather.gov, covers.openlibrary.org
connect-src <endpoint hosts from manifest>;
```

- Hand-hashing 71 files would be absurd; with a generator it's free and always current.
- **Pilot first** (Phase 1, 3 tools, Chrome/Edge/Firefox from `file://`) before suite-wide rollout.
- Documented fallback: if a browser quirk breaks hashes under `file://`, degrade *that file* to
  `script-src 'unsafe-inline'` — keeping `connect-src`, which is the part that actually limits
  exfiltration.

### 1.2 innerHTML / escaping rules

- Interpolating **remote data** (API responses) into `innerHTML` requires `Suite.esc()` on every
  expression. Building via `createElement`/`textContent` is always acceptable and preferred for
  complex structures.
- `--check` runs a heuristic: flag template-literal interpolations into `.innerHTML` whose
  expressions aren't wrapped in `Suite.esc(`. Heuristics have false positives, so a flag doesn't
  auto-fail the build — but **every flag must be resolved** (fixed, or recorded as verified-clean
  with reasoning in an allowlist file the check reads). An unresolved flag fails the release
  checklist.
- **No inline event handlers** — `--check` rejects `on\w+=` in dist (fatal). Replaces the two v1
  stragglers (`art.html:325`, `books.html:200` image-fallback `onerror=`).

### 1.3 Escaping re-audit (Phase 4, one-time)

Five v1 files render API data with notably few escape calls. Re-audit each line-by-line and either
fix or record "verified clean" in the MIGRATION.md flags column:

- [ ] factbook.html (1 esc call in v1)
- [ ] art.html (3)
- [ ] dictionary.html (2)
- [ ] word.html (2)
- [ ] wiki.html (2 — renders Wikipedia HTML; must keep using DOM append, never raw injection)

### 1.4 Keys

Never committed (gate §4.4-8 in ARCHITECTURE.md); user keys live in `suite.key.*`; the BART public
demo key is externalized with the public value as documented default. Docs remind: don't publish a
personal dist copy with your keys pasted into localStorage exports.

## 2. Accessibility checklist (per tool)

The v1 baseline: semantic landmarks good, ARIA sparse (24/72 files, ~1 attribute each), icon-only
buttons unlabeled, no live regions. Fixes split: **once in core** vs **per tool**.

Once in core (Phase 1):
- [ ] theme button gets `aria-label="Toggle light/dark theme"` + `aria-pressed`
- [ ] visible `:focus-visible` outline on all interactive elements
- [ ] `prefers-reduced-motion` guard disabling nonessential animation
- [ ] back-link pattern is a real `<a>` with text, not icon-only

Per tool (applied at migration time — recipe step 8; re-verified in the Phase 4 audit):
- [ ] every icon-only button (`×`, `👁`, `⟳`…) has an `aria-label`
- [ ] async result containers use `Suite.liveRegion(el)` (`aria-live="polite"`) so screen readers
      hear data arrive after fetch
- [ ] form inputs have `<label>` or `aria-label`; Enter submits where a search box exists
- [ ] keyboard path exists for every mouse path (tab order sane; Esc closes overlays)
- [ ] contrast: both palettes pass WCAG AA for text (spot-check with the suite's own color.html
      contrast checker — dogfooding)

## 3. Testing

**Tier 1 — static gates, every commit:** `python3 build.py --check`. The gates (ARCHITECTURE.md
§4.4): manifest↔file sync, markers present, dist staleness, no inline handlers, CSP present +
hashes valid, escaping heuristic, CATALOG cross-check, key hygiene. Zero-dependency, seconds to
run. **Every fatal gate ships with negative tests** — fixture inputs under `tests/fixtures/` that
must fail the check (a file with an inline handler, a stale dist, a mismatched hash…). A gate
that has never been seen to fail is assumed broken.

**Tier 2 — smoke suite, mandatory:** `tests/smoke.mjs` (Playwright — the one npm concession,
isolated in `tests/`, never required for *building*, always required for *shipping*). For each of
every generated HTML file (currently 102 tools plus the hub, 103 files):

1. open via `file://`
2. assert zero console errors
3. assert header/back-link renders
4. click theme toggle → `document.documentElement.dataset.theme` flips, and flips back
5. (network tools) block fetch → assert the offline/stale card renders instead of a blank

Run: after any `core/` or `build.py` change (full suite), at every migration batch completion,
and as a release gate. The GitHub Pages workflow repeats the static, focused-v3, and smoke gates
before deployment; the executing agent also archives release output. A release with a red or unrun
suite does not happen.

**Tier 3 — per-tool verification evidence:** produced by the migration recipe (MIGRATION.md §1
step 10) and archived under `tests/evidence/<tool>/`: side-by-side screenshots against v1 in both
themes, the exercised interaction or live-fetch record, offline-path proof, and a localStorage
snapshot. The burn-down table links to it; no evidence, not done.

## 4. Definition of done (per migrated tool)

- [ ] recipe steps 1–11 in MIGRATION.md complete; `--check` green
- [ ] visual parity with v1 proven by side-by-side screenshots, both themes (evidence dir)
- [ ] core feature exercised end-to-end (live fetch recorded, or full offline interaction)
- [ ] offline/stale-cache path verified for network tools
- [ ] localStorage keys identical to v1 (snapshot in evidence dir)
- [ ] a11y per-tool checklist (§2) complete — not deferred
- [ ] diff reviewed against the `v1-import` tag; v1 feature walk-through shows no regressions

## 5. Release checklist (version-neutral)

- [ ] `python3 build.py` — clean build
- [ ] `python3 build.py --check` — green, including negative tests
- [ ] smoke suite green across every generated HTML file (tier 2), output archived
- [ ] focused current-version contracts green (multiple locations, location cross-tab,
      Flight Tracker, Parks Explorer, Arcade, favorites/recents, and — since v4.1 — the built
      Flood Risk & Conditions gate `tests/flood-built.mjs`)
- [ ] **strict live acceptance** green for any tool whose primary answer comes from one upstream
      service: the runner must require the recorded correct live result and exit nonzero
      otherwise. A diagnostic capture that records an outage is not acceptance. Current gate:
      `tests/flood-live-accept.mjs` (release-blocking for v4.1)
- [ ] zero unresolved escaping-heuristic flags (§1.2)
- [ ] dist committed; staleness gate confirms source↔dist match
- [ ] CATALOG.md verification dates touched for any endpoint that changed
- [ ] `suite.meta.schemaVersion` bumped iff storage layout changed, with migration entry
- [ ] named-location migration verified from a real v2 `suite.location`; active-location switches
      mirror correctly and cannot render prior-location cache data
- [ ] ROADMAP.md status block and MIGRATION.md burn-down table current
- [ ] Pages verification/deploy workflow green; hosted `index.html` and `sw.js` byte-checked against local `dist/`
- [ ] tag pushed
