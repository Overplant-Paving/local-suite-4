/** Integral-image adaptive threshold (region size = width/8, default bias -7). */

import type { GrayImage } from './image';

export interface BinaryImage {
  width: number;
  height: number;
  /** 1 = dark, 0 = light. */
  pixels: Uint8Array;
}

export function adaptiveThreshold(gray: GrayImage, bias = -7): BinaryImage {
  const { width, height, pixels } = gray;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const rowBase = y * width;
    const intBase = (y + 1) * (width + 1);
    const prevBase = y * (width + 1);
    for (let x = 0; x < width; x++) {
      rowSum += pixels[rowBase + x] as number;
      integral[intBase + x + 1] = rowSum + (integral[prevBase + x + 1] as number);
    }
  }
  const regionSize = Math.max(2, Math.floor(width / 8));
  const half = regionSize >> 1;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height - 1, y + half);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width - 1, x + half);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        (integral[(y1 + 1) * (width + 1) + x1 + 1] as number) -
        (integral[y0 * (width + 1) + x1 + 1] as number) -
        (integral[(y1 + 1) * (width + 1) + x0] as number) +
        (integral[y0 * (width + 1) + x0] as number);
      const mean = sum / area;
      out[y * width + x] = (pixels[y * width + x] as number) < mean + bias ? 1 : 0;
    }
  }
  return { width, height, pixels: out };
}
