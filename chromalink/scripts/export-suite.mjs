#!/usr/bin/env node
/**
 * Deterministic Local Suite export: wraps the Vite build (chromalink/dist)
 * in Local Suite chrome and writes ../tools/chromalink.html. Local Suite's
 * build.py then inlines core CSS/JS and generates dist/chromalink.html —
 * never edit Local Suite dist/ by hand, and never run this against a stale
 * Vite build (run `npm run build` first).
 *
 * The output depends only on chromalink/dist plus this template, so
 * re-running it is byte-stable and Local Suite's staleness gate stays
 * meaningful.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HERE = resolve(import.meta.dirname, '..');
const DIST = join(HERE, 'dist');
const TARGET = resolve(HERE, '..', 'tools', 'chromalink.html');

const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8');
const jsMatch = indexHtml.match(/src="\.\/(assets\/index-[^"]+\.js)"/);
const cssMatch = indexHtml.match(/href="\.\/(assets\/index-[^"]+\.css)"/);
if (!jsMatch || !cssMatch) {
  throw new Error('export-suite: could not locate built assets in dist/index.html');
}
const bundle = readFileSync(join(DIST, jsMatch[1]), 'utf8');
const css = readFileSync(join(DIST, cssMatch[1]), 'utf8');

// Guard rails: the inline embedding must survive HTML parsing and the
// Local Suite build gates byte-exactly.
const guards = [
  [/<\/script/i.test(bundle), 'bundle contains "</script"'],
  [/<\/style/i.test(css), 'css contains "</style"'],
  [/data-suite-inline/.test(bundle), 'bundle collides with data-suite-inline marker'],
  // eslint-disable-next-line no-control-regex
  [/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(bundle + css), 'control bytes in build output'],
];
for (const [bad, reason] of guards) {
  if (bad) throw new Error(`export-suite: ${reason}`);
}

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ChromaLink · Local Suite</title>
<link rel="stylesheet" href="../core/suite.css" data-suite-inline>
<style>
  body { padding: 1.4rem 1.25rem 4rem; }
  .wrap { max-width: 1040px; margin: 0 auto; }
  .topbar { display: flex; align-items: center; gap: .8rem; }
  .spacer { flex: 1; }
  .topbar .theme-btn { float: none; }
  header h1 { font-size: clamp(1.75rem, 5vw, 2.5rem); letter-spacing: -.035em; margin-top: 1rem; }
  header .tag { color: var(--muted); margin-top: .35rem; max-width: 54rem; line-height: 1.55; }
  .warning { margin: 1rem 0; padding: .85rem 1rem; border: 1px solid var(--line); border-left: 4px solid #b7791f; border-radius: 10px; background: var(--card); line-height: 1.5; font-size: .92rem; }
  footer { margin-top: 2rem; line-height: 1.55; color: var(--muted); font-size: .84rem; }
${css.trimEnd()}
</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <a class="back" href="index.html">← suite</a>
    <div class="spacer"></div>
    <button class="theme-btn" id="themeBtn" type="button" title="Toggle light/dark">◐ theme</button>
  </div>
  <header>
    <h1>ChromaLink</h1>
    <p class="tag">Move one file between two phones with light: the sender animates 8-color frames on its screen and the receiver decodes them through its camera with RaptorQ fountain coding. Payload bytes never touch a network — there is no upload, relay, pairing server, or account.</p>
  </header>

  <div class="warning" role="note"><strong>Beta:</strong> ChromaLink's protocol passes deterministic synthetic-camera and loopback gates, but two-device over-air speed, range, and reliability are not yet verified on physical phones. Sending works from this file directly; mobile browsers generally require the hosted HTTPS page for camera receive. Anyone whose camera can see the sending screen can receive the file — this is a no-network transport, not encryption.</div>

  <div id="chromalink-app"></div>

  <footer>Local processing only. The camera image, file bytes, and transfer progress never leave this page; camera tracks, the decode worker, and temporary download URLs are released on Stop, Reset, completion, and page exit. SHA-256 verification proves the received bytes match what was sent, not who sent them.</footer>
</div>
<script src="../core/suite.js" data-suite-inline></script>
<script>
"use strict";
Suite.theme.init();
</script>
<script type="module">
${bundle.trimEnd()}
</script>
</body>
</html>
`;

writeFileSync(TARGET, page, 'utf8');
console.log(
  `export-suite: wrote tools/chromalink.html (${Buffer.byteLength(page)} bytes; bundle ${jsMatch[1]}, css ${cssMatch[1]})`,
);
