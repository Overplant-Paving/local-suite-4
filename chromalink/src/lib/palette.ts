/**
 * 8-color module palette. Index bits map to channels as (R=bit2, G=bit1, B=bit0),
 * each bit rendered as 0 or 255 in sRGB:
 * 0 black, 1 blue, 2 green, 3 cyan, 4 red, 5 magenta, 6 yellow, 7 white.
 */

export const PALETTE_SIZE = 8;
export const BITS_PER_MODULE = 3;

export const BLACK_INDEX = 0;
export const WHITE_INDEX = 7;

/** Flat [r,g,b, r,g,b, ...] for the 8 palette entries. */
export const PALETTE_RGB: Uint8Array = (() => {
  const t = new Uint8Array(PALETTE_SIZE * 3);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    t[i * 3] = (i >> 2) & 1 ? 255 : 0;
    t[i * 3 + 1] = (i >> 1) & 1 ? 255 : 0;
    t[i * 3 + 2] = i & 1 ? 255 : 0;
  }
  return t;
})();

export function paletteRed(index: number): number {
  return (index >> 2) & 1 ? 255 : 0;
}

export function paletteGreen(index: number): number {
  return (index >> 1) & 1 ? 255 : 0;
}

export function paletteBlue(index: number): number {
  return index & 1 ? 255 : 0;
}

/**
 * Reduce a classified palette index to one binary bit for finder/beacon/header
 * regions: per-channel majority vote (>= 2 of 3 channels set reads as 1).
 */
export function indexToBinaryBit(index: number): 0 | 1 {
  const bits = ((index >> 2) & 1) + ((index >> 1) & 1) + (index & 1);
  return bits >= 2 ? 1 : 0;
}
