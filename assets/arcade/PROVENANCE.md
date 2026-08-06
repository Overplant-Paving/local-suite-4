# Arcade card art — source and provenance

The original five assets were copied from Overplant-Paving's own game repositories (or their live
GitHub Pages deployments) on 2026-07-30, then mechanically downscaled and JPEG-compressed with
Pillow (Lanczos, quality 78). The Unicorn and Miner additions were copied on 2026-08-06 and
processed with ImageMagick as specified in their rows. No image was creatively generated or
redrawn.

| File | Source | Original |
|---|---|---|
| `bathhouse-brigade.jpg` | `Overplant-Paving/bathhouse-brigade` @ main, `screenshots/02-gameplay.png` | 1440×900 PNG, 932,911 B |
| `bathhouse-brigade-mobile.jpg` | `Overplant-Paving/bathhouse-brigade-mobile` @ main, `screenshots/04-mobile-portrait.png` | 780×1328 PNG, 537,018 B |
| `chromatic-chains-desktop.jpg` | `Overplant-Paving/chromatic-chains-desktop` @ main, `assets/scenes/title/title-scene.png` | 1536×864 PNG, 1,343,165 B |
| `chromatic-chains-mobile.jpg` | `Overplant-Paving/chromatic-chains-mobile` @ main, `assets/scenes/title-portrait/title-scene-portrait.png` | 864×1536 PNG, 1,307,555 B |
| `doom-shareware.jpg` | Screenshot of the repository's own live deployment `https://overplant-paving.github.io/doom-shareware/` (the repo contains no image files) | 900×620 capture, 117,248 B |
| `unicorn-42069er.jpg` | `Overplant-Paving/unicorn-42069er` @ `afe35bb1`, `screenshots/title.png` (copied 2026-08-06; ImageMagick Lanczos, 640×400 crop, JPEG quality 78) | 1536×864 PNG, 1,542,913 B |
| `miner-42069er.jpg` | `Overplant-Paving/miner-42069er` @ `e3b750d1`, `screenshots/title.png` (copied 2026-08-06; ImageMagick Lanczos, 640×400 crop, JPEG quality 78) | 1536×864 PNG, 1,678,067 B |

The DOOM capture shows the game's title screen as served by the owned deployment; DOOM and its
artwork are © id Software — the card credits this and links only to the shareware deployment.

`build.py` inlines these files into `dist/arcade.html` as `data:` URIs (the `data-suite-asset`
marker), so the built Arcade stays a single self-contained file.
