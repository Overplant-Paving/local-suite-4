import { describe, expect, it } from 'vitest';
import { buildProtectedHeader, decodeProtectedHeader, encodeHeader, protectHeader, type FrameHeader } from '../src/lib/header';
import { crc16ccitt } from '../src/lib/crc';
import { distinctIndices, mulberry32, randomBytes } from './prng';

function sampleHeader(rand: () => number): FrameHeader {
  return {
    transferId: Math.floor(rand() * 0x100000000),
    oti: randomBytes(rand, 12),
    payloadId: randomBytes(rand, 4),
    payloadCrc32: Math.floor(rand() * 0x100000000),
  };
}

describe('frame header', () => {
  it('round-trips clean headers', () => {
    const rand = mulberry32(11);
    for (let i = 0; i < 50; i++) {
      const h = sampleHeader(rand);
      const protectedBytes = buildProtectedHeader(h);
      expect(protectedBytes.length).toBe(42);
      const back = decodeProtectedHeader(protectedBytes);
      expect(back).not.toBeNull();
      const b = back as FrameHeader;
      expect(b.transferId).toBe(h.transferId);
      expect([...b.oti]).toEqual([...h.oti]);
      expect([...b.payloadId]).toEqual([...h.payloadId]);
      expect(b.payloadCrc32).toBe(h.payloadCrc32);
    }
  });

  it('recovers from exactly 7 corrupted bytes', () => {
    const rand = mulberry32(22);
    for (let i = 0; i < 300; i++) {
      const h = sampleHeader(rand);
      const protectedBytes = buildProtectedHeader(h);
      const corrupted = protectedBytes.slice();
      for (const pos of distinctIndices(rand, 42, 7)) {
        corrupted[pos] = (corrupted[pos] as number) ^ (1 + Math.floor(rand() * 255));
      }
      const back = decodeProtectedHeader(corrupted);
      expect(back).not.toBeNull();
      expect((back as FrameHeader).transferId).toBe(h.transferId);
      expect([...(back as FrameHeader).payloadId]).toEqual([...h.payloadId]);
    }
  });

  it('rejects 8 corrupted bytes', () => {
    const rand = mulberry32(33);
    for (let i = 0; i < 300; i++) {
      const h = sampleHeader(rand);
      const corrupted = buildProtectedHeader(h).slice();
      for (const pos of distinctIndices(rand, 42, 8)) {
        corrupted[pos] = (corrupted[pos] as number) ^ (1 + Math.floor(rand() * 255));
      }
      expect(decodeProtectedHeader(corrupted)).toBeNull();
    }
  });

  it('rejects wrong magic, wrong version, and a forged CRC16', () => {
    const rand = mulberry32(44);
    const h = sampleHeader(rand);

    const wrongMagic = encodeHeader(h);
    wrongMagic[0] = 0xa5;
    const crcA = crc16ccitt(wrongMagic.subarray(0, 26));
    wrongMagic[26] = (crcA >>> 8) & 0xff;
    wrongMagic[27] = crcA & 0xff;
    expect(decodeProtectedHeader(protectHeader(wrongMagic))).toBeNull();

    const wrongVersion = encodeHeader(h);
    wrongVersion[1] = 9;
    const crcB = crc16ccitt(wrongVersion.subarray(0, 26));
    wrongVersion[26] = (crcB >>> 8) & 0xff;
    wrongVersion[27] = crcB & 0xff;
    expect(decodeProtectedHeader(protectHeader(wrongVersion))).toBeNull();

    const badCrc = encodeHeader(h);
    badCrc[26] = (badCrc[26] as number) ^ 0xff;
    expect(decodeProtectedHeader(protectHeader(badCrc))).toBeNull();

    expect(decodeProtectedHeader(new Uint8Array(41))).toBeNull();
  });
});
