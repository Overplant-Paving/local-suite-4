/**
 * Shared frame layout for N in {60, 100, 140}. Coordinates are (col, row);
 * module index = row * n + col. All geometry derives from these formulas —
 * no per-N special cases.
 *
 * Reserved regions:
 *  - three 8x8 corner blocks (7x7 finder + white inner separator) at TL/TR/BL
 *  - 7x7 bottom-right block (6x6 beacon + white inner separator)
 *  - header rows 0..7, cols 8..n-9 (one bit per module)
 *  - calibration rows n-2..n-1, cols 8..n-9 (eight palette patches)
 * Every other module is data, row-major.
 */

import {
  BEACON_RESERVED,
  CAL_ROWS,
  FINDER_SIZE,
  HEADER_BYTES,
  HEADER_RS_PARITY,
  RS_PARITY,
  RS_TOTAL,
  type GridSize,
} from './constants';

const CORNER = FINDER_SIZE + 1; // finder + separator = reserved 8x8 corner

export interface Capacity {
  n: GridSize;
  dataModules: number;
  rawBytes: number;
  rsCodewords: number;
  payloadBytes: number;
  headerBits: number;
}

export function headerRegionCols(n: GridSize): { start: number; end: number } {
  return { start: CORNER, end: n - CORNER - 1 };
}

/** Bits available in the header region (rows 0..7 x cols 8..n-9). */
export function headerBitCapacity(n: GridSize): number {
  return CORNER * (n - 2 * CORNER);
}

export const PROTECTED_HEADER_BYTES = HEADER_BYTES + HEADER_RS_PARITY;
export const PROTECTED_HEADER_BITS = PROTECTED_HEADER_BYTES * 8;

function inCorner(n: number, col: number, row: number): boolean {
  if (row < CORNER && col < CORNER) return true; // TL
  if (row < CORNER && col >= n - CORNER) return true; // TR
  if (row >= n - CORNER && col < CORNER) return true; // BL
  return false;
}

function inBeacon(n: number, col: number, row: number): boolean {
  return row >= n - BEACON_RESERVED && col >= n - BEACON_RESERVED;
}

function inHeader(n: number, col: number, row: number): boolean {
  return row < CORNER && col >= CORNER && col <= n - CORNER - 1;
}

function inCalibration(n: number, col: number, row: number): boolean {
  return row >= n - CAL_ROWS && col >= CORNER && col <= n - CORNER - 1;
}

/** n*n bytes; 1 = reserved (finder/beacon/header/calibration), 0 = data. */
export function reservedMask(n: GridSize): Uint8Array {
  const mask = new Uint8Array(n * n);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (
        inCorner(n, col, row) ||
        inBeacon(n, col, row) ||
        inHeader(n, col, row) ||
        inCalibration(n, col, row)
      ) {
        mask[row * n + col] = 1;
      }
    }
  }
  return mask;
}

/** Row-major module indices (row * n + col) of every data module. */
export function dataModuleOrder(n: GridSize): Uint32Array {
  const mask = reservedMask(n);
  const order = new Uint32Array(n * n);
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if ((mask[i] as number) === 0) {
      order[count] = i;
      count += 1;
    }
  }
  return order.slice(0, count);
}

/** Row-major module indices of the header region (one header bit each). */
export function headerModuleOrder(n: GridSize): Uint32Array {
  const cols = headerRegionCols(n);
  const width = cols.end - cols.start + 1;
  const order = new Uint32Array(CORNER * width);
  let k = 0;
  for (let row = 0; row < CORNER; row++) {
    for (let col = cols.start; col <= cols.end; col++) {
      order[k] = row * n + col;
      k += 1;
    }
  }
  return order;
}

export function capacity(n: GridSize): Capacity {
  let dataModules = 0;
  const mask = reservedMask(n);
  for (let i = 0; i < mask.length; i++) {
    if ((mask[i] as number) === 0) dataModules += 1;
  }
  const rawBytes = Math.floor((dataModules * 3) / 8);
  const rsCodewords = Math.ceil(rawBytes / RS_TOTAL);
  const payloadBytes = rawBytes - rsCodewords * RS_PARITY;
  return {
    n,
    dataModules,
    rawBytes,
    rsCodewords,
    payloadBytes,
    headerBits: headerBitCapacity(n),
  };
}

/** Deterministic near-equal payload chunk lengths (longer chunks first). */
export function rsChunkLengths(n: GridSize): number[] {
  const cap = capacity(n);
  const base = Math.floor(cap.payloadBytes / cap.rsCodewords);
  const rem = cap.payloadBytes % cap.rsCodewords;
  const lengths: number[] = [];
  for (let i = 0; i < cap.rsCodewords; i++) {
    lengths.push(base + (i < rem ? 1 : 0));
  }
  return lengths;
}

/**
 * Byte-wise interleave of C codewords: output position j*C+i holds codeword i
 * byte j while every codeword still has a byte j; the ragged tail (codeword
 * lengths differ by at most one) continues in i order. Total length is exactly
 * the frame's rawBytes — nothing reads or writes past it.
 */
export function interleaveCodewords(codewords: readonly Uint8Array[]): Uint8Array {
  const c = codewords.length;
  let total = 0;
  let maxLen = 0;
  for (const cw of codewords) {
    total += cw.length;
    if (cw.length > maxLen) maxLen = cw.length;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (let j = 0; j < maxLen; j++) {
    for (let i = 0; i < c; i++) {
      const cw = codewords[i] as Uint8Array;
      if (j < cw.length) {
        out[pos] = cw[j] as number;
        pos += 1;
      }
    }
  }
  return out;
}

/** Exact inverse of interleaveCodewords for this frame size. */
export function deinterleaveCodewords(raw: Uint8Array, n: GridSize): Uint8Array[] | null {
  const cap = capacity(n);
  if (raw.length !== cap.rawBytes) return null;
  const lengths = rsChunkLengths(n).map((len) => len + RS_PARITY);
  const codewords = lengths.map((len) => new Uint8Array(len));
  const maxLen = Math.max(...lengths);
  let pos = 0;
  for (let j = 0; j < maxLen; j++) {
    for (let i = 0; i < lengths.length; i++) {
      if (j < (lengths[i] as number)) {
        (codewords[i] as Uint8Array)[j] = raw[pos] as number;
        pos += 1;
      }
    }
  }
  if (pos !== raw.length) return null;
  return codewords;
}

// ---------------------------------------------------------------- geometry

/** Top-left (col, row) of the three 7x7 finders: TL, TR, BL. */
export function finderOrigins(n: GridSize): ReadonlyArray<readonly [number, number]> {
  return [
    [0, 0],
    [n - FINDER_SIZE, 0],
    [0, n - FINDER_SIZE],
  ];
}

/** Finder centers in module units: TL, TR, BL. */
export function finderCenters(n: GridSize): ReadonlyArray<readonly [number, number]> {
  const half = FINDER_SIZE / 2; // 3.5
  return [
    [half, half],
    [n - half, half],
    [half, n - half],
  ];
}

/** Center of the 6x6 beacon body (rows/cols n-6..n-1) in module units. */
export function beaconCenter(n: GridSize): readonly [number, number] {
  return [n - 3, n - 3];
}

/** Inclusive module bounds of the 6x6 beacon body. */
export function beaconBodyBounds(n: GridSize): { min: number; max: number } {
  return { min: n - (BEACON_RESERVED - 1), max: n - 1 };
}

/** True when the 7x7 finder cell at local (dc, dr) is black (QR ring). */
export function finderModuleIsBlack(dc: number, dr: number): boolean {
  const d = Math.max(Math.abs(dc - 3), Math.abs(dr - 3));
  return d !== 2;
}

/** Inclusive column span of calibration patch i (0..7) on rows n-2..n-1. */
export function calibrationPatchSpan(n: GridSize, i: number): { colStart: number; colEnd: number } {
  const w = n - 2 * CORNER;
  const colStart = CORNER + Math.floor((i * w) / 8);
  const colEnd = CORNER + Math.floor(((i + 1) * w) / 8) - 1;
  return { colStart, colEnd };
}

export { CORNER };
