/**
 * Full-frame vision pipeline on plain buffers (steps 1..8 of the receive
 * path): downscale + sharpness gate, adaptive threshold, finder triples,
 * per-grid beacon search + homography + calibration trial, N locking, and
 * module classification. Frame decoding is the caller's next step.
 *
 * Candidate triples are tried best-first: a false cluster can complete a
 * geometrically perfect triangle, so calibration validity (which random
 * data cannot fake) arbitrates between them.
 */

import { GRID_SIZES, SHARPNESS_MIN, type GridSize } from '../constants';
import {
  beaconBodyBounds,
  beaconCenter,
  calibrationPatchSpan,
  finderCenters,
  finderModuleIsBlack,
  finderOrigins,
} from '../layout';
import { BLACK_INDEX, WHITE_INDEX } from '../palette';
import { DOWNSCALE_WIDTH, grayscaleDownscale, laplacianVariance, upscaleCoord, type RgbaImage } from './image';
import { adaptiveThreshold } from './threshold';
import {
  clusterCandidates,
  findFinderCandidates,
  locateBeacon,
  locateGridCorner,
  refineClusterCenter,
  scoreFinderCluster,
  selectFinderTriples,
  type FinderTriple,
} from './finder';
import { applyHomography, homographyFromPoints, invertHomography, type Homography, type Point } from './homography';
import {
  calibrationLooksValid,
  calibrationScore,
  classifyModules,
  measureCalibration,
  type Calibration,
} from './classify';
import { darknessCentroid, sampleModuleRgb } from './sampler';
import type { GrayImage } from './image';

export interface VisionTuning {
  /** Half-width of the module sample grid in module units (0.25 = central 50%). */
  sampleHalf: number;
  /** Adaptive threshold bias. */
  thresholdBias: number;
  /** Finder run tolerance, percent. */
  finderTolerance: number;
}

export const DEFAULT_TUNING: VisionTuning = {
  sampleHalf: 0.2,
  thresholdBias: -10,
  finderTolerance: 55,
};

/** Caller-owned grid lock state (3 consecutive agreements lock N). */
export interface VisionState {
  lockedN: GridSize | null;
  candidateN: GridSize | null;
  agreementStreak: number;
}

export function freshVisionState(): VisionState {
  return { lockedN: null, candidateN: null, agreementStreak: 0 };
}

export type VisionOutcome =
  | { kind: 'blur'; sharpness: number }
  | { kind: 'nofinder' }
  | { kind: 'washout' }
  | { kind: 'nogrid' }
  | {
      kind: 'frame';
      n: GridSize;
      indices: Uint8Array;
      /** Full-resolution camera pixels per module. */
      pitchPx: number;
      calibration: Calibration;
      sharpness: number;
      /** Module-space -> full-resolution mapping used for sampling. */
      homography: Homography;
      /** Per-module classification confidence (winner-vs-runner-up gap). */
      margins: Float32Array;
    };

export interface TripleTrial {
  n: GridSize;
  h: Homography;
  cal: Calibration;
  score: number;
  /** Known-structure template mismatch fraction; lower is better. */
  mismatch: number;
  src: Point[];
  dst: Point[];
  sawWashout: boolean;
}

interface TemplateSample {
  col: number;
  row: number;
  /** expected palette index, or -1 for the parity-unknown beacon body */
  expected: number;
  weight: number;
}

/**
 * Known reserved-structure modules used for template alignment scoring.
 * Calibration samples carry heavy weight: a misassigned triple can leave
 * finder blocks and a dark "beacon" in template-consistent places (there
 * is a dark block at every corner), but only the true orientation puts
 * the eight-color strip on the bottom rows.
 */
function templateSamples(n: GridSize): TemplateSample[] {
  const samples: TemplateSample[] = [];
  for (const [oc, or] of finderOrigins(n)) {
    for (let dr = 0; dr < 7; dr++) {
      for (let dc = 0; dc < 7; dc++) {
        samples.push({
          col: oc + dc,
          row: or + dr,
          expected: finderModuleIsBlack(dc, dr) ? BLACK_INDEX : WHITE_INDEX,
          weight: 1,
        });
      }
    }
  }
  const bb = beaconBodyBounds(n);
  for (let row = bb.min + 1; row <= bb.max - 1; row += 2) {
    for (let col = bb.min + 1; col <= bb.max - 1; col += 2) {
      samples.push({ col, row, expected: -1, weight: 1 });
    }
  }
  // The separator "L" is the only 1-module-wide known structure near the
  // BR corner: patches forgive +/-2 modules and the beacon interior is
  // uniform, so without it a fit can ramp to a 3-module BR error and
  // still read template-clean.
  for (let col = n - 7; col <= n - 1; col += 2) {
    samples.push({ col, row: n - 7, expected: WHITE_INDEX, weight: 2 });
  }
  for (let row = n - 6; row <= n - 1; row += 2) {
    samples.push({ col: n - 7, row, expected: WHITE_INDEX, weight: 2 });
  }
  for (let patch = 0; patch < 8; patch++) {
    const span = calibrationPatchSpan(n, patch);
    const col = Math.floor((span.colStart + span.colEnd) / 2);
    samples.push({ col, row: n - 2, expected: patch, weight: 5 });
    samples.push({ col, row: n - 1, expected: patch, weight: 5 });
  }
  return samples;
}

function classifySample(
  img: RgbaImage,
  h: Homography,
  col: number,
  row: number,
  cal: Calibration,
  rgb: Float32Array,
): number {
  sampleModuleRgb(img, h, col, row, 0.15, rgb, 0);
  const r = rgb[0] as number;
  const g = rgb[1] as number;
  const b = rgb[2] as number;
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let p = 0; p < 8; p++) {
    const dr = r - (cal[p * 3] as number);
    const dg = g - (cal[p * 3 + 1] as number);
    const db = b - (cal[p * 3 + 2] as number);
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = p;
    }
  }
  return bestIdx;
}

/** Fraction of known template modules that classify wrongly under h. */
function templateMismatch(
  img: RgbaImage,
  h: Homography,
  cal: Calibration,
  samples: readonly TemplateSample[],
): number {
  const rgb = new Float32Array(3);
  let wrong = 0;
  let total = 0;
  let beaconBlack = 0;
  let beaconWhite = 0;
  let beaconTotal = 0;
  for (const s of samples) {
    const got = classifySample(img, h, s.col, s.row, cal, rgb);
    if (s.expected === -1) {
      beaconTotal += s.weight;
      if (got === BLACK_INDEX) beaconBlack += s.weight;
      else if (got === WHITE_INDEX) beaconWhite += s.weight;
      continue;
    }
    total += s.weight;
    if (got !== s.expected) wrong += s.weight;
  }
  if (beaconTotal > 0) {
    // beacon parity is unknown: count against the better hypothesis
    total += beaconTotal;
    wrong += beaconTotal - Math.max(beaconBlack, beaconWhite);
  }
  return total > 0 ? wrong / total : 1;
}

/**
 * Calibration-free alignment score: mean luma of known-white template
 * modules minus known-black ones (finders + separator). Usable before any
 * calibration exists — a misplaced grid mixes both groups toward the same
 * mean and the separation collapses.
 */
function lumaTemplateSeparation(img: RgbaImage, h: Homography, n: GridSize): number {
  const pt: Point = { x: 0, y: 0 };
  let dark = 0;
  let darkCount = 0;
  let light = 0;
  let lightCount = 0;
  for (const [oc, or] of finderOrigins(n)) {
    for (let dr = 0; dr < 7; dr += 2) {
      for (let dc = 0; dc < 7; dc += 2) {
        applyHomography(h, oc + dc + 0.5, or + dr + 0.5, pt);
        const value = lumaAt(img, pt.x, pt.y);
        if (finderModuleIsBlack(dc, dr)) {
          dark += value;
          darkCount += 1;
        } else {
          light += value;
          lightCount += 1;
        }
      }
    }
  }
  for (let col = n - 7; col <= n - 1; col += 2) {
    applyHomography(h, col + 0.5, n - 7 + 0.5, pt);
    light += lumaAt(img, pt.x, pt.y);
    lightCount += 1;
  }
  if (darkCount === 0 || lightCount === 0) return 0;
  return light / lightCount - dark / darkCount;
}

/** Compose h with a module-space translation: h'(u, v) = h(u + du, v + dv). */
function shiftHomography(h: Homography, du: number, dv: number): Homography {
  const out = new Float64Array(9);
  // columns transform: c2' = c0*du + c1*dv + c2
  out[0] = h[0] as number;
  out[1] = h[1] as number;
  out[2] = (h[0] as number) * du + (h[1] as number) * dv + (h[2] as number);
  out[3] = h[3] as number;
  out[4] = h[4] as number;
  out[5] = (h[3] as number) * du + (h[4] as number) * dv + (h[5] as number);
  out[6] = h[6] as number;
  out[7] = h[7] as number;
  out[8] = (h[6] as number) * du + (h[7] as number) * dv + (h[8] as number);
  return out;
}

function lumaAt(img: RgbaImage, x: number, y: number): number {
  const cx = Math.min(Math.max(x, 0), img.width - 1);
  const cy = Math.min(Math.max(y, 0), img.height - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, img.width - 1);
  const y1 = Math.min(y0 + 1, img.height - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const lum = (p: number): number =>
    ((img.pixels[p] as number) * 77 + (img.pixels[p + 1] as number) * 150 + (img.pixels[p + 2] as number) * 29) /
    256;
  const p00 = lum((y0 * img.width + x0) * 4);
  const p10 = lum((y0 * img.width + x1) * 4);
  const p01 = lum((y1 * img.width + x0) * 4);
  const p11 = lum((y1 * img.width + x1) * 4);
  return p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
}

/**
 * Full-resolution grid-corner refinement. Downscale edge tracing is only
 * good to a pixel there (4-5 capture pixels), and that residual bends the
 * least-squares fit through the middle of the data field. Walk each
 * boundary at capture resolution through the current homography, find the
 * sub-pixel quiet-to-data luminance crossing per probe line, robust-fit
 * both boundary lines, and intersect them.
 */
interface EdgeLine {
  px: number;
  py: number;
  dx: number;
  dy: number;
}

interface CornerRefinement {
  corner: readonly [number, number];
  right: EdgeLine;
  bottom: EdgeLine;
}

function refineCornerFullRes(
  img: RgbaImage,
  h: Homography,
  n: GridSize,
): CornerRefinement | null {
  const pt: Point = { x: 0, y: 0 };
  const crossingsFor = (
    edge: 'right' | 'bottom',
  ): Array<readonly [number, number]> => {
    const points: Array<readonly [number, number]> = [];
    for (let t = 0.12; t <= 0.88; t += 0.08) {
      const rMod = t * n;
      // probe along the outward module-space normal of this edge
      const samples: Array<{ x: number; y: number; luma: number }> = [];
      for (let delta = 1.4; delta >= -1.6; delta -= 0.2) {
        const u = edge === 'right' ? n + delta : rMod;
        const v = edge === 'right' ? rMod : n + delta;
        applyHomography(h, u, v, pt);
        samples.push({ x: pt.x, y: pt.y, luma: lumaAt(img, pt.x, pt.y) });
      }
      // quiet reference from the outermost probes
      const quiet = Math.max(samples[0]?.luma ?? 0, samples[1]?.luma ?? 0);
      if (quiet < 140) continue;
      const threshold = quiet - 40;
      for (let i = 1; i < samples.length; i++) {
        const prev = samples[i - 1] as { x: number; y: number; luma: number };
        const cur = samples[i] as { x: number; y: number; luma: number };
        if (prev.luma >= threshold && cur.luma < threshold) {
          const f = (prev.luma - threshold) / Math.max(1e-6, prev.luma - cur.luma);
          points.push([prev.x + (cur.x - prev.x) * f, prev.y + (cur.y - prev.y) * f]);
          break;
        }
      }
    }
    return points;
  };

  const fitEdge = (points: Array<readonly [number, number]>): { px: number; py: number; dx: number; dy: number } | null => {
    if (points.length < 5) return null;
    const fit = (pts: Array<readonly [number, number]>): { px: number; py: number; dx: number; dy: number } => {
      let mx = 0;
      let my = 0;
      for (const [x, y] of pts) {
        mx += x;
        my += y;
      }
      mx /= pts.length;
      my /= pts.length;
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      for (const [x, y] of pts) {
        sxx += (x - mx) * (x - mx);
        sxy += (x - mx) * (y - my);
        syy += (y - my) * (y - my);
      }
      const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      return { px: mx, py: my, dx: Math.cos(angle), dy: Math.sin(angle) };
    };
    let line = fit(points);
    const residual = (x: number, y: number): number =>
      Math.abs(-line.dy * (x - line.px) + line.dx * (y - line.py));
    const kept = points.filter(([x, y]) => residual(x, y) <= 2.5);
    if (kept.length >= 5 && kept.length < points.length) line = fit(kept);
    return line;
  };

  const right = fitEdge(crossingsFor('right'));
  const bottom = fitEdge(crossingsFor('bottom'));
  if (right === null || bottom === null) return null;
  const det = right.dx * bottom.dy - right.dy * bottom.dx;
  if (Math.abs(det) < 1e-9) return null;
  const t =
    ((bottom.px - right.px) * bottom.dy - (bottom.py - right.py) * bottom.dx) / det;
  const cx = right.px + right.dx * t;
  const cy = right.py + right.dy * t;
  // sanity: the refined corner must stay near the prediction
  applyHomography(h, n, n, pt);
  const pitchGuess = Math.abs((h[0] as number)) + Math.abs((h[4] as number));
  if (Math.hypot(cx - pt.x, cy - pt.y) > Math.max(12, 3 * pitchGuess)) return null;
  return { corner: [cx, cy], right, bottom };
}

/**
 * Point-on-boundary anchors: sample each fitted full-resolution edge line
 * and pair the samples with module space through the current homography
 * (the free coordinate comes from H, the constrained one is exactly n).
 * These pin the whole right and bottom boundary, not just their corner —
 * the dominant residual failure was smooth drift across the bottom band.
 */
function edgeLineAnchors(
  refinement: CornerRefinement,
  h: Homography,
  n: GridSize,
): { src: Point[]; dst: Point[] } | null {
  const inv = invertHomography(h);
  if (inv === null) return null;
  const src: Point[] = [];
  const dst: Point[] = [];
  const pt: Point = { x: 0, y: 0 };
  for (const [line, edge] of [
    [refinement.right, 'right'],
    [refinement.bottom, 'bottom'],
  ] as const) {
    for (const offset of [-0.35, 0, 0.35]) {
      // walk along the fitted image-space line around its sampled span
      const span = 0.8 * n; // roughly the traced extent in modules
      const px = line.px + line.dx * offset * span;
      const py = line.py + line.dy * offset * span;
      applyHomography(inv, px, py, pt);
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
      if (edge === 'right') {
        if (pt.y < 4 || pt.y > n + 2) continue;
        src.push({ x: n, y: pt.y });
      } else {
        if (pt.x < 4 || pt.x > n + 2) continue;
        src.push({ x: pt.x, y: n });
      }
      dst.push({ x: px, y: py });
    }
  }
  return src.length >= 4 ? { src, dst } : null;
}

/**
 * Locate the separator's outer corner near module (n-7, n-7): grid-search
 * sub-module offsets maximizing "white toward the beacon quadrant, data
 * everywhere else". Returns the image-space point or null when the
 * separation is unconvincing.
 */
function locateSeparatorCorner(img: RgbaImage, h: Homography, n: GridSize): Point | null {
  const origin: Point = { x: 0, y: 0 };
  const stepU: Point = { x: 0, y: 0 };
  const stepV: Point = { x: 0, y: 0 };
  applyHomography(h, n - 7, n - 7, origin);
  applyHomography(h, n - 6, n - 7, stepU);
  applyHomography(h, n - 7, n - 6, stepV);
  const uxX = stepU.x - origin.x;
  const uxY = stepU.y - origin.y;
  const uyX = stepV.x - origin.x;
  const uyY = stepV.y - origin.y;

  const quadrantScore = (cx: number, cy: number): number => {
    let lightSum = 0;
    let lightCount = 0;
    let otherSum = 0;
    let otherCount = 0;
    for (const a of [0.25, 0.5, 0.75]) {
      for (const b of [0.25, 0.5, 0.75]) {
        for (const [su, sv] of [
          [a, b],
          [-a, b],
          [a, -b],
          [-a, -b],
        ] as const) {
          const x = cx + uxX * su + uyX * sv;
          const y = cy + uxY * su + uyY * sv;
          const luma = lumaAt(img, x, y);
          if (su > 0 && sv > 0) {
            lightSum += luma;
            lightCount += 1;
          } else {
            otherSum += luma;
            otherCount += 1;
          }
        }
      }
    }
    return lightSum / lightCount - otherSum / otherCount;
  };

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestX = origin.x;
  let bestY = origin.y;
  for (let dv = -1.5; dv <= 1.5; dv += 0.25) {
    for (let du = -1.5; du <= 1.5; du += 0.25) {
      const cx = origin.x + uxX * du + uyX * dv;
      const cy = origin.y + uxY * du + uyY * dv;
      const score = quadrantScore(cx, cy);
      if (score > bestScore) {
        bestScore = score;
        bestX = cx;
        bestY = cy;
      }
    }
  }
  if (bestScore < 60) return null;
  return { x: bestX, y: bestY };
}

const ALIGN_ACCEPT = 0.06;
const ALIGN_REJECT = 0.08;

/**
 * Template alignment: measure the known-structure mismatch under h and, if
 * poor, try small module-space shifts to re-seat the sampling grid. Frames
 * whose best mismatch stays above ALIGN_REJECT are rejected outright —
 * decoding garbage is slower than skipping a frame.
 */
function alignToTemplate(
  img: RgbaImage,
  h: Homography,
  n: GridSize,
  cal: Calibration,
): { h: Homography; mismatch: number } | null {
  const samples = templateSamples(n);
  let bestH = h;
  let best = templateMismatch(img, h, cal, samples);
  if (best > ALIGN_ACCEPT) {
    const steps = [-1, -0.5, -0.25, 0.25, 0.5, 1];
    for (const du of steps) {
      for (const dv of steps) {
        const candidate = shiftHomography(h, du, dv);
        const mismatch = templateMismatch(img, candidate, cal, samples);
        if (mismatch < best) {
          best = mismatch;
          bestH = candidate;
        }
      }
    }
  }
  if (best > ALIGN_REJECT) return null;
  return { h: bestH, mismatch: best };
}

function tryTriple(
  img: RgbaImage,
  gray: GrayImage,
  triple: FinderTriple,
  candidates: readonly GridSize[],
  up: (p: { x: number; y: number }) => Point,
  debug?: (message: string) => void,
): { best: TripleTrial | null; sawWashout: boolean } {
  let sawWashout = false;
  let best: TripleTrial | null = null;

  // The outer BR grid corner (intersection of the fitted right and bottom
  // boundary lines) is grid-size independent and perspective-exact; it
  // anchors the beacon search and backs it up when the search is unsure.
  const corner = locateGridCorner(gray, triple);

  for (const n of candidates) {
    const centers = finderCenters(n);
    const bc = beaconCenter(n);
    const finderSrc: Point[] = centers.map((c) => ({ x: c[0], y: c[1] }));
    const finderDst: Point[] = [
      { x: triple.tl.x, y: triple.tl.y },
      { x: triple.tr.x, y: triple.tr.y },
      { x: triple.bl.x, y: triple.bl.y },
    ];

    let beaconEstimate: readonly [number, number] | undefined;
    if (corner !== null) {
      const hDown = homographyFromPoints(
        [...finderSrc, { x: n, y: n }],
        [...finderDst, { x: corner[0], y: corner[1] }],
      );
      if (hDown !== null) {
        const p: Point = { x: 0, y: 0 };
        applyHomography(hDown, bc[0], bc[1], p);
        beaconEstimate = [p.x, p.y];
      }
    }
    const beacon = locateBeacon(gray, triple, n, beaconEstimate);

    // Anchor set: three finders plus the confident beacon and/or the traced
    // corner; five points make a least-squares fit that spreads detection
    // error instead of forcing it all into the far corner.
    const srcPts: Point[] = [...finderSrc];
    const dstPts: Point[] = [up(triple.tl), up(triple.tr), up(triple.bl)];
    const beaconAnchorable = beacon.fromSearch;
    if (beaconAnchorable) {
      srcPts.push({ x: bc[0], y: bc[1] });
      dstPts.push(up({ x: beacon.x, y: beacon.y }));
    }
    if (corner !== null) {
      srcPts.push({ x: n, y: n });
      dstPts.push(up({ x: corner[0], y: corner[1] }));
    }
    if (srcPts.length < 4) {
      // no confident fourth anchor at all: fall back to the parallelogram
      srcPts.push({ x: bc[0], y: bc[1] });
      dstPts.push(up({ x: beacon.x, y: beacon.y }));
    }
    let h = homographyFromPoints(srcPts, dstPts);
    if (h === null) continue;

    // Full-resolution anchor polish: predict each finder center through the
    // downscale-fitted homography, snap it onto the dark core with a
    // darkness-weighted centroid at capture resolution, and refit.
    // Graduated radii: a wide disc can reach the dark border ring when the
    // prediction starts a module off, and the ring then biases the
    // centroid outward; starting narrow converges onto the core first.
    const tlUp = up(triple.tl);
    const trUp = up(triple.tr);
    const pitch = Math.hypot(trUp.x - tlUp.x, trUp.y - tlUp.y) / (n - 7);
    const weights = dstPts.map((_, i) => (i < 3 ? 1 : 0.3));
    const polishedDst = dstPts.map((p) => ({ x: p.x, y: p.y }));
    for (const radiusFactor of [0.9, 1.3, 1.6]) {
      for (let i = 0; i < 3; i++) {
        const predicted: Point = { x: 0, y: 0 };
        applyHomography(h, (srcPts[i] as Point).x, (srcPts[i] as Point).y, predicted);
        polishedDst[i] = darknessCentroid(img, predicted.x, predicted.y, radiusFactor * pitch);
      }
      const polished = homographyFromPoints(srcPts, polishedDst, weights);
      if (polished === null) break;
      h = polished;
    }

    const refinement = refineCornerFullRes(img, h, n);
    const refinedCorner = refinement !== null ? refinement.corner : null;
    debug?.(`  n=${n} corner=${corner ? 'down' : 'null'} refined=${refinedCorner ? 'yes' : 'NO'} beaconSearch=${beacon.fromSearch}`);

    // Anchor pool at full resolution: three polished finders, the traced
    // corner (full weight when refined at capture resolution), and the
    // beacon (weak — it never left the downscale). A single bad anchor is
    // the dominant residual failure, so try leave-one-out subsets and let
    // the known-structure template mismatch pick the fit that actually
    // lands on the grid.
    interface Anchor {
      src: Point;
      dst: Point;
      weight: number;
      kind: 'finder' | 'corner' | 'beacon';
    }
    const anchors: Anchor[] = [
      { src: srcPts[0] as Point, dst: polishedDst[0] as Point, weight: 1, kind: 'finder' },
      { src: srcPts[1] as Point, dst: polishedDst[1] as Point, weight: 1, kind: 'finder' },
      { src: srcPts[2] as Point, dst: polishedDst[2] as Point, weight: 1, kind: 'finder' },
    ];
    if (refinedCorner !== null) {
      anchors.push({
        src: { x: n, y: n },
        dst: { x: refinedCorner[0], y: refinedCorner[1] },
        weight: 1,
        kind: 'corner',
      });
    } else if (corner !== null) {
      anchors.push({
        src: { x: n, y: n },
        dst: up({ x: corner[0], y: corner[1] }),
        weight: 0.4,
        kind: 'corner',
      });
    }
    if (beaconAnchorable) {
      anchors.push({
        src: { x: bc[0], y: bc[1] },
        dst: up({ x: beacon.x, y: beacon.y }),
        weight: 0.3,
        kind: 'beacon',
      });
    }
    // Parity-independent BR-interior anchor: the separator's outer corner
    // at module (n-7, n-7). Its beacon-side quadrant is white for either
    // parity (it IS the separator) while the data field covers the other
    // sides — the stabilizing interior point an invisible white beacon
    // cannot provide.
    const sepCorner = locateSeparatorCorner(img, h, n);
    if (sepCorner !== null) {
      anchors.push({ src: { x: n - 7, y: n - 7 }, dst: sepCorner, weight: 0.3, kind: 'beacon' });
    }
    if (anchors.length < 4) {
      anchors.push({
        src: { x: bc[0], y: bc[1] },
        dst: up({ x: beacon.x, y: beacon.y }),
        weight: 0.3,
        kind: 'beacon',
      });
    }

    const subsets: Anchor[][] = [anchors];
    for (let drop = 0; drop < anchors.length; drop++) {
      if (anchors.length - 1 >= 4) {
        subsets.push(anchors.filter((_, i) => i !== drop));
      }
    }

    const samples = templateSamples(n);
    let bestFit: { h: Homography; cal: Calibration; mismatch: number } | null = null;
    let sawAnyCal = false;
    for (const subset of subsets) {
      let fit = homographyFromPoints(
        subset.map((a) => a.src),
        subset.map((a) => a.dst),
        subset.map((a) => a.weight),
      );
      if (fit === null) continue;
      if (refinement !== null) {
        // pin the traced right/bottom boundaries, not just their corner
        const extra = edgeLineAnchors(refinement, fit, n);
        if (extra !== null) {
          const srcAll = [...subset.map((a) => a.src), ...extra.src];
          const dstAll = [...subset.map((a) => a.dst), ...extra.dst];
          const weightsAll = [
            ...subset.map((a) => a.weight),
            ...extra.src.map(() => 0.5),
          ];
          const refit = homographyFromPoints(srcAll, dstAll, weightsAll);
          if (refit !== null) fit = refit;
        }
      }
      let usedFit = fit;
      let cal = measureCalibration(img, usedFit, n);
      if (cal === null || !calibrationLooksValid(cal)) {
        // residual drift at the strip: retry with small vertical shifts
        for (const dv of [-0.5, -0.25, 0.25, 0.5]) {
          const shifted = shiftHomography(fit, 0, dv);
          const retry = measureCalibration(img, shifted, n);
          if (retry !== null && calibrationLooksValid(retry)) {
            usedFit = shifted;
            cal = retry;
            break;
          }
        }
      }
      if (cal === null) continue;
      if (!calibrationLooksValid(cal)) continue;
      fit = usedFit;
      sawAnyCal = true;
      const mismatch = templateMismatch(img, fit, cal, samples);
      if (bestFit === null || mismatch < bestFit.mismatch) {
        bestFit = { h: fit, cal, mismatch };
      }
      if (mismatch <= ALIGN_ACCEPT) break; // good enough — stop early
    }
    const f0 = polishedDst[0] as Point;
    const f1 = polishedDst[1] as Point;
    const f2 = polishedDst[2] as Point;
    const cornerFitAt = (cx: number, cy: number): Homography | null =>
      homographyFromPoints(
        [srcPts[0] as Point, srcPts[1] as Point, srcPts[2] as Point, { x: n, y: n }],
        [f0, f1, f2, { x: cx, y: cy }],
      );

    if (bestFit === null) {
      // Every anchored fit washed out; the usual cause is a BR-region
      // anchor bad enough that no calibration sample lands on the strip.
      // Sweep a virtual BR corner scored on the calibration-free luma
      // template (finders and separator are known black/white), then
      // re-attempt calibration at the winner.
      const predicted: Point = { x: 0, y: 0 };
      if (h !== null) applyHomography(h, n, n, predicted);
      let lumaBest = Number.NEGATIVE_INFINITY;
      let lumaFit: Homography | null = null;
      for (let dv = -8; dv <= 8; dv += 2) {
        for (let du = -8; du <= 8; du += 2) {
          const fit = cornerFitAt(predicted.x + du * 0.75 * pitch, predicted.y + dv * 0.75 * pitch);
          if (fit === null) continue;
          const separation = lumaTemplateSeparation(img, fit, n);
          if (separation > lumaBest) {
            lumaBest = separation;
            lumaFit = fit;
          }
        }
      }
      if (lumaFit !== null && lumaBest > 70) {
        const recal = measureCalibration(img, lumaFit, n);
        if (recal !== null && calibrationLooksValid(recal)) {
          bestFit = { h: lumaFit, cal: recal, mismatch: templateMismatch(img, lumaFit, recal, samples) };
        }
      }
      if (bestFit === null) {
        debug?.(`  n=${n} ${sawAnyCal ? 'CAL-INVALID' : 'WASHOUT'}`);
        sawWashout = true;
        continue;
      }
    }
    let working: { h: Homography; cal: Calibration; mismatch: number } = bestFit;

    // BR-anchor sweep: when the residual stays high, the usual cause is a
    // fit that is clean at the three finders but ramps toward BR (both BR
    // anchors failed). Re-fit with a virtual corner swept over a widening
    // grid, keep the position the template likes best, and iterate once so
    // the recalibrated strip can sharpen the second pass.
    for (let round = 0; round < 2 && working.mismatch > ALIGN_ACCEPT; round++) {
      const predicted: Point = { x: 0, y: 0 };
      applyHomography(working.h, n, n, predicted);
      const stepPx = (round === 0 ? 0.75 : 0.3) * pitch;
      const reach = round === 0 ? 6 : 3;
      let sweepBest = working;
      for (let dv = -reach; dv <= reach; dv++) {
        for (let du = -reach; du <= reach; du++) {
          if (du === 0 && dv === 0) continue;
          const fit = cornerFitAt(predicted.x + du * stepPx, predicted.y + dv * stepPx);
          if (fit === null) continue;
          const mismatch = templateMismatch(img, fit, working.cal, samples);
          if (mismatch < sweepBest.mismatch) {
            sweepBest = { h: fit, cal: working.cal, mismatch };
          }
        }
      }
      if (sweepBest === working) break;
      const recal = measureCalibration(img, sweepBest.h, n);
      if (recal !== null && calibrationLooksValid(recal)) {
        sweepBest = { h: sweepBest.h, cal: recal, mismatch: templateMismatch(img, sweepBest.h, recal, samples) };
      }
      if (sweepBest.mismatch < working.mismatch) working = sweepBest;
      else break;
    }

    const aligned = alignToTemplate(img, working.h, n, working.cal);
    if (aligned === null) {
      debug?.(`  n=${n} ALIGN-REJECT best=${working.mismatch.toFixed(3)}`);
      continue;
    }
    debug?.(`  n=${n} ok mismatch=${aligned.mismatch.toFixed(3)}`);
    // re-measure calibration when alignment moved the grid
    let finalCal = working.cal;
    if (aligned.h !== working.h) {
      const recal = measureCalibration(img, aligned.h, n);
      if (recal !== null && calibrationLooksValid(recal)) finalCal = recal;
    }

    const score = calibrationScore(finalCal);
    if (best === null || aligned.mismatch < best.mismatch ||
        (aligned.mismatch === best.mismatch && score > best.score)) {
      best = {
        n,
        h: aligned.h,
        cal: finalCal,
        score,
        mismatch: aligned.mismatch,
        src: srcPts,
        dst: dstPts,
        sawWashout,
      };
    }
  }
  return { best, sawWashout };
}

function detectAndTrial(
  img: RgbaImage,
  state: VisionState,
  tuning: VisionTuning,
  downscaleWidth: number,
  precomputedGray?: GrayImage,
  debug?: (message: string) => void,
): ScaleTrials {
  const gray =
    precomputedGray !== undefined && precomputedGray.width === downscaleWidth
      ? precomputedGray
      : grayscaleDownscale(img, downscaleWidth);
  const bin = adaptiveThreshold(gray, tuning.thresholdBias);
  const clusters = clusterCandidates(findFinderCandidates(bin, tuning.finderTolerance));
  const verified: typeof clusters = [];
  const weak: typeof clusters = [];
  for (const cluster of clusters) {
    // snap onto the dark core first — run-average centers sit ~1 px off,
    // which is enough to fail the structural check at 1.3 px modules
    refineClusterCenter(bin, cluster);
    let score = scoreFinderCluster(bin, cluster);
    if (score === null) {
      // aliasing rescue: a one-pixel nudge often restores a real finder
      const baseX = cluster.x;
      const baseY = cluster.y;
      for (let dy = -1; dy <= 1 && score === null; dy++) {
        for (let dx = -1; dx <= 1 && score === null; dx++) {
          if (dx === 0 && dy === 0) continue;
          cluster.x = baseX + dx;
          cluster.y = baseY + dy;
          score = scoreFinderCluster(bin, cluster);
        }
      }
      if (score === null) {
        cluster.x = baseX;
        cluster.y = baseY;
      }
    }
    if (score !== null) {
      cluster.score = score;
      verified.push(cluster);
    } else {
      weak.push(cluster);
    }
  }
  const triples = selectFinderTriples(verified, weak, bin);
  if (triples.length === 0) return { trials: [], sawTriple: false, sawWashout: false };

  const up = (p: { x: number; y: number }): Point => ({
    x: upscaleCoord(p.x, img.width, gray.width),
    y: upscaleCoord(p.y, img.height, gray.height),
  });

  let sawWashout = false;
  const trials: TripleTrial[] = [];
  for (const triple of triples) {
    // The finder spans exactly 7 modules, so measured core module size plus
    // the finder-center leg length give a direct grid-size estimate — the
    // calibration strip alone cannot separate grids (its fractional layout
    // is nearly scale-invariant).
    const legPx =
      (Math.hypot(triple.tr.x - triple.tl.x, triple.tr.y - triple.tl.y) +
        Math.hypot(triple.bl.x - triple.tl.x, triple.bl.y - triple.tl.y)) /
      2;
    const meanModule = (triple.tl.moduleSize + triple.tr.moduleSize + triple.bl.moduleSize) / 3;
    const nEstimate = legPx / meanModule + 7;
    let candidates: readonly GridSize[] = state.lockedN !== null ? [state.lockedN] : GRID_SIZES;
    if (state.lockedN === null) {
      const plausible = candidates.filter((g) => {
        const ratio = nEstimate / g;
        return ratio >= 0.72 && ratio <= 1.38;
      });
      if (plausible.length > 0) candidates = plausible;
    }
    debug?.(`w${downscaleWidth} triple TL(${triple.tl.x.toFixed(1)},${triple.tl.y.toFixed(1)}) TR(${triple.tr.x.toFixed(1)},${triple.tr.y.toFixed(1)}) BL(${triple.bl.x.toFixed(1)},${triple.bl.y.toFixed(1)}) nEst=${nEstimate.toFixed(1)} candidates=${candidates.join(',')}`);
    const { best, sawWashout: tripleWashout } = tryTriple(img, gray, triple, candidates, up, debug);
    sawWashout = sawWashout || tripleWashout;
    if (best !== null) {
      trials.push(best);
      // A perfectly clean interpretation ends the hunt; anything less keeps
      // later-ranked triples in play — a false triple can pass the template
      // while the true one sits behind it, and only decoding can tell.
      if (best.mismatch === 0 && trials.length >= 2) break;
    }
  }
  return { trials, sawTriple: true, sawWashout };
}

/**
 * Detection scales, cheapest first. At 160 px an N100/N140 module is
 * ~1.3 px and marginal frames lose a finder to aliasing; the 240/320 px
 * passes cost ~2.3x/4x the fast pass and are true fallbacks — they run
 * only when a cheaper scale could not produce a credible (or, on the
 * production path, decodable) candidate.
 */
export const DETECTION_SCALES: readonly number[] = [DOWNSCALE_WIDTH, 240, 320];

/** Per-scale detection result: grid trials plus what the scan saw. */
export interface ScaleTrials {
  trials: TripleTrial[];
  /** At least one verified finder triple existed at this scale. */
  sawTriple: boolean;
  /** Some triple reached calibration and washed out. */
  sawWashout: boolean;
}

/** Shared per-frame preparation: the 160 px grayscale and its sharpness. */
export interface FramePrep {
  sharpness: number;
  gray160: GrayImage;
}

export function prepareFrame(img: RgbaImage): FramePrep {
  const gray160 = grayscaleDownscale(img, DOWNSCALE_WIDTH);
  return { sharpness: laplacianVariance(gray160), gray160 };
}

/**
 * Run finder detection + grid trials at one downscale width. Trials are
 * returned sorted by template mismatch (best first). The caller owns scale
 * escalation and grid-lock bookkeeping (updateGridLock), so a multi-scale
 * caller updates the lock exactly once per camera frame.
 */
export function detectTrialsAtScale(
  img: RgbaImage,
  state: VisionState,
  tuning: VisionTuning,
  width: number,
  prep?: FramePrep,
  debug?: (message: string) => void,
): ScaleTrials {
  const result = detectAndTrial(
    img,
    state,
    tuning,
    width,
    width === DOWNSCALE_WIDTH ? prep?.gray160 : undefined,
    debug,
  );
  result.trials.sort((a, b) => a.mismatch - b.mismatch);
  return result;
}

/** Grid lock bookkeeping: three consecutive frames agreeing on N lock it. */
export function updateGridLock(state: VisionState, observedN: GridSize): void {
  if (state.lockedN !== null) return;
  if (state.candidateN === observedN) {
    state.agreementStreak += 1;
  } else {
    state.candidateN = observedN;
    state.agreementStreak = 1;
  }
  if (state.agreementStreak >= 3) {
    state.lockedN = observedN;
  }
}

/** Classify a trial's modules into a full frame outcome (the costly step). */
export function classifyTrial(
  img: RgbaImage,
  trial: TripleTrial,
  sharpness: number,
  tuning: VisionTuning,
): VisionOutcome {
  return frameFromTrial(img, trial, sharpness, tuning);
}

function frameFromTrial(
  img: RgbaImage,
  trial: TripleTrial,
  sharpness: number,
  tuning: VisionTuning,
): VisionOutcome {
  // full-resolution camera pixels per module, straight from the mapping
  const a: Point = { x: 0, y: 0 };
  const b: Point = { x: 0, y: 0 };
  applyHomography(trial.h, trial.n / 2, trial.n / 2, a);
  applyHomography(trial.h, trial.n / 2 + 1, trial.n / 2, b);
  const pitchPx = Math.hypot(b.x - a.x, b.y - a.y);
  const margins = new Float32Array(trial.n * trial.n);
  const indices = classifyModules(img, trial.h, trial.n, trial.cal, tuning.sampleHalf, margins);
  return {
    kind: 'frame',
    n: trial.n,
    indices,
    pitchPx,
    calibration: trial.cal,
    sharpness,
    homography: trial.h,
    margins,
  };
}

/**
 * Analyze the frame with staged scale escalation and return the winning
 * interpretations, lowest template mismatch first. The 160 px pass runs
 * always; 240/320 px run only while no cheaper scale has produced a
 * credible candidate (template mismatch within ALIGN_ACCEPT). Frame
 * decoding is the final arbiter, so callers should try candidates in
 * order — the cleanest template residual is not always the interpretation
 * that decodes. (The production worker path escalates on decode failure
 * instead; see lib/receive-pipeline.)
 */
export function analyzeFrameCandidates(
  img: RgbaImage,
  state: VisionState,
  tuning: VisionTuning = DEFAULT_TUNING,
  debug?: (message: string) => void,
): { outcomes: VisionOutcome[]; fallback: VisionOutcome } {
  const prep = prepareFrame(img);
  if (prep.sharpness < SHARPNESS_MIN) {
    return { outcomes: [], fallback: { kind: 'blur', sharpness: prep.sharpness } };
  }

  const trials: TripleTrial[] = [];
  let sawTriple = false;
  let sawWashout = false;
  for (const width of DETECTION_SCALES) {
    const result = detectTrialsAtScale(img, state, tuning, width, prep, debug);
    sawTriple = sawTriple || result.sawTriple;
    sawWashout = sawWashout || result.sawWashout;
    trials.push(...result.trials);
    // a credible candidate ends the escalation — costlier scales are
    // fallbacks for marginal captures, not unconditional passes
    if (result.trials.some((t) => t.mismatch <= ALIGN_ACCEPT)) break;
  }
  if (trials.length === 0) {
    return {
      outcomes: [],
      fallback: sawTriple ? { kind: sawWashout ? 'washout' : 'nogrid' } : { kind: 'nofinder' },
    };
  }
  trials.sort((a, b) => a.mismatch - b.mismatch);
  updateGridLock(state, (trials[0] as TripleTrial).n);

  const outcomes = trials.slice(0, 4).map((trial) => frameFromTrial(img, trial, prep.sharpness, tuning));
  return { outcomes, fallback: outcomes[0] as VisionOutcome };
}

export function analyzeFrame(
  img: RgbaImage,
  state: VisionState,
  tuning: VisionTuning = DEFAULT_TUNING,
  debug?: (message: string) => void,
): VisionOutcome {
  const { outcomes, fallback } = analyzeFrameCandidates(img, state, tuning, debug);
  return outcomes.length > 0 ? (outcomes[0] as VisionOutcome) : fallback;
}
