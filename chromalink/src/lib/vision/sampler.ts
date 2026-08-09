/** Bilinear RGB sampling of full-resolution frames through a homography. */

import type { RgbaImage } from './image';
import { applyHomography, type Homography, type Point } from './homography';

export function bilinearRgb(
  img: RgbaImage,
  x: number,
  y: number,
  out: Float32Array,
  offset: number,
): void {
  const cx = Math.min(Math.max(x, 0), img.width - 1);
  const cy = Math.min(Math.max(y, 0), img.height - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, img.width - 1);
  const y1 = Math.min(y0 + 1, img.height - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const p00 = (y0 * img.width + x0) * 4;
  const p10 = (y0 * img.width + x1) * 4;
  const p01 = (y1 * img.width + x0) * 4;
  const p11 = (y1 * img.width + x1) * 4;
  for (let ch = 0; ch < 3; ch++) {
    out[offset + ch] =
      (img.pixels[p00 + ch] as number) * w00 +
      (img.pixels[p10 + ch] as number) * w10 +
      (img.pixels[p01 + ch] as number) * w01 +
      (img.pixels[p11 + ch] as number) * w11;
  }
}

const scratch: Point = { x: 0, y: 0 };

/**
 * Average RGB of a module: bilinear samples on a 3x3 grid across the central
 * region (sampleHalf = 0.25 covers the central 50% of the module span).
 */
export function sampleModuleRgb(
  img: RgbaImage,
  h: Homography,
  col: number,
  row: number,
  sampleHalf: number,
  out: Float32Array,
  offset: number,
): void {
  let r = 0;
  let g = 0;
  let b = 0;
  const tmp = new Float32Array(3);
  for (let sy = -1; sy <= 1; sy++) {
    for (let sx = -1; sx <= 1; sx++) {
      const u = col + 0.5 + sx * sampleHalf;
      const v = row + 0.5 + sy * sampleHalf;
      applyHomography(h, u, v, scratch);
      bilinearRgb(img, scratch.x, scratch.y, tmp, 0);
      r += tmp[0] as number;
      g += tmp[1] as number;
      b += tmp[2] as number;
    }
  }
  out[offset] = r / 9;
  out[offset + 1] = g / 9;
  out[offset + 2] = b / 9;
}

/**
 * Darkness-weighted centroid at full resolution — snaps a finder-center
 * prediction onto the actual dark core. Weights are squared so near-black
 * pixels dominate; the radius must stay inside the finder's white ring.
 */
export function darknessCentroid(
  img: RgbaImage,
  cx: number,
  cy: number,
  radius: number,
): Point {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(img.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(img.height - 1, Math.ceil(cy + radius));
  const r2 = radius * radius;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const p = (y * img.width + x) * 4;
      const luma =
        ((img.pixels[p] as number) * 77 +
          (img.pixels[p + 1] as number) * 150 +
          (img.pixels[p + 2] as number) * 29) >>
        8;
      const base = 180 - luma;
      if (base <= 0) continue;
      const w = base * base;
      sx += x * w;
      sy += y * w;
      sw += w;
    }
  }
  if (sw === 0) return { x: cx, y: cy };
  return { x: sx / sw, y: sy / sw };
}

/** Mean RGB over an arbitrary module-space rectangle (used for patches). */
export function sampleRegionRgb(
  img: RgbaImage,
  h: Homography,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  stepsU: number,
  stepsV: number,
  out: Float32Array,
  offset: number,
): void {
  let r = 0;
  let g = 0;
  let b = 0;
  const tmp = new Float32Array(3);
  let count = 0;
  for (let j = 0; j < stepsV; j++) {
    const v = v0 + ((j + 0.5) / stepsV) * (v1 - v0);
    for (let i = 0; i < stepsU; i++) {
      const u = u0 + ((i + 0.5) / stepsU) * (u1 - u0);
      applyHomography(h, u, v, scratch);
      bilinearRgb(img, scratch.x, scratch.y, tmp, 0);
      r += tmp[0] as number;
      g += tmp[1] as number;
      b += tmp[2] as number;
      count += 1;
    }
  }
  out[offset] = r / count;
  out[offset + 1] = g / count;
  out[offset + 2] = b / count;
}
