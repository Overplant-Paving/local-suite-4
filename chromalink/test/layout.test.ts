import { describe, expect, it } from 'vitest';
import { GRID_SIZES, RS_PARITY, type GridSize } from '../src/lib/constants';
import {
  beaconBodyBounds,
  calibrationPatchSpan,
  capacity,
  dataModuleOrder,
  deinterleaveCodewords,
  finderCenters,
  finderOrigins,
  headerModuleOrder,
  interleaveCodewords,
  reservedMask,
  rsChunkLengths,
} from '../src/lib/layout';
import { mulberry32, randomBytes } from './prng';

/** Regression anchors — any change to these is a wire-format change. */
const ANCHORS: Record<GridSize, { dataModules: number; rawBytes: number; rsCodewords: number; payloadBytes: number; headerBits: number }> = {
  60: { dataModules: 2919, rawBytes: 1094, rsCodewords: 5, payloadBytes: 934, headerBits: 352 },
  100: { dataModules: 8919, rawBytes: 3344, rsCodewords: 14, payloadBytes: 2896, headerBits: 672 },
  140: { dataModules: 18119, rawBytes: 6794, rsCodewords: 27, payloadBytes: 5930, headerBits: 992 },
};

describe('layout capacity', () => {
  for (const n of GRID_SIZES) {
    it(`pins the N${n} capacity anchors`, () => {
      const cap = capacity(n);
      expect(cap).toMatchObject(ANCHORS[n]);
    });
  }

  it('reserved + data modules account for every module exactly once', () => {
    for (const n of GRID_SIZES) {
      const mask = reservedMask(n);
      const order = dataModuleOrder(n);
      let reserved = 0;
      for (const m of mask) reserved += m;
      expect(reserved + order.length).toBe(n * n);
      // strictly increasing row-major and all non-reserved
      let prev = -1;
      for (const idx of order) {
        expect(idx).toBeGreaterThan(prev);
        expect(mask[idx]).toBe(0);
        prev = idx;
      }
    }
  });

  it('header region is rows 0..7 x cols 8..n-9, row-major', () => {
    for (const n of GRID_SIZES) {
      const order = headerModuleOrder(n);
      expect(order.length).toBe(ANCHORS[n].headerBits);
      expect(order[0]).toBe(8);
      expect(order[order.length - 1]).toBe(7 * n + (n - 9));
      const mask = reservedMask(n);
      for (const idx of order) expect(mask[idx]).toBe(1);
    }
  });

  it('calibration patches tile cols 8..n-9 with the floor boundaries', () => {
    for (const n of GRID_SIZES) {
      const w = n - 16;
      let covered = 0;
      let prevEnd = 7;
      for (let i = 0; i < 8; i++) {
        const span = calibrationPatchSpan(n, i);
        expect(span.colStart).toBe(8 + Math.floor((i * w) / 8));
        expect(span.colStart).toBe(prevEnd + 1);
        covered += span.colEnd - span.colStart + 1;
        prevEnd = span.colEnd;
      }
      expect(prevEnd).toBe(n - 9);
      expect(covered).toBe(w);
    }
  });

  it('places finders and beacon by formula', () => {
    for (const n of GRID_SIZES) {
      expect(finderOrigins(n)).toEqual([
        [0, 0],
        [n - 7, 0],
        [0, n - 7],
      ]);
      expect(finderCenters(n)).toEqual([
        [3.5, 3.5],
        [n - 3.5, 3.5],
        [3.5, n - 3.5],
      ]);
      expect(beaconBodyBounds(n)).toEqual({ min: n - 6, max: n - 1 });
    }
  });
});

describe('payload interleaving', () => {
  it('chunk lengths are near-equal, longer first, and sum to payload capacity', () => {
    for (const n of GRID_SIZES) {
      const cap = capacity(n);
      const lengths = rsChunkLengths(n);
      expect(lengths.length).toBe(cap.rsCodewords);
      expect(lengths.reduce((a, b) => a + b, 0)).toBe(cap.payloadBytes);
      const min = Math.min(...lengths);
      const max = Math.max(...lengths);
      expect(max - min).toBeLessThanOrEqual(1);
      expect([...lengths]).toEqual([...lengths].sort((a, b) => b - a));
      for (const len of lengths) {
        expect(len + RS_PARITY).toBeLessThanOrEqual(255);
      }
    }
  });

  it('interleave positions j*C+i hold while every codeword has byte j', () => {
    for (const n of GRID_SIZES) {
      const cap = capacity(n);
      const lengths = rsChunkLengths(n).map((l) => l + RS_PARITY);
      const rand = mulberry32(n);
      const codewords = lengths.map((len) => randomBytes(rand, len));
      const raw = interleaveCodewords(codewords);
      expect(raw.length).toBe(cap.rawBytes);
      const c = codewords.length;
      const minLen = Math.min(...lengths);
      for (let j = 0; j < minLen; j++) {
        for (let i = 0; i < c; i++) {
          expect(raw[j * c + i]).toBe((codewords[i] as Uint8Array)[j]);
        }
      }
      const back = deinterleaveCodewords(raw, n);
      expect(back).not.toBeNull();
      (back as Uint8Array[]).forEach((cw, i) => {
        expect([...cw]).toEqual([...(codewords[i] as Uint8Array)]);
      });
    }
  });

  it('rejects a raw buffer of the wrong length', () => {
    expect(deinterleaveCodewords(new Uint8Array(10), 100)).toBeNull();
  });
});
