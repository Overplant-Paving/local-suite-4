/**
 * Calibration-strip measurement and nearest-color module classification.
 * The eight calibration patches (bottom two rows) give the receiver the
 * frame's actual rendered palette under current lighting.
 */

import { CAL_ROWS, type GridSize } from '../constants';
import { calibrationPatchSpan } from '../layout';
import type { RgbaImage } from './image';
import type { Homography } from './homography';
import { sampleModuleRgb, sampleRegionRgb } from './sampler';

/** Eight measured patch colors, flat [r,g,b] * 8. */
export type Calibration = Float32Array;

export const WASHOUT_MIN_NORM = 60;

/**
 * Measure the calibration patches from the central 60% of each patch.
 * Returns null when the white-to-black distance collapses (washout).
 */
export function measureCalibration(img: RgbaImage, h: Homography, n: GridSize): Calibration | null {
  const cal = new Float32Array(24);
  const rowTop = n - CAL_ROWS;
  const vMargin = CAL_ROWS * 0.2;
  for (let patch = 0; patch < 8; patch++) {
    const span = calibrationPatchSpan(n, patch);
    const width = span.colEnd + 1 - span.colStart;
    const uMargin = width * 0.2;
    sampleRegionRgb(
      img,
      h,
      span.colStart + uMargin,
      rowTop + vMargin,
      span.colEnd + 1 - uMargin,
      n - vMargin,
      5,
      3,
      cal,
      patch * 3,
    );
  }
  const dr = (cal[21] as number) - (cal[0] as number);
  const dg = (cal[22] as number) - (cal[1] as number);
  const db = (cal[23] as number) - (cal[2] as number);
  if (Math.sqrt(dr * dr + dg * dg + db * db) < WASHOUT_MIN_NORM) return null;
  return cal;
}

function luma(cal: Calibration, patch: number): number {
  return (
    (cal[patch * 3] as number) * 0.299 +
    (cal[patch * 3 + 1] as number) * 0.587 +
    (cal[patch * 3 + 2] as number) * 0.114
  );
}

/**
 * Patch 0 must read darkest, patch 7 brightest, and the middle patches must
 * show the palette's channel structure (patch 4 red-dominant, patch 2
 * green-dominant, patch 1 blue-dominant, and the complements). A wrong-grid
 * trial samples random data modules whose averages collapse toward gray and
 * cannot reproduce these margins.
 */
export function calibrationLooksValid(cal: Calibration): boolean {
  const black = luma(cal, 0);
  const white = luma(cal, 7);
  for (let patch = 1; patch < 7; patch++) {
    const v = luma(cal, patch);
    if (v <= black || v >= white) return false;
  }
  const margin = 30;
  const ch = (patch: number, c: number): number => cal[patch * 3 + c] as number;
  const dominates = (patch: number, strong: readonly number[], weak: readonly number[]): boolean => {
    let minStrong = Number.POSITIVE_INFINITY;
    for (const c of strong) minStrong = Math.min(minStrong, ch(patch, c));
    let maxWeak = Number.NEGATIVE_INFINITY;
    for (const c of weak) maxWeak = Math.max(maxWeak, ch(patch, c));
    return minStrong - maxWeak >= margin;
  };
  return (
    dominates(1, [2], [0, 1]) && // blue
    dominates(2, [1], [0, 2]) && // green
    dominates(3, [1, 2], [0]) && // cyan
    dominates(4, [0], [1, 2]) && // red
    dominates(5, [0, 2], [1]) && // magenta
    dominates(6, [0, 1], [2]) // yellow
  );
}

/** Inter-patch RGB variance — the grid-size selection score. */
export function calibrationScore(cal: Calibration): number {
  let score = 0;
  for (let ch = 0; ch < 3; ch++) {
    let sum = 0;
    let sumSq = 0;
    for (let patch = 0; patch < 8; patch++) {
      const v = cal[patch * 3 + ch] as number;
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / 8;
    score += sumSq / 8 - mean * mean;
  }
  return score;
}

function nearestDist(cal: Calibration, r: number, g: number, b: number): number {
  let bestDist = Number.POSITIVE_INFINITY;
  for (let p = 0; p < 8; p++) {
    const dr = r - (cal[p * 3] as number);
    const dg = g - (cal[p * 3 + 1] as number);
    const db = b - (cal[p * 3 + 2] as number);
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) bestDist = dist;
  }
  return bestDist;
}

const BAND_ROWS = 8;
const OFFSET_STEPS = [-0.28, -0.21, -0.14, -0.07, 0, 0.07, 0.14, 0.21, 0.28];

/**
 * Estimate a per-band sampling offset by purity: samples centered on a
 * module land on a pure palette color (small distance to the nearest
 * calibration entry) while drifted samples read neighbor mixes. The
 * residual anchor error is a smooth field, so one offset per band of rows
 * (and one per band of columns) absorbs what a global homography cannot.
 */
function bandOffsets(
  img: RgbaImage,
  h: Homography,
  n: GridSize,
  cal: Calibration,
  axis: 'row' | 'col',
): Float32Array {
  const bands = Math.ceil(n / BAND_ROWS);
  const offsets = new Float32Array(bands);
  const rgb = new Float32Array(3);
  for (let band = 0; band < bands; band++) {
    const start = band * BAND_ROWS;
    const end = Math.min(n, start + BAND_ROWS);
    const costAt = (offset: number): number => {
      let cost = 0;
      let count = 0;
      for (let major = start; major < end; major += 2) {
        for (let minor = 4; minor < n - 4; minor += 3) {
          const col = axis === 'row' ? minor : major;
          const row = axis === 'row' ? major : minor;
          const du = axis === 'col' ? offset : 0;
          const dv = axis === 'row' ? offset : 0;
          sampleModuleRgb(img, h, col + du, row + dv, 0.001, rgb, 0);
          cost += nearestDist(cal, rgb[0] as number, rgb[1] as number, rgb[2] as number);
          count += 1;
        }
      }
      return count > 0 ? cost / count : Number.POSITIVE_INFINITY;
    };
    let bestOffset = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const offset of OFFSET_STEPS) {
      const cost = costAt(offset);
      if (cost < bestCost) {
        bestCost = cost;
        bestOffset = offset;
      }
    }
    // fine pass around the coarse winner — a few near-miss codewords sit
    // one or two byte errors over the RS budget at coarse granularity
    for (const delta of [-0.045, -0.02, 0.02, 0.045]) {
      const offset = bestOffset + delta;
      const cost = costAt(offset);
      if (cost < bestCost) {
        bestCost = cost;
        bestOffset = offset;
      }
    }
    offsets[band] = bestOffset;
  }
  return offsets;
}

/**
 * Classify every module to the nearest calibration color (squared RGB
 * distance), with per-band purity-derived offsets absorbing residual
 * smooth drift. Returns n*n palette indices, row-major.
 */
export function classifyModules(
  img: RgbaImage,
  h: Homography,
  n: GridSize,
  cal: Calibration,
  sampleHalf: number,
  marginsOut?: Float32Array,
): Uint8Array {
  const rowOffsets = bandOffsets(img, h, n, cal, 'row');
  const colOffsets = bandOffsets(img, h, n, cal, 'col');
  const out = new Uint8Array(n * n);
  const rgb = new Float32Array(3);

  const read = (
    col: number,
    row: number,
    du: number,
    dv: number,
  ): { index: number; margin: number } => {
    sampleModuleRgb(img, h, col + du, row + dv, sampleHalf, rgb, 0);
    const r = rgb[0] as number;
    const g = rgb[1] as number;
    const b = rgb[2] as number;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    let secondDist = Number.POSITIVE_INFINITY;
    for (let p = 0; p < 8; p++) {
      const dr = r - (cal[p * 3] as number);
      const dg = g - (cal[p * 3 + 1] as number);
      const db = b - (cal[p * 3 + 2] as number);
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        secondDist = bestDist;
        bestDist = dist;
        best = p;
      } else if (dist < secondDist) {
        secondDist = dist;
      }
    }
    // confidence gap between the winner and the runner-up color
    return { index: best, margin: Math.sqrt(secondDist) - Math.sqrt(bestDist) };
  };

  const CONFIDENT = 60;
  for (let row = 0; row < n; row++) {
    const dv = rowOffsets[Math.floor(row / BAND_ROWS)] as number;
    for (let col = 0; col < n; col++) {
      const du = colOffsets[Math.floor(col / BAND_ROWS)] as number;
      let bestRead = read(col, row, du, dv);
      if (bestRead.margin < CONFIDENT) {
        // Micro-alignment: a drift-straddled sample reads a color mix that
        // can sit confidently NEAR a wrong palette entry; the purest (max
        // margin) read among small offsets is the one actually centered
        // on the module.
        for (const [ou, ov] of [
          [0.14, 0],
          [-0.14, 0],
          [0, 0.14],
          [0, -0.14],
        ] as const) {
          const candidate = read(col, row, du + ou, dv + ov);
          if (candidate.margin > bestRead.margin) bestRead = candidate;
        }
      }
      out[row * n + col] = bestRead.index;
      if (marginsOut !== undefined) {
        marginsOut[row * n + col] = bestRead.margin;
      }
    }
  }
  return out;
}
