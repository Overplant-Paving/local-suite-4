/**
 * Pure-math synthetic camera for tests: renders a frame's palette indices to
 * raw RGBA pixels, then simulates optics — perspective via inverse
 * homography, rotation, Gaussian noise, brightness shift, and box blur.
 * No canvas, no DOM: everything operates on plain typed arrays.
 */

import { PALETTE_RGB } from '../src/lib/palette';

export interface RawImage {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  pixels: Uint8ClampedArray;
}

export const QUIET_MODULES = 4;

/** Render palette indices to RGBA with a white quiet zone. */
export function renderFrameRgb(indices: Uint8Array, n: number, modulePx: number): RawImage {
  const size = (n + 2 * QUIET_MODULES) * modulePx;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const idx = (indices[row * n + col] as number) * 3;
      const r = PALETTE_RGB[idx] as number;
      const g = PALETTE_RGB[idx + 1] as number;
      const b = PALETTE_RGB[idx + 2] as number;
      const y0 = (QUIET_MODULES + row) * modulePx;
      const x0 = (QUIET_MODULES + col) * modulePx;
      for (let y = y0; y < y0 + modulePx; y++) {
        let p = (y * size + x0) * 4;
        for (let x = 0; x < modulePx; x++) {
          pixels[p] = r;
          pixels[p + 1] = g;
          pixels[p + 2] = b;
          p += 4;
        }
      }
    }
  }
  return { width: size, height: size, pixels };
}

/** 3x3 homography mapping (x, y, 1) -> (x', y', w'). */
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

export function applyHomography(h: Homography, x: number, y: number): readonly [number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** Invert a 3x3 homography (adjugate; scale-free). */
export function invertHomography(h: Homography): Homography {
  const [a, b, c, d, e, f, g, i, j] = h;
  return [
    e * j - f * i,
    c * i - b * j,
    b * f - c * e,
    f * g - d * j,
    a * j - c * g,
    c * d - a * f,
    d * i - e * g,
    b * g - a * i,
    a * e - b * d,
  ];
}

/**
 * Homography sending the unit square (0,0)-(1,1) to four target corners
 * (TL, TR, BR, BL order), via the standard projective fit.
 */
export function squareToQuad(
  tl: readonly [number, number],
  tr: readonly [number, number],
  br: readonly [number, number],
  bl: readonly [number, number],
): Homography {
  const dx1 = tr[0] - br[0];
  const dx2 = bl[0] - br[0];
  const dy1 = tr[1] - br[1];
  const dy2 = bl[1] - br[1];
  const sx = tl[0] - tr[0] + br[0] - bl[0];
  const sy = tl[1] - tr[1] + br[1] - bl[1];
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - sy * dx2) / det;
  const i = (dx1 * sy - dy1 * sx) / det;
  const a = tr[0] - tl[0] + g * tr[0];
  const b = bl[0] - tl[0] + i * bl[0];
  const c = tl[0];
  const d = tr[1] - tl[1] + g * tr[1];
  const e = bl[1] - tl[1] + i * bl[1];
  const f = tl[1];
  return [a, b, c, d, e, f, g, i, 1];
}

function bilinearSample(img: RawImage, x: number, y: number, channel: number, fallback: number): number {
  if (x < 0 || y < 0 || x > img.width - 1 || y > img.height - 1) return fallback;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, img.width - 1);
  const y1 = Math.min(y0 + 1, img.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const p00 = img.pixels[(y0 * img.width + x0) * 4 + channel] as number;
  const p10 = img.pixels[(y0 * img.width + x1) * 4 + channel] as number;
  const p01 = img.pixels[(y1 * img.width + x0) * 4 + channel] as number;
  const p11 = img.pixels[(y1 * img.width + x1) * 4 + channel] as number;
  return (
    p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy
  );
}

export interface DistortOptions {
  outWidth: number;
  outHeight: number;
  /** Where the source image's corners land in the output (TL, TR, BR, BL). */
  corners: ReadonlyArray<readonly [number, number]>;
  /** Standard deviation of per-channel Gaussian noise (0 = none). */
  noiseSigma?: number;
  /** Added to every channel after warping. */
  brightness?: number;
  /** Box blur radius in output pixels (0 = none). */
  blurRadius?: number;
  rand?: () => number;
}

/** Warp source into a gray canvas via the inverse homography, then degrade. */
export function distort(src: RawImage, opts: DistortOptions): RawImage {
  const [tl, tr, br, bl] = [opts.corners[0], opts.corners[1], opts.corners[2], opts.corners[3]];
  if (!tl || !tr || !br || !bl) throw new RangeError('distort: four corners required');
  const forward = squareToQuad(
    [tl[0] / opts.outWidth, tl[1] / opts.outHeight],
    [tr[0] / opts.outWidth, tr[1] / opts.outHeight],
    [br[0] / opts.outWidth, br[1] / opts.outHeight],
    [bl[0] / opts.outWidth, bl[1] / opts.outHeight],
  );
  // forward maps unit square -> corner quad in normalized output space;
  // walk output pixels through the inverse and sample the source.
  const inverse = invertHomography(forward);
  const out = new Uint8ClampedArray(opts.outWidth * opts.outHeight * 4);
  const backdrop = 96; // mid-gray surround, distinct from both black and white
  const rand = opts.rand ?? Math.random;
  const sigma = opts.noiseSigma ?? 0;
  const brightness = opts.brightness ?? 0;
  let noisePair: number | null = null;
  const gaussian = (): number => {
    if (noisePair !== null) {
      const v = noisePair;
      noisePair = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    noisePair = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };

  for (let y = 0; y < opts.outHeight; y++) {
    for (let x = 0; x < opts.outWidth; x++) {
      const [u, v] = applyHomography(inverse, (x + 0.5) / opts.outWidth, (y + 0.5) / opts.outHeight);
      const sx = u * src.width;
      const sy = v * src.height;
      const inSrc = u >= 0 && u <= 1 && v >= 0 && v <= 1;
      const p = (y * opts.outWidth + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let value = inSrc ? bilinearSample(src, sx - 0.5, sy - 0.5, ch, backdrop) : backdrop;
        if (sigma > 0) value += gaussian() * sigma;
        value += brightness;
        out[p + ch] = value;
      }
      out[p + 3] = 255;
    }
  }
  let img: RawImage = { width: opts.outWidth, height: opts.outHeight, pixels: out };
  if ((opts.blurRadius ?? 0) > 0) img = boxBlur(img, opts.blurRadius as number);
  return img;
}

/** Separable box blur with the given integer radius. */
export function boxBlur(img: RawImage, radius: number): RawImage {
  const { width, height } = img;
  const tmp = new Float32Array(width * height * 3);
  const out = new Uint8ClampedArray(width * height * 4);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = Math.min(width - 1, Math.max(0, x + k));
          acc += img.pixels[(y * width + xx) * 4 + ch] as number;
        }
        tmp[(y * width + x) * 3 + ch] = acc / span;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = Math.min(height - 1, Math.max(0, y + k));
          acc += tmp[(yy * width + x) * 3 + ch] as number;
        }
        out[p + ch] = acc / span;
      }
      out[p + 3] = 255;
    }
  }
  return { width, height, pixels: out };
}

/**
 * Sharp, code-free scene — a camera pointed away from any code: a smooth
 * luminance gradient plus mild sensor noise. The noise keeps the Laplacian
 * deviation well above the blur gate while staying far below the
 * salt-and-pepper regime where thresholded iid noise can fake concentric
 * finder structure.
 */
export function awayScene(rand: () => number, size = 480): RawImage {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const base = 90 + (70 * (x + y)) / (2 * size) + 25 * Math.sin((x / size) * Math.PI * 2);
      const p = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        pixels[p + ch] = base + (rand() * 2 - 1) * 24;
      }
      pixels[p + 3] = 255;
    }
  }
  return { width: size, height: size, pixels };
}

/** Rotate corner points around a center (degrees, screen coordinates). */
export function rotatedCorners(
  cx: number,
  cy: number,
  halfSize: number,
  degrees: number,
): Array<[number, number]> {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const base: Array<[number, number]> = [
    [-halfSize, -halfSize],
    [halfSize, -halfSize],
    [halfSize, halfSize],
    [-halfSize, halfSize],
  ];
  return base.map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
}
