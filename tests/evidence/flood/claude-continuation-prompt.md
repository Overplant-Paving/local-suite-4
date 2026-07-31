Resume the Flood Risk & Conditions implementation in `/home/intelligence-zero/work/local-suite-4` from the current working tree.

The previous run was artificially stopped by `--max-budget-usd`; that cap has now been removed because this Claude Code installation is authenticated to the user's Claude Max subscription. Do not restart or discard completed work.

Required actions:

1. Inspect the current diff and all new flood files.
2. Determine exactly what remains incomplete from `FLOOD-TOOL-PLAN.md` and the original implementation prompt at `tests/evidence/flood/claude-implementation-prompt.md`.
3. Finish or correct all remaining implementation, test, documentation, generated-output, CI, accessibility, responsive/visual, caching, race, CSP, and evidence work.
4. Run the complete applicable verification set, including `python3 build.py`, `python3 build.py --check`, focused flood tests, `tests/verify-tool.mjs flood`, full smoke, relevant location tests, and required PWA/installability/update checks.
5. Fix failures and rerun until green. Archive outputs and screenshots under `tests/evidence/flood/`.
6. Do not commit, push, branch, or rewrite history. Do not edit `dist/` manually. Do not access secrets or `.env` files.
7. Finish with a concise summary listing exact changed files, exact commands and outcomes, remaining live-source limitations, and confirmation that no commit/push occurred.
