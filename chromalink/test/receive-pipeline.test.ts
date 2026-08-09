/**
 * Frame processor regressions: the production receive path must report
 * nofinder (not nogrid) when a scene has no finder triple, keep the
 * finder streak strictly consecutive (focus freeze can never be armed by
 * interleaved finder/no-finder frames), continue after malformed frames,
 * filter locked-session mismatches (including same-id/different-OTI),
 * veto packets whose bytes disagree with the header PayloadId, and expose
 * the running displayedSeen / decoded / per-reason reject statistics.
 */

import { describe, expect, it } from 'vitest';
import type { GridSize } from '../src/lib/constants';
import { crc32 } from '../src/lib/crc';
import { encodeFrame } from '../src/lib/frame-encode';
import { buildProtectedHeader } from '../src/lib/header';
import { capacity } from '../src/lib/layout';
import { createFrameProcessor } from '../src/lib/receive-pipeline';
import type { RgbaImage } from '../src/lib/vision/image';
import { mulberry32, randomBytes } from './prng';
import { awayScene, renderFrameRgb } from './synthetic';

const N = 60 as GridSize; // small grid renders fastest; behavior is size-free

interface CleanFrame {
  img: RgbaImage;
  transferId: number;
  oti: Uint8Array;
  payloadId: Uint8Array;
  payload: Uint8Array;
}

function cleanFrame(seed: number, transferId: number, opts?: { payloadIdMismatch?: boolean }): CleanFrame {
  const rand = mulberry32(seed);
  const payload = randomBytes(rand, capacity(N).payloadBytes);
  const oti = randomBytes(rand, 12);
  const payloadId =
    opts?.payloadIdMismatch === true
      ? randomBytes(rand, 4) // header claims an id the packet bytes do not carry
      : payload.slice(0, 4);
  const header = buildProtectedHeader({
    transferId,
    oti,
    payloadId,
    payloadCrc32: crc32(payload),
  });
  const indices = encodeFrame({ n: N, header, payload, sequenceParity: 0 });
  return { img: renderFrameRgb(indices, N, 9), transferId, oti, payloadId, payload };
}

/** Sharp, code-free scene: passes the blur gate, contains no finders. */
function noiseImage(seed: number, size = 480): RgbaImage {
  return awayScene(mulberry32(seed), size);
}

/** Featureless scene: fails the sharpness gate outright. */
function flatImage(size = 480): RgbaImage {
  const pixels = new Uint8ClampedArray(size * size * 4).fill(120);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  return { width: size, height: size, pixels };
}

describe('frame processor', () => {
  it('decodes a clean frame and reports the packet with running stats', () => {
    const processor = createFrameProcessor();
    const frame = cleanFrame(0xaa, 41);
    const result = processor.process(frame.img, null);
    expect(result.type).toBe('packet');
    if (result.type !== 'packet') return;
    expect(result.transferId).toBe(41);
    expect([...result.oti]).toEqual([...frame.oti]);
    expect([...result.payloadId]).toEqual([...frame.payloadId]);
    expect([...result.packet]).toEqual([...frame.payload]);
    expect(result.n).toBe(N);
    expect(result.stats.frames).toBe(1);
    expect(result.stats.displayedSeen).toBe(1);
    expect(result.stats.decoded).toBe(1);
    expect(result.stats.finderStreak).toBe(1);
  });

  it('reports nofinder — not nogrid — when the scene has no finder triple', () => {
    const processor = createFrameProcessor();
    const result = processor.process(noiseImage(0x11), null);
    expect(result.type).toBe('status');
    if (result.type !== 'status') return;
    expect(result.outcome).toBe('nofinder');
    expect(result.stats.rejects.nofinder).toBe(1);
    expect(result.stats.rejects.nogrid).toBe(0);
    expect(result.stats.finderStreak).toBe(0);
  });

  it('keeps the finder streak strictly consecutive across mixed frames', () => {
    const processor = createFrameProcessor();
    const frame = cleanFrame(0xbb, 42);
    const streaks: number[] = [];
    const run = (img: RgbaImage): void => {
      const result = processor.process(img, null);
      streaks.push(result.stats.finderStreak);
    };
    for (let i = 0; i < 3; i++) run(frame.img); // packet, then dups: finder-positive
    run(noiseImage(0x12)); // no finder: the streak must reset, not pause
    for (let i = 0; i < 2; i++) run(frame.img);
    run(flatImage()); // blur: also resets
    run(frame.img);
    expect(streaks).toEqual([1, 2, 3, 0, 1, 2, 0, 1]);
    // non-consecutive finder frames can therefore never reach the
    // 30-frame focus-freeze threshold
    expect(Math.max(...streaks)).toBeLessThan(30);
  });

  it('reports dup for a repeated PayloadId after the header, before payload work', () => {
    const processor = createFrameProcessor();
    const frame = cleanFrame(0xcc, 43);
    expect(processor.process(frame.img, null).type).toBe('packet');
    const second = processor.process(frame.img, null);
    expect(second.type).toBe('status');
    if (second.type !== 'status') return;
    expect(second.outcome).toBe('dup');
    expect(second.stats.dups).toBe(1);
    expect(second.stats.displayedSeen).toBe(2); // the displayed frame was seen again
    expect(second.stats.decoded).toBe(1);
  });

  it('filters locked-session mismatches, including same id with different OTI', () => {
    const processor = createFrameProcessor();
    const frame = cleanFrame(0xdd, 44);
    const expected = { transferId: 44, oti: frame.oti };

    // wrong transfer id
    const wrongId = processor.process(frame.img, { transferId: 999, oti: frame.oti });
    expect(wrongId.type).toBe('status');
    if (wrongId.type === 'status') expect(wrongId.outcome).toBe('filtered');

    // same transfer id, different OTI — must never reach payload work
    const otherOti = frame.oti.slice();
    otherOti[0] = (otherOti[0] as number) ^ 0xff;
    const wrongOti = processor.process(frame.img, { transferId: 44, oti: otherOti });
    expect(wrongOti.type).toBe('status');
    if (wrongOti.type === 'status') expect(wrongOti.outcome).toBe('filtered');

    // the true identity still decodes
    const match = processor.process(frame.img, expected);
    expect(match.type).toBe('packet');
    const stats = processor.stats();
    expect(stats.rejects.filtered).toBe(2);
    expect(stats.decoded).toBe(1);
    expect(stats.displayedSeen).toBe(3);
  });

  it('vetoes frames whose packet bytes disagree with the header PayloadId', () => {
    const processor = createFrameProcessor();
    const frame = cleanFrame(0xee, 45, { payloadIdMismatch: true });
    const result = processor.process(frame.img, null);
    expect(result.type).toBe('status');
    if (result.type !== 'status') return;
    expect(result.outcome).toBe('payload-mismatch');
    expect(result.stats.rejects['payload-mismatch']).toBe(1);
    expect(result.stats.decoded).toBe(0);
  });

  it('absorbs malformed frames as errors and keeps decoding afterwards', () => {
    const processor = createFrameProcessor();
    expect(processor.process(null, null).type).toBe('status');
    const garbage: RgbaImage = { width: 64, height: 64, pixels: new Uint8ClampedArray(7) };
    const bad = processor.process(garbage, null);
    expect(bad.type).toBe('status');
    if (bad.type === 'status') expect(bad.outcome).toBe('error');
    const zero: RgbaImage = { width: 0, height: 0, pixels: new Uint8ClampedArray(0) };
    expect(processor.process(zero, null).type).toBe('status');

    const frame = cleanFrame(0xff, 46);
    const after = processor.process(frame.img, null);
    expect(after.type).toBe('packet');
    const stats = processor.stats();
    expect(stats.rejects.error).toBe(3);
    expect(stats.frames).toBe(4);
    expect(stats.decoded).toBe(1);
  });

  it('classifies featureless frames as blur and tracks the recent fraction', () => {
    const processor = createFrameProcessor();
    const blur = processor.process(flatImage(), null);
    expect(blur.type).toBe('status');
    if (blur.type === 'status') expect(blur.outcome).toBe('blur');
    const stats = processor.stats();
    expect(stats.rejects.blur).toBe(1);
    expect(stats.recentBlurFraction).toBe(1);
    expect(stats.finderStreak).toBe(0);
  });

  it('locks the grid after three agreeing frames and resets on demand', () => {
    const processor = createFrameProcessor();
    const frame = cleanFrame(0xab, 47);
    expect(processor.gridLock()).toBeNull();
    processor.process(frame.img, null);
    processor.process(frame.img, null);
    processor.process(frame.img, null);
    expect(processor.gridLock()).toBe(N);
    processor.reset();
    expect(processor.gridLock()).toBeNull();
    expect(processor.stats().frames).toBe(0);
    // after reset the same frame is no longer a duplicate
    expect(processor.process(frame.img, null).type).toBe('packet');
  });
});
