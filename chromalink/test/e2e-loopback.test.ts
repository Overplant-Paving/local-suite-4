/**
 * End-to-end Node loopback (spec phase 4): 1 MiB random file -> transfer
 * container -> RaptorQ fountain at N100 -> frame encode -> synthetic camera
 * distortion -> production receive path (staged vision + frame decode +
 * session lock) -> fountain decode, under a uniform 20% pre-pipeline frame
 * loss. Per-frame distortion uses the full phase-3 parameters: rotation
 * +/-8 deg, independent corner perspective +/-4% of span, Gaussian noise
 * sigma 8, brightness +/-20. The transfer must complete within K * 1.35
 * emitted packets and reproduce the SHA-256 exactly.
 *
 * The receiving side constructs its RaptorQ decoder from the first decoded
 * frame header's OTI (never from the sender's encoder object), locks that
 * transferId + OTI, and the lock is compared against the sender at the
 * end. A post-RS payload byte flip must be rejected by the frame CRC
 * before anything reaches the fountain decoder.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { crc32 } from '../src/lib/crc';
import { decodeFrame, decodeFrameHeader, decodeFramePayload } from '../src/lib/frame-decode';
import { encodeFrame } from '../src/lib/frame-encode';
import {
  alignedSymbolSize,
  createDecoder,
  createEncoder,
  initFountain,
  parseOti,
} from '../src/lib/fountain';
import { buildProtectedHeader } from '../src/lib/header';
import { capacity } from '../src/lib/layout';
import { createFrameProcessor } from '../src/lib/receive-pipeline';
import { createReceiveSession } from '../src/lib/receive-session';
import {
  buildTransferBlob,
  bytesEqual,
  parseTransferBlob,
  restoreOriginal,
} from '../src/lib/transfer';
import { mulberry32, randomBytes } from './prng';
import { distort, renderFrameRgb, rotatedCorners } from './synthetic';

const OUT = 720;
const HALF_SPAN = 300;
const N = 100 as const;

beforeAll(async () => {
  await initFountain();
});

/** Phase-3 distortion: +/-8 deg rotation, +/-4% corner perspective,
 * sigma-8 noise, +/-20 brightness. */
function captureFrame(
  indices: Uint8Array,
  rand: () => number,
): ReturnType<typeof distort> {
  const src = renderFrameRgb(indices, N, 6);
  const rotation = (rand() * 2 - 1) * 8;
  const corners = rotatedCorners(OUT / 2, OUT / 2, HALF_SPAN, rotation).map(
    ([x, y]) =>
      [
        x + (rand() * 2 - 1) * 0.04 * 2 * HALF_SPAN,
        y + (rand() * 2 - 1) * 0.04 * 2 * HALF_SPAN,
      ] as [number, number],
  );
  return distort(src, {
    outWidth: OUT,
    outHeight: OUT,
    corners,
    noiseSigma: 8,
    brightness: (rand() * 2 - 1) * 20,
    rand,
  });
}

describe('end-to-end loopback', () => {
  it('moves 1 MiB through the full optical pipeline with 20% frame loss', () => {
    const rand = mulberry32(0xe2e);
    const original = randomBytes(rand, 1024 * 1024);
    const digest = sha256(original);
    const blob = buildTransferBlob('loopback.bin', original, digest);

    const payloadBytes = capacity(N).payloadBytes;
    const symbolSize = alignedSymbolSize(payloadBytes);
    const encoder = createEncoder(blob, symbolSize);
    const info = parseOti(encoder.oti);
    expect(info).not.toBeNull();
    const k = info?.sourceSymbols as number;

    const transferId = 0x0ddba11 >>> 0;
    // The receiver: production frame processor + session. The session
    // builds its decoder from the first decoded header's OTI — the
    // encoder object is never handed to the receiving side.
    const processor = createFrameProcessor();
    const session = createReceiveSession(createDecoder);

    let emitted = 0;
    let raw: Uint8Array | null = null;
    const emitBudget = Math.ceil(k * 1.35);

    while (raw === null && emitted < emitBudget) {
      const packet = encoder.nextPacket();
      const sequence = emitted;
      emitted += 1;
      if (rand() < 0.2) continue; // uniform pre-pipeline frame loss

      const payload = new Uint8Array(payloadBytes);
      payload.set(packet, 0);
      const header = buildProtectedHeader({
        transferId,
        oti: encoder.oti,
        payloadId: packet.slice(0, 4),
        payloadCrc32: crc32(payload),
      });
      const indices = encodeFrame({
        n: N,
        header,
        payload,
        sequenceParity: (sequence & 1) as 0 | 1,
      });
      const img = captureFrame(indices, rand);

      const result = processor.process(img, session.expected());
      if (result.type !== 'packet') continue;
      const accepted = session.accept({
        packet: result.packet,
        transferId: result.transferId,
        oti: result.oti,
        payloadId: result.payloadId,
        n: result.n,
      });
      if (accepted.kind === 'complete') raw = accepted.raw;
    }

    expect(raw).not.toBeNull();
    expect(emitted).toBeLessThanOrEqual(emitBudget);

    // the locked identity must match what the sender actually streamed
    const locked = session.expected();
    expect(locked).not.toBeNull();
    expect(locked?.transferId).toBe(transferId);
    expect(bytesEqual(locked?.oti as Uint8Array, encoder.oti)).toBe(true);

    // progress denominator sanity: unique ids reached K-ish before finishing
    const stats = processor.stats();
    expect(session.uniqueCount()).toBeGreaterThanOrEqual(k - 2);
    expect(stats.decoded).toBeGreaterThanOrEqual(session.uniqueCount());

    const parsed = parseTransferBlob(raw as Uint8Array);
    expect(parsed).not.toBeNull();
    expect(parsed?.filename).toBe('loopback.bin');
    const restored = restoreOriginal(parsed as NonNullable<typeof parsed>);
    expect(restored).not.toBeNull();
    expect(bytesEqual(sha256(restored as Uint8Array), digest)).toBe(true);
    expect(bytesEqual(restored as Uint8Array, original)).toBe(true);

    const unique = session.uniqueCount();
    encoder.dispose();
    session.dispose();
    // eslint-disable-next-line no-console
    console.info(
      `e2e: K=${k} emitted=${emitted} (budget ${emitBudget}) decoded=${stats.decoded} unique=${unique}`,
    );
  }, 600_000);

  it('rejects a post-RS payload byte flip via frame CRC before the decoder', () => {
    const rand = mulberry32(0xc4c);
    const data = randomBytes(rand, 64 * 1024);
    const encoder = createEncoder(data, alignedSymbolSize(capacity(N).payloadBytes));
    const packet = encoder.nextPacket();
    const payloadBytes = capacity(N).payloadBytes;

    const payload = new Uint8Array(payloadBytes);
    payload.set(packet, 0);
    const header = buildProtectedHeader({
      transferId: 7,
      oti: encoder.oti,
      payloadId: packet.slice(0, 4),
      payloadCrc32: crc32(payload),
    });

    // The channel delivers a frame whose inner-RS content decodes cleanly
    // to a payload that differs from what the header's CRC32 was computed
    // over — exactly what a miscorrection or encoder fault would produce.
    const flipped = payload.slice();
    flipped[100] = (flipped[100] as number) ^ 0x55;
    const indices = encodeFrame({ n: N, header, payload: flipped, sequenceParity: 0 });

    const parsedHeader = decodeFrameHeader(indices, N);
    expect(parsedHeader).not.toBeNull(); // header itself is intact...
    expect(decodeFramePayload(indices, N, parsedHeader!)).toBeNull(); // ...payload is vetoed
    expect(decodeFrame(indices, N, null)).toBeNull(); // nothing reaches the fountain decoder

    // the same frame without the flip decodes fine
    const clean = encodeFrame({ n: N, header, payload, sequenceParity: 0 });
    expect(decodeFrame(clean, N, null)).not.toBeNull();
    encoder.dispose();
  });
});
