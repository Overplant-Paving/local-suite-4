/**
 * Sender canvas renderer. Exact-white background, integer device pixels per
 * module (floor(canvasCSSPx * dpr / (N + 8))), 4-module quiet zone, opaque
 * sRGB context, smoothing off, one exact fillRect per non-white module —
 * no bitmap or CSS scaling anywhere.
 */

import { paletteBlue, paletteGreen, paletteRed, WHITE_INDEX } from '../lib/palette';

export const QUIET_MODULES = 4;
const STAGE_MARGIN_PX = 16;

export interface SenderRenderer {
  canvas: HTMLCanvasElement;
  /** Recompute integer module scale for the current viewport. */
  resize(n: number): void;
  drawFrame(indices: Uint8Array, n: number): void;
  devicePixelsPerModule(): number;
}

export function createRenderer(): SenderRenderer {
  const canvas = document.createElement('canvas');
  const maybeCtx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
  if (maybeCtx === null) throw new Error('renderer: 2d context unavailable');
  const ctx: CanvasRenderingContext2D = maybeCtx;

  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    colors.push(`rgb(${paletteRed(i)},${paletteGreen(i)},${paletteBlue(i)})`);
  }

  let modulePx = 1;
  let sizedFor = 0;

  function resize(n: number): void {
    const cssBudget = Math.min(window.innerWidth, window.innerHeight) - STAGE_MARGIN_PX;
    const dpr = window.devicePixelRatio || 1;
    modulePx = Math.max(1, Math.floor((cssBudget * dpr) / (n + 2 * QUIET_MODULES)));
    const devicePx = modulePx * (n + 2 * QUIET_MODULES);
    canvas.width = devicePx;
    canvas.height = devicePx;
    canvas.style.width = `${devicePx / dpr}px`;
    canvas.style.height = `${devicePx / dpr}px`;
    // resizing resets context state
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, devicePx, devicePx);
    sizedFor = n;
  }

  function drawFrame(indices: Uint8Array, n: number): void {
    if (sizedFor !== n) resize(n);
    const devicePx = canvas.width;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, devicePx, devicePx);
    const offset = QUIET_MODULES * modulePx;
    for (let color = 0; color < 8; color++) {
      if (color === WHITE_INDEX) continue; // background is already exact white
      ctx.fillStyle = colors[color] as string;
      for (let row = 0; row < n; row++) {
        const rowBase = row * n;
        const y = offset + row * modulePx;
        for (let col = 0; col < n; col++) {
          if ((indices[rowBase + col] as number) === color) {
            ctx.fillRect(offset + col * modulePx, y, modulePx, modulePx);
          }
        }
      }
    }
  }

  return {
    canvas,
    resize,
    drawFrame,
    devicePixelsPerModule: () => modulePx,
  };
}
