/** Plain-buffer image types and the cheap front half of the pipeline. */

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, row-major. */
  pixels: Uint8ClampedArray;
}

export interface GrayImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export const DOWNSCALE_WIDTH = 160;

/** Nearest-neighbor grayscale downscale to the given width (default 160). */
export function grayscaleDownscale(src: RgbaImage, targetWidth = DOWNSCALE_WIDTH): GrayImage {
  const scale = src.width / targetWidth;
  const outWidth = targetWidth;
  const outHeight = Math.max(1, Math.round(src.height / scale));
  const out = new Uint8Array(outWidth * outHeight);
  for (let y = 0; y < outHeight; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y + 0.5) * scale));
    for (let x = 0; x < outWidth; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x + 0.5) * scale));
      const p = (sy * src.width + sx) * 4;
      const r = src.pixels[p] as number;
      const g = src.pixels[p + 1] as number;
      const b = src.pixels[p + 2] as number;
      // integer luma approximation (BT.601-ish)
      out[y * outWidth + x] = (r * 77 + g * 150 + b * 29) >> 8;
    }
  }
  return { width: outWidth, height: outHeight, pixels: out };
}

/**
 * Sharpness = standard deviation of the 4-neighbor Laplacian response over
 * interior pixels. The deviation (not the raw variance) is the scale the
 * protocol's SHARPNESS_MIN=25 was written against: a radius-3 box blur of
 * a code-filling capture measures ~15 here while any sharp capture
 * measures hundreds — raw variance would be ~225 vs ~60,000 and could
 * never sit on either side of 25.
 */
export function laplacianVariance(gray: GrayImage): number {
  const { width, height, pixels } = gray;
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const p = row + x;
      const lap =
        (pixels[p - width] as number) +
        (pixels[p + width] as number) +
        (pixels[p - 1] as number) +
        (pixels[p + 1] as number) -
        4 * (pixels[p] as number);
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }
  const mean = sum / count;
  return Math.sqrt(Math.max(0, sumSq / count - mean * mean));
}

/** Map a downscale coordinate back to the full-resolution pixel grid. */
export function upscaleCoord(value: number, srcSize: number, downSize: number): number {
  return ((value + 0.5) * srcSize) / downSize - 0.5;
}
