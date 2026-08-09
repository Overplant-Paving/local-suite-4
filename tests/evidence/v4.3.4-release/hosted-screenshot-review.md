# v4.3.4 hosted screenshot review

Fresh-browser screenshots were captured after artifact-bearing Pages run `31327625912` deployed commit `14d89da0c1c30f6759a32274a70580a655713066`.

## Hosted hub

- Header visibly reports **105 tools**.
- Stable **Optical Transfer** remains under **Utilities & Toys** with `optical.html`.
- **Beta Tools** visibly contains exactly three cards: Audio Transfer, ChromaLink, and **Optical Transfer Beta** (`optical-beta.html`).
- Full-page 1280 px rendering has a consistent three-column grid with no visible clipping, overlap, broken cards, or horizontal overflow.

## Hosted Optical Transfer Beta

- Desktop and 390 px mobile screenshots identify the page as **Optical Transfer Beta** and show the Receive tab active.
- Receive tuning visibly shows Requested camera FPS with **30** selected. The same fresh browser context recorded the complete option list `[30, 60, 90, 120]` in `hosted-browser.json`.
- The guidance visibly states that high-frame-rate requests are optional hints, may be capped or reduce resolution, and that Camera mode reports actual settings.
- Desktop uses a balanced two-column receiver/tuning layout. Mobile stacks both cards cleanly; measured `clientWidth` and `scrollWidth` are both 390 px.
- No visual clipping, overlap, broken responsive layout, console/page errors, failed requests, or horizontal overflow were observed.

These checks verify hosted bytes, DOM, and rendered layout. They do not claim that a physical camera delivers 90 or 120 FPS.
