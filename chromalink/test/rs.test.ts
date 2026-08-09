import { describe, expect, it } from 'vitest';
import { GF_EXP, gfMul, gfPow } from '../src/lib/gf256';
import { decode, encode, generatorPoly } from '../src/lib/rs';
import { crc32 } from '../src/lib/crc';
import { distinctIndices, mulberry32, randomBytes } from './prng';

describe('gf256', () => {
  it('alpha^255 = 1 and exp table wraps', () => {
    expect(gfPow(2, 255)).toBe(1);
    expect(GF_EXP[0]).toBe(1);
    expect(GF_EXP[255]).toBe(1);
  });

  it('multiplication distributes over addition (spot check)', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const a = Math.floor(rand() * 256);
      const b = Math.floor(rand() * 256);
      const c = Math.floor(rand() * 256);
      expect(gfMul(a, b ^ c)).toBe(gfMul(a, b) ^ gfMul(a, c));
    }
  });
});

describe('reed-solomon', () => {
  it('systematic encode matches the generator polynomial construction', () => {
    // data = [0..0, 1] makes the codeword equal g(x) itself
    const parity = 32;
    const dataLen = 64;
    const data = new Uint8Array(dataLen);
    data[dataLen - 1] = 1;
    const cw = encode(data, parity);
    const g = generatorPoly(parity);
    expect(g.length).toBe(parity + 1);
    for (let k = 0; k < g.length; k++) {
      expect(cw[dataLen - 1 + k]).toBe(g[k]);
    }
  });

  it('recovers 1,000 random codewords with 0..16 byte errors exactly', () => {
    const rand = mulberry32(0xc7c7);
    for (let iter = 0; iter < 1000; iter++) {
      const dataLen = 1 + Math.floor(rand() * 223);
      const data = randomBytes(rand, dataLen);
      const cw = encode(data, 32);
      const errors = Math.floor(rand() * 17); // 0..16
      const corrupted = cw.slice();
      for (const pos of distinctIndices(rand, cw.length, errors)) {
        const flip = 1 + Math.floor(rand() * 255);
        corrupted[pos] = (corrupted[pos] as number) ^ flip;
      }
      const decoded = decode(corrupted, 32);
      expect(decoded).not.toBeNull();
      expect([...(decoded as Uint8Array)]).toEqual([...data]);
    }
  });

  it('a 17-error miscorrection is caught by the frame CRC harness', () => {
    // Codewords A (all zero) and B (the generator polynomial) sit at the
    // code's minimum distance 33. Reverting 16 of B's 33 nonzero positions
    // toward A leaves a word 17 errors from A that RS "corrects" to B —
    // a genuine miscorrection that only the payload CRC can catch.
    const parity = 32;
    const total = 239;
    const dataLen = total - parity;
    const dataA = new Uint8Array(dataLen);
    const dataB = new Uint8Array(dataLen);
    dataB[dataLen - 1] = 1;
    const cwA = encode(dataA, parity);
    const cwB = encode(dataB, parity);
    const differing: number[] = [];
    for (let i = 0; i < total; i++) {
      if ((cwA[i] as number) !== (cwB[i] as number)) differing.push(i);
    }
    expect(differing.length).toBe(33); // all generator coefficients nonzero

    const received = cwB.slice();
    for (const pos of differing.slice(0, 16)) {
      received[pos] = cwA[pos] as number;
    }
    let errorsFromA = 0;
    for (let i = 0; i < total; i++) {
      if ((received[i] as number) !== (cwA[i] as number)) errorsFromA += 1;
    }
    expect(errorsFromA).toBe(17);

    const decoded = decode(received, parity);
    expect(decoded).not.toBeNull(); // RS is fooled...
    expect([...(decoded as Uint8Array)]).not.toEqual([...dataA]);
    // ...and the frame CRC is not.
    expect(crc32(decoded as Uint8Array)).not.toBe(crc32(dataA));
  });

  it('returns null on empty/oversized codewords instead of throwing', () => {
    expect(decode(new Uint8Array(0), 32)).toBeNull();
    expect(decode(new Uint8Array(20), 32)).toBeNull();
    expect(decode(new Uint8Array(300), 32)).toBeNull();
  });
});
