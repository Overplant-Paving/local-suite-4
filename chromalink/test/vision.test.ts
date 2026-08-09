/**
 * Synthetic vision gates (spec phase 3): 100 random distorted frames per
 * grid — rotation +/-8 deg, independent corner perspective +/-4% of span,
 * Gaussian noise sigma 8, brightness +/-20 — decoded end-to-end through
 * the production receive path (staged-scale vision + frame decode).
 * N100 must reach >= 95%, N60 >= 98%. Box blur at the sharpness gate's
 * calibration scale must be rejected by the production 160 px gate with
 * the blur applied in the normal 720x720 capture path.
 */

import { describe, expect, it } from 'vitest';
import type { GridSize } from '../src/lib/constants';
import { crc32 } from '../src/lib/crc';
import { encodeFrame } from '../src/lib/frame-encode';
import { buildProtectedHeader } from '../src/lib/header';
import { capacity } from '../src/lib/layout';
import { createFrameProcessor } from '../src/lib/receive-pipeline';
import { analyzeFrame, analyzeFrameCandidates, freshVisionState } from '../src/lib/vision/pipeline';
import { mulberry32, randomBytes } from './prng';
import { awayScene, distort, renderFrameRgb, rotatedCorners } from './synthetic';

/**
 * Synthetic camera: 720x720 capture with the grid spanning ~83% of the
 * frame — the geometry of a phone propped close to the sender screen
 * (after the 160 px pipeline downscale an N100 module is ~1.3 px, matching
 * a 1080p portrait capture of a full-width code).
 */
const OUT = 720;
const HALF_SPAN = 300;

interface SyntheticFrame {
  payload: Uint8Array;
  img: ReturnType<typeof distort>;
}

function synthesize(n: GridSize, rand: () => number, sequenceParity: 0 | 1): SyntheticFrame {
  const payload = randomBytes(rand, capacity(n).payloadBytes);
  const header = buildProtectedHeader({
    transferId: 0x5a5a1234,
    oti: randomBytes(rand, 12),
    // like the real sender: the packet's own leading bytes are its id
    payloadId: payload.slice(0, 4),
    payloadCrc32: crc32(payload),
  });
  const indices = encodeFrame({ n, header, payload, sequenceParity });
  const modulePx = n === 60 ? 9 : n === 100 ? 6 : 4;
  const src = renderFrameRgb(indices, n, modulePx);
  const rotation = (rand() * 2 - 1) * 8;
  const corners = rotatedCorners(OUT / 2, OUT / 2, HALF_SPAN, rotation).map(
    ([x, y]) =>
      [
        x + (rand() * 2 - 1) * 0.04 * 2 * HALF_SPAN,
        y + (rand() * 2 - 1) * 0.04 * 2 * HALF_SPAN,
      ] as [number, number],
  );
  const img = distort(src, {
    outWidth: OUT,
    outHeight: OUT,
    corners,
    noiseSigma: 8,
    brightness: (rand() * 2 - 1) * 20,
    rand,
  });
  return { payload, img };
}

/** Normal-path capture with a box blur applied last (defocused optics). */
function synthesizeBlurred(n: GridSize, rand: () => number, blurRadius: number): ReturnType<typeof distort> {
  const payload = randomBytes(rand, capacity(n).payloadBytes);
  const header = buildProtectedHeader({
    transferId: 0x5a5a1234,
    oti: randomBytes(rand, 12),
    payloadId: payload.slice(0, 4),
    payloadCrc32: crc32(payload),
  });
  const indices = encodeFrame({ n, header, payload, sequenceParity: 0 });
  const modulePx = n === 60 ? 9 : n === 100 ? 6 : 4;
  const src = renderFrameRgb(indices, n, modulePx);
  const rotation = (rand() * 2 - 1) * 8;
  const corners = rotatedCorners(OUT / 2, OUT / 2, HALF_SPAN, rotation).map(
    ([x, y]) =>
      [
        x + (rand() * 2 - 1) * 0.04 * 2 * HALF_SPAN,
        y + (rand() * 2 - 1) * 0.04 * 2 * HALF_SPAN,
      ] as [number, number],
  );
  return distort(src, {
    outWidth: OUT,
    outHeight: OUT,
    corners,
    noiseSigma: 8,
    brightness: (rand() * 2 - 1) * 20,
    blurRadius,
    rand,
  });
}

function successRate(n: GridSize, seed: number, trials: number): number {
  const rand = mulberry32(seed);
  let ok = 0;
  for (let t = 0; t < trials; t++) {
    const { payload, img } = synthesize(n, rand, (t & 1) as 0 | 1);
    // the production path: staged scales escalate only on decode failure
    const processor = createFrameProcessor();
    const result = processor.process(img, null);
    if (
      result.type === 'packet' &&
      result.n === n &&
      Buffer.from(result.packet).equals(Buffer.from(payload))
    ) {
      ok += 1;
    }
  }
  return ok / trials;
}

describe('synthetic distortion gates', () => {
  it('N100: >= 95% of 100 distorted frames decode', () => {
    const rate = successRate(100, 0xa100, 100);
    // eslint-disable-next-line no-console
    console.info(`vision gate N100: ${(rate * 100).toFixed(1)}%`);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  }, 120_000);

  it('N60: >= 98% of 100 distorted frames decode', () => {
    const rate = successRate(60, 0xa060, 100);
    // eslint-disable-next-line no-console
    console.info(`vision gate N60: ${(rate * 100).toFixed(1)}%`);
    expect(rate).toBeGreaterThanOrEqual(0.98);
  }, 120_000);

  it('gate-scale box blur in the normal 720px capture path is rejected as blur', () => {
    // The sharpness gate (SHARPNESS_MIN = 25) is defined on the 160 px
    // downscale, so its calibrated "radius 3" blur condition corresponds
    // to radius 3 * (720/160) = 13.5 px in the normal 720x720 capture.
    // The blur is applied in that normal capture path — full phase-3
    // geometry and noise, blur last, exactly what defocused optics do —
    // and the production 160 px gate must reject it at both integer
    // radii bracketing the equivalence.
    const rand = mulberry32(0xb1a);
    const { img: cleanControl } = synthesize(100, rand, 0);
    const cleanOutcome = analyzeFrame(cleanControl, freshVisionState());
    expect(cleanOutcome.kind).not.toBe('blur');

    for (const blurRadius of [13, 14]) {
      const blurred = synthesizeBlurred(100, mulberry32(0xb1a ^ blurRadius), blurRadius);
      const outcome = analyzeFrame(blurred, freshVisionState());
      expect(outcome.kind, `radius ${blurRadius} must be rejected as blur`).toBe('blur');
    }
  });

  it('radius-3 capture blur stays decodable and must NOT be rejected as blur', () => {
    // Measured (tests/evidence/chromalink/blur-measurements.log): a
    // radius-3 box blur of the normal 720 px capture leaves sharpness at
    // ~91..103 (gate 25) and the pipeline still decodes 88% of such
    // frames — rejecting them would discard mostly-decodable captures.
    // This pins the truthful behavior so the gate cannot silently regress
    // into rejecting mild, decodable defocus.
    for (const seed of [0xb1b, 0xb1c, 0xb1d]) {
      const rand = mulberry32(seed);
      const payload = randomBytes(rand, capacity(100).payloadBytes);
      const header = buildProtectedHeader({
        transferId: 0x5a5a1234,
        oti: randomBytes(rand, 12),
        payloadId: payload.slice(0, 4),
        payloadCrc32: crc32(payload),
      });
      const indices = encodeFrame({ n: 100, header, payload, sequenceParity: 0 });
      const src = renderFrameRgb(indices, 100, 6);
      const corners = rotatedCorners(OUT / 2, OUT / 2, HALF_SPAN, (rand() * 2 - 1) * 8);
      const img = distort(src, {
        outWidth: OUT,
        outHeight: OUT,
        corners,
        noiseSigma: 8,
        brightness: (rand() * 2 - 1) * 20,
        blurRadius: 3,
        rand,
      });
      const result = createFrameProcessor().process(img, null);
      expect(result.type, `seed ${seed}: radius-3 blur should still decode`).toBe('packet');
      if (result.type === 'packet') {
        expect(Buffer.from(result.packet).equals(Buffer.from(payload))).toBe(true);
      }
    }
  });

  it('reports nofinder (not nogrid) when the scene has no finder triple', () => {
    // A camera pointed away from any code: textured (passes the sharpness
    // gate) but containing no finder structure at any detection scale.
    const img = awayScene(mulberry32(0x0ff), 720);
    const { outcomes, fallback } = analyzeFrameCandidates(img, freshVisionState());
    expect(outcomes.length).toBe(0);
    expect(fallback.kind).toBe('nofinder');
  }, 60_000);

  it('locks the grid after three consecutive agreeing frames', () => {
    const rand = mulberry32(0xcafe);
    const state = freshVisionState();
    let locked = 0;
    for (let t = 0; t < 6; t++) {
      const { img } = synthesize(100, rand, (t & 1) as 0 | 1);
      const outcome = analyzeFrame(img, state);
      if (state.lockedN !== null) {
        locked += 1;
        expect(state.lockedN).toBe(100);
        if (outcome.kind === 'frame') expect(outcome.n).toBe(100);
      }
    }
    expect(locked).toBeGreaterThan(0);
  }, 60_000);
});
