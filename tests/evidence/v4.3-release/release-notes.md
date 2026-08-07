# Local Suite v4.3.0

Local Suite v4.3.0 expands **The Arcade** from five to seven verified browser games while retaining
the existing 102-tool manifest and 103-page generated distribution.

## Arcade expansion

- Adds **Unicorn 42069er: The Sprinkle Mines** with its live GitHub Pages and source-repository
  destinations.
- Adds **Miner 42069er** with its live GitHub Pages and source-repository destinations.
- Bundles optimized card art mechanically derived from exact title screenshots in the owned game
  repositories; source commits, processing, dimensions, and payload details are recorded in
  `assets/arcade/PROVENANCE.md`.
- Keeps all card art inlined in `dist/arcade.html`, preserving the suite's self-contained and
  offline-friendly distribution model.
- Corrects image alternatives to describe the visible title screens accurately.
- Strengthens the focused Arcade contract to gate all seven exact cards, art/title/play
  destinations, source links, meaningful alternatives, decoded data-URI art, external-link safety,
  keyboard access, CSP, file/hosted behavior, and 390px layout.

## Compatibility and scope

- No manifest tool was added or removed: **102 tools plus the generated hub (103 HTML pages)**.
- No storage schema, provider integration, runtime dependency, or network permission changed.
- Existing Local Suite files and PWA behavior remain compatible with v4.2.0.

## Evidence

- Arcade implementation and hosted visual evidence: `tests/evidence/arcade-2026-08-06/`
- Release checklist and publication evidence: `tests/evidence/v4.3-release/`
