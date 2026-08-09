import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { GRID_SIZES, type GridSize } from '../src/lib/constants';
import { crc32 } from '../src/lib/crc';
import { encodeFrame } from '../src/lib/frame-encode';
import { decodeFrame, decodeFrameHeader, decodeFramePayload } from '../src/lib/frame-decode';
import { buildProtectedHeader, type FrameHeader } from '../src/lib/header';
import { calibrationPatchSpan, capacity, headerModuleOrder, PROTECTED_HEADER_BITS } from '../src/lib/layout';
import { BLACK_INDEX, indexToBinaryBit, PALETTE_RGB, WHITE_INDEX } from '../src/lib/palette';
import { mulberry32, randomBytes } from './prng';
import { QUIET_MODULES, renderFrameRgb } from './synthetic';

function sampleFrame(n: GridSize, sequenceParity: 0 | 1): {
  fields: FrameHeader;
  payload: Uint8Array;
  indices: Uint8Array;
} {
  const rand = mulberry32(0x1000 + n);
  const payload = randomBytes(rand, capacity(n).payloadBytes);
  const fields: FrameHeader = {
    transferId: 0xa1b2c3d4,
    oti: randomBytes(rand, 12),
    payloadId: randomBytes(rand, 4),
    payloadCrc32: crc32(payload),
  };
  const header = buildProtectedHeader(fields);
  const indices = encodeFrame({ n, header, payload, sequenceParity });
  return { fields, payload, indices };
}

/** Encoded-frame stability: any change here is a wire-format change. */
const FRAME_PINS: Record<GridSize, string> = {
  60: '5f3524ea0403e18d9e0a4d21d2e4abb08bd51eb56169a9e4ec31361f5858f598',
  100: 'a89cd76ea3fa7fbde68ae0ab42d12c3b06a3ef77b4328b24cfc1721e073b4170',
  140: 'be47f542165b125bb057f659a72dbd2b37bbdd8a594c9097c4975e4b579ffa9b',
};

describe('frame encode stability', () => {
  for (const n of GRID_SIZES) {
    it(`N${n} fixed-seed frame hash is pinned`, () => {
      const { indices } = sampleFrame(n, n === 100 ? 1 : 0);
      expect(bytesToHex(sha256(indices))).toBe(FRAME_PINS[n]);
    });
  }
});

describe('frame index-level roundtrip', () => {
  for (const n of GRID_SIZES) {
    it(`N${n} decodes exactly what was encoded`, () => {
      const { fields, payload, indices } = sampleFrame(n, 0);
      const decoded = decodeFrame(indices, n, null);
      expect(decoded).not.toBeNull();
      expect(decoded?.header.transferId).toBe(fields.transferId);
      expect([...(decoded?.header.payloadId as Uint8Array)]).toEqual([...fields.payloadId]);
      expect([...(decoded?.payload as Uint8Array)]).toEqual([...payload]);
      // transfer-id lock: a different expected id must reject the frame
      expect(decodeFrame(indices, n, 0x11111111)).toBeNull();
      expect(decodeFrame(indices, n, fields.transferId)).not.toBeNull();
    });
  }

  it('a flipped data region rejects via RS or payload CRC, never wrong bytes', () => {
    const n = 100 as GridSize;
    const { fields, payload, indices } = sampleFrame(n, 0);
    const header = decodeFrameHeader(indices, n);
    expect(header).not.toBeNull();
    // Header CRC32 written for a different payload: RS decodes fine, CRC must veto.
    const wrongCrcHeader: FrameHeader = { ...fields, payloadCrc32: fields.payloadCrc32 ^ 0xdeadbeef };
    const forged = encodeFrame({
      n,
      header: buildProtectedHeader(wrongCrcHeader),
      payload,
      sequenceParity: 0,
    });
    const forgedHeader = decodeFrameHeader(forged, n);
    expect(forgedHeader).not.toBeNull();
    expect(decodeFramePayload(forged, n, forgedHeader as FrameHeader)).toBeNull();
  });

  it('N100/N140: a corrupted first header copy falls back to the intact second', () => {
    for (const n of [100, 140] as GridSize[]) {
      const { fields, indices } = sampleFrame(n, 0);
      expect(capacity(n).headerBits).toBeGreaterThanOrEqual(2 * PROTECTED_HEADER_BITS);
      const order = headerModuleOrder(n);
      const corrupted = indices.slice();
      // invert every bit of the first 42-byte protected copy — far past
      // RS(42, 28)'s 7-byte correction budget, so copy 1 alone is dead
      for (let k = 0; k < PROTECTED_HEADER_BITS; k++) {
        const moduleIndex = order[k] as number;
        corrupted[moduleIndex] =
          indexToBinaryBit(corrupted[moduleIndex] as number) === 1 ? BLACK_INDEX : WHITE_INDEX;
      }
      const header = decodeFrameHeader(corrupted, n);
      expect(header, `N${n} second-copy fallback`).not.toBeNull();
      expect(header?.transferId).toBe(fields.transferId);
      expect([...(header?.oti as Uint8Array)]).toEqual([...fields.oti]);
      expect([...(header?.payloadId as Uint8Array)]).toEqual([...fields.payloadId]);
      expect(header?.payloadCrc32).toBe(fields.payloadCrc32);
      // the whole frame (payload included) still decodes off the fallback
      const full = decodeFrame(corrupted, n, null);
      expect(full).not.toBeNull();
    }
  });

  it('the same first-copy corruption is fatal where no second copy fits (N60)', () => {
    // proves the corruption pattern above genuinely kills a header copy:
    // N60 has 352 header bits — one full copy — so there is no fallback
    const n = 60 as GridSize;
    const { indices } = sampleFrame(n, 0);
    expect(capacity(n).headerBits).toBeLessThan(2 * PROTECTED_HEADER_BITS);
    const order = headerModuleOrder(n);
    const corrupted = indices.slice();
    for (let k = 0; k < PROTECTED_HEADER_BITS; k++) {
      const moduleIndex = order[k] as number;
      corrupted[moduleIndex] =
        indexToBinaryBit(corrupted[moduleIndex] as number) === 1 ? BLACK_INDEX : WHITE_INDEX;
    }
    expect(decodeFrameHeader(corrupted, n)).toBeNull();
  });

  it('malformed classified input returns null instead of throwing', () => {
    expect(decodeFrame(new Uint8Array(10), 100, null)).toBeNull();
    expect(decodeFrame(new Uint8Array(100 * 100).fill(3), 100, null)).toBeNull();
    expect(decodeFrame(new Uint8Array(100 * 100).fill(255), 100, null)).toBeNull();
  });
});

describe('raw RGB rendering', () => {
  const n = 100 as GridSize;
  const m = 4;

  function pixelAt(img: { width: number; pixels: Uint8ClampedArray }, col: number, row: number): [number, number, number] {
    const x = (QUIET_MODULES + col) * m + Math.floor(m / 2);
    const y = (QUIET_MODULES + row) * m + Math.floor(m / 2);
    const p = (y * img.width + x) * 4;
    return [img.pixels[p] as number, img.pixels[p + 1] as number, img.pixels[p + 2] as number];
  }

  it('finders, separators, beacon, and calibration have exact RGB values', () => {
    const even = renderFrameRgb(sampleFrame(n, 0).indices, n, m);

    // quiet zone is exact white
    expect([even.pixels[0], even.pixels[1], even.pixels[2]]).toEqual([255, 255, 255]);

    // TL finder: black center, white ring at Chebyshev distance 2, black border
    expect(pixelAt(even, 3, 3)).toEqual([0, 0, 0]);
    expect(pixelAt(even, 1, 3)).toEqual([255, 255, 255]);
    expect(pixelAt(even, 0, 0)).toEqual([0, 0, 0]);
    // separator column/row are white
    expect(pixelAt(even, 7, 3)).toEqual([255, 255, 255]);
    expect(pixelAt(even, 3, 7)).toEqual([255, 255, 255]);
    // TR and BL finder centers
    expect(pixelAt(even, n - 4, 3)).toEqual([0, 0, 0]);
    expect(pixelAt(even, 3, n - 4)).toEqual([0, 0, 0]);

    // beacon body: black on even sequence, white on odd; separator white
    expect(pixelAt(even, n - 3, n - 3)).toEqual([0, 0, 0]);
    expect(pixelAt(even, n - 7, n - 7)).toEqual([255, 255, 255]);
    const odd = renderFrameRgb(sampleFrame(n, 1).indices, n, m);
    expect(pixelAt(odd, n - 3, n - 3)).toEqual([255, 255, 255]);

    // calibration patches: exact palette colors on both calibration rows
    for (let patch = 0; patch < 8; patch++) {
      const span = calibrationPatchSpan(n, patch);
      const col = Math.floor((span.colStart + span.colEnd) / 2);
      const expected = [
        PALETTE_RGB[patch * 3] as number,
        PALETTE_RGB[patch * 3 + 1] as number,
        PALETTE_RGB[patch * 3 + 2] as number,
      ];
      expect(pixelAt(even, col, n - 1)).toEqual(expected);
      expect(pixelAt(even, col, n - 2)).toEqual(expected);
    }
  });
});
