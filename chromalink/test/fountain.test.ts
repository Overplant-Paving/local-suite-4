import { beforeAll, describe, expect, it } from 'vitest';
import {
  alignedSymbolSize,
  buildOti,
  createDecoder,
  createEncoder,
  initFountain,
  parseOti,
} from '../src/lib/fountain';
import { capacity } from '../src/lib/layout';
import { PACKET_ID_BYTES } from '../src/lib/constants';
import { mulberry32, randomBytes } from './prng';

beforeAll(async () => {
  await initFountain();
});

describe('fountain wrapper', () => {
  it('OTI round-trips and derives K', () => {
    const oti = buildOti(102400, 2888, 1);
    expect(oti.length).toBe(12);
    const info = parseOti(oti);
    expect(info).not.toBeNull();
    expect(info?.transferLength).toBe(102400);
    expect(info?.symbolSize).toBe(2888);
    expect(info?.sourceSymbols).toBe(Math.ceil(102400 / 2888));
    expect(info?.packetBytes).toBe(2888 + PACKET_ID_BYTES);
    expect(parseOti(new Uint8Array(11))).toBeNull();
    expect(parseOti(buildOti(1000, 900, 1))).toBeNull(); // unaligned symbol
  });

  it('aligned symbol sizes fit the per-frame payload budget', () => {
    for (const n of [60, 100, 140] as const) {
      const p = capacity(n).payloadBytes;
      const symbol = alignedSymbolSize(p);
      expect(symbol % 8).toBe(0);
      expect(symbol + PACKET_ID_BYTES).toBeLessThanOrEqual(p);
      expect(p - (symbol + PACKET_ID_BYTES)).toBeLessThan(8 + PACKET_ID_BYTES);
    }
    expect(alignedSymbolSize(934)).toBe(928);
    expect(alignedSymbolSize(2896)).toBe(2888);
    expect(alignedSymbolSize(5930)).toBe(5920);
  });

  it('round-trips 100 KiB from systematic packets alone', () => {
    const rand = mulberry32(0xf0f0);
    const data = randomBytes(rand, 100 * 1024);
    const symbol = alignedSymbolSize(capacity(100).payloadBytes);
    const encoder = createEncoder(data, symbol);

    const info = parseOti(encoder.oti);
    expect(info).not.toBeNull();
    const k = info?.sourceSymbols as number;
    expect(k).toBe(Math.ceil((100 * 1024) / symbol));

    const packets: Uint8Array[] = [];
    for (let i = 0; i < k; i++) {
      const pkt = encoder.nextPacket();
      expect(pkt.length).toBe(symbol + PACKET_ID_BYTES);
      packets.push(pkt);
    }
    // shuffle deterministically — the decoder must not care about order
    for (let i = packets.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const a = packets[i] as Uint8Array;
      packets[i] = packets[j] as Uint8Array;
      packets[j] = a;
    }

    const decoder = createDecoder(encoder.oti);
    let result: Uint8Array | null = null;
    for (const pkt of packets) {
      result = decoder.addPacket(pkt);
      if (result !== null) break;
    }
    expect(result).not.toBeNull();
    expect(result?.length).toBe(data.length);
    expect(Buffer.from(result as Uint8Array).equals(Buffer.from(data))).toBe(true);
    encoder.dispose();
    decoder.dispose();
  });

  it('recovers from dropped systematic packets using repair packets', () => {
    const rand = mulberry32(0xbeef);
    const data = randomBytes(rand, 40 * 1024);
    const encoder = createEncoder(data, 928);
    const info = parseOti(encoder.oti);
    const k = info?.sourceSymbols as number;
    const decoder = createDecoder(encoder.oti);
    let result: Uint8Array | null = null;
    let emitted = 0;
    // drop every 5th packet; keep pulling (into repair) until complete
    while (result === null && emitted < k * 3) {
      const pkt = encoder.nextPacket();
      emitted += 1;
      if (emitted % 5 === 0) continue;
      result = decoder.addPacket(pkt);
    }
    expect(result).not.toBeNull();
    expect(Buffer.from(result as Uint8Array).equals(Buffer.from(data))).toBe(true);
    encoder.dispose();
    decoder.dispose();
  });

  it('rejects hostile and impossible OTI fields', () => {
    // the largest legal F: a 64 MiB file plus maximal container overhead
    const maxContainer = 64 * 1024 * 1024 + 1 + 255 + 8 + 32 + 1;
    expect(parseOti(buildOti(maxContainer, 5920, 2))).not.toBeNull();
    // F beyond the 64 MiB transfer container is impossible for this wrapper
    expect(parseOti(buildOti(maxContainer + 1, 5920, 2))).toBeNull();
    // a ~1 TB 40-bit F must never reach the decoder
    expect(parseOti(buildOti(2 ** 39, 5920, 2))).toBeNull();
    expect(parseOti(buildOti(0, 928, 1))).toBeNull();

    // symbol sizes no supported grid can carry are impossible
    expect(parseOti(buildOti(102400, 8, 1))).toBeNull();
    expect(parseOti(buildOti(102400, 16, 1))).toBeNull();
    expect(parseOti(buildOti(102400, 5928, 1))).toBeNull();
    expect(parseOti(buildOti(102400, 0xfff8, 1))).toBeNull();
    for (const n of [60, 100, 140] as const) {
      expect(parseOti(buildOti(102400, alignedSymbolSize(capacity(n).payloadBytes), 1))).not.toBeNull();
    }

    // reserved / N / Al carry fixed values in this wrapper
    const good = buildOti(102400, 2888, 1);
    for (const [offset, value] of [
      [5, 1], // reserved must be 0
      [9, 1], // N hi must be 0
      [10, 2], // N lo must be 1
      [11, 4], // Al must be 8
    ] as const) {
      const bad = good.slice();
      bad[offset] = value;
      expect(parseOti(bad), `oti[${offset}]=${value} must be rejected`).toBeNull();
    }

    // source blocks: at least 1, at most one per source symbol
    expect(parseOti(buildOti(102400, 2888, 0))).toBeNull();
    expect(parseOti(buildOti(102400, 2888, 36))).not.toBeNull(); // K=36
    expect(parseOti(buildOti(102400, 2888, 37))).toBeNull(); // Z > K
  });

  it('createDecoder throws (catchably) rather than accepting a bad OTI', () => {
    expect(() => createDecoder(buildOti(2 ** 39, 5920, 2))).toThrow();
    expect(() => createDecoder(new Uint8Array(12))).toThrow();
  });

  it('ignores wrong-size packets and stays complete after finishing', () => {
    const data = randomBytes(mulberry32(5), 10000);
    const encoder = createEncoder(data, 928);
    const decoder = createDecoder(encoder.oti);
    expect(decoder.addPacket(new Uint8Array(3))).toBeNull();
    let result: Uint8Array | null = null;
    while (result === null) {
      result = decoder.addPacket(encoder.nextPacket());
    }
    // further packets keep returning the finished object, not an error
    const again = decoder.addPacket(encoder.nextPacket());
    expect(again).not.toBeNull();
    encoder.dispose();
    decoder.dispose();
  });
});
