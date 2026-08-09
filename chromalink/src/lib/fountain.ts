/**
 * RaptorQ (RFC 6330) wrapper — the only module that touches the raptorq wasm.
 *
 * Empirically verified against raptorq@1.7.24 (wasm-bindgen web target):
 *  - Encoder.with_defaults(data, mtu) uses symbol size = mtu - (mtu % 8)
 *    (8-byte alignment) and emits packets of symbolSize + 4 bytes
 *    (PayloadId u8 source block + u24 encoding symbol id, big-endian).
 *  - encoder.encode(r) returns every source packet followed by r repair
 *    packets per source block; repair ESIs are deterministic across calls.
 *  - Decoder.with_defaults(transferLength, mtu) accepts packets in any order
 *    and returns the object once decodable.
 *
 * The package exposes no OTI serialization, so the 12-byte RFC 6330 OTI
 * (F u40 | reserved u8 | T u16 || Z u8 | N u16 | Al u8) is built and parsed
 * here. The decoder side uses F and T; Z is recorded from the encoder's
 * actual source packets; N and Al carry the implementation's fixed values.
 */

import initRaptorq, { Decoder, Encoder } from 'raptorq';
import wasmBase64 from 'virtual:raptorq-wasm-base64';
import {
  GRID_SIZES,
  MAX_TRANSFER_CONTAINER_BYTES,
  OTI_BYTES,
  PACKET_ID_BYTES,
  REPAIR_BATCH,
} from './constants';
import { capacity } from './layout';

export interface FountainEncoder {
  oti: Uint8Array;
  nextPacket(): Uint8Array;
  dispose(): void;
}

export interface FountainDecoder {
  addPacket(pkt: Uint8Array): Uint8Array | null;
  dispose(): void;
}

let initPromise: Promise<void> | null = null;

function base64ToBytes(b64: string): Uint8Array {
  const table = new Int16Array(128).fill(-1);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  let effective = b64.length;
  while (effective > 0 && b64.charCodeAt(effective - 1) === 0x3d) effective -= 1;
  const out = new Uint8Array(Math.floor((effective * 3) / 4));
  let acc = 0;
  let bits = 0;
  let pos = 0;
  for (let i = 0; i < effective; i++) {
    const v = table[b64.charCodeAt(i)] as number;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[pos] = (acc >> bits) & 0xff;
      pos += 1;
    }
  }
  return out.subarray(0, pos);
}

export function initFountain(): Promise<void> {
  if (initPromise === null) {
    initPromise = initRaptorq(base64ToBytes(wasmBase64).slice().buffer).then(() => undefined);
  }
  return initPromise;
}

/** Largest wasm-supported symbol size whose packet fits maxPacketBytes. */
export function alignedSymbolSize(maxPacketBytes: number): number {
  const symbol = Math.floor((maxPacketBytes - PACKET_ID_BYTES) / 8) * 8;
  if (symbol <= 0) throw new RangeError('fountain: packet budget too small');
  return symbol;
}

export function buildOti(transferLength: number, symbolSize: number, sourceBlocks: number): Uint8Array {
  const oti = new Uint8Array(OTI_BYTES);
  // F: 40-bit transfer length
  oti[0] = Math.floor(transferLength / 2 ** 32) & 0xff;
  oti[1] = (transferLength >>> 24) & 0xff;
  oti[2] = (transferLength >>> 16) & 0xff;
  oti[3] = (transferLength >>> 8) & 0xff;
  oti[4] = transferLength & 0xff;
  oti[5] = 0; // reserved
  oti[6] = (symbolSize >>> 8) & 0xff;
  oti[7] = symbolSize & 0xff;
  oti[8] = sourceBlocks & 0xff; // Z
  oti[9] = 0; // N (sub-blocks) hi
  oti[10] = 1; // N lo
  oti[11] = 8; // Al — raptorq@1.7.24 aligns symbols to 8 bytes
  return oti;
}

export interface OtiInfo {
  transferLength: number;
  symbolSize: number;
  sourceBlocks: number;
  /** Total source symbols across blocks: ceil(F / T). */
  sourceSymbols: number;
  /** Wire packet size: PayloadId + symbol. */
  packetBytes: number;
}

/** The only symbol sizes this wrapper ever emits: one per supported grid. */
const VALID_SYMBOL_SIZES: ReadonlySet<number> = new Set(
  GRID_SIZES.map((n) => alignedSymbolSize(capacity(n).payloadBytes)),
);

/** RFC 6330 caps source symbols per block at K'_max = 56403. */
const MAX_SYMBOLS_PER_BLOCK = 56403;

/**
 * Parse and bound a received OTI. Everything a hostile frame could declare
 * is rejected here: F beyond the largest possible transfer container,
 * symbol sizes no supported grid carries, non-fixed reserved/N/Al fields,
 * and source-block counts the declared symbol count cannot fill.
 */
export function parseOti(oti: Uint8Array): OtiInfo | null {
  if (oti.length !== OTI_BYTES) return null;
  const transferLength =
    (oti[0] as number) * 2 ** 32 +
    ((oti[1] as number) << 24 >>> 0) +
    ((oti[2] as number) << 16) +
    ((oti[3] as number) << 8) +
    (oti[4] as number);
  const symbolSize = ((oti[6] as number) << 8) | (oti[7] as number);
  const sourceBlocks = oti[8] as number;
  if (transferLength <= 0 || transferLength > MAX_TRANSFER_CONTAINER_BYTES) return null;
  if (symbolSize <= 0 || symbolSize % 8 !== 0) return null;
  if (!VALID_SYMBOL_SIZES.has(symbolSize)) return null;
  if ((oti[5] as number) !== 0) return null; // reserved
  if ((oti[9] as number) !== 0 || (oti[10] as number) !== 1) return null; // N == 1
  if ((oti[11] as number) !== 8) return null; // Al == 8
  const sourceSymbols = Math.ceil(transferLength / symbolSize);
  if (sourceBlocks < 1 || sourceBlocks > sourceSymbols) return null;
  if (sourceSymbols > sourceBlocks * MAX_SYMBOLS_PER_BLOCK) return null;
  return {
    transferLength,
    symbolSize,
    sourceBlocks,
    sourceSymbols,
    packetBytes: symbolSize + PACKET_ID_BYTES,
  };
}

/**
 * Wraps the wasm encoder with the sender schedule: every systematic source
 * symbol in order (round-robin across source blocks), then repair symbols
 * round-robin forever, fetched in deterministic batches of REPAIR_BATCH per
 * block.
 */
export function createEncoder(data: Uint8Array, symbolSize: number): FountainEncoder {
  if (symbolSize <= 0 || symbolSize % 8 !== 0) {
    throw new RangeError('fountain: symbolSize must be a positive multiple of 8');
  }
  if (data.length === 0) throw new RangeError('fountain: empty transfer');
  const encoder = Encoder.with_defaults(data, symbolSize);
  const source = encoder.encode(0);
  // Group source packets by source block number, preserving symbol order.
  const blocks: Uint8Array[][] = [];
  for (const pkt of source) {
    const sbn = pkt[0] as number;
    while (blocks.length <= sbn) blocks.push([]);
    (blocks[sbn] as Uint8Array[]).push(pkt);
  }
  const blockCount = blocks.length;
  const sourceCounts = blocks.map((b) => b.length);
  const oti = buildOti(data.length, symbolSize, blockCount);

  // Round-robin interleave of the systematic packets (blocks may be ragged).
  const systematic: Uint8Array[] = [];
  const maxPerBlock = Math.max(...sourceCounts);
  for (let s = 0; s < maxPerBlock; s++) {
    for (let b = 0; b < blockCount; b++) {
      const block = blocks[b] as Uint8Array[];
      const pkt = block[s];
      if (pkt !== undefined) systematic.push(pkt);
    }
  }

  let cursor = 0;
  let repairQueue: Uint8Array[] = [];
  let repairBatch = 0;
  let disposed = false;

  function fetchRepairBatch(): void {
    // encode((b+1)*REPAIR_BATCH) re-emits source packets plus every repair
    // batch so far; keep only this batch's slice, round-robin across blocks.
    const all = encoder.encode((repairBatch + 1) * REPAIR_BATCH);
    const perBlock: Uint8Array[][] = Array.from({ length: blockCount }, () => []);
    const seen = new Array<number>(blockCount).fill(0);
    for (const pkt of all) {
      const sbn = pkt[0] as number;
      const index = seen[sbn] as number;
      seen[sbn] = index + 1;
      const sourceCount = sourceCounts[sbn] as number;
      const repairIndex = index - sourceCount;
      if (repairIndex >= repairBatch * REPAIR_BATCH && repairIndex < (repairBatch + 1) * REPAIR_BATCH) {
        (perBlock[sbn] as Uint8Array[]).push(pkt);
      }
    }
    const queue: Uint8Array[] = [];
    for (let s = 0; s < REPAIR_BATCH; s++) {
      for (let b = 0; b < blockCount; b++) {
        const pkt = (perBlock[b] as Uint8Array[])[s];
        if (pkt !== undefined) queue.push(pkt);
      }
    }
    repairQueue = queue;
    repairBatch += 1;
    cursor = 0;
  }

  return {
    oti,
    nextPacket(): Uint8Array {
      if (disposed) throw new Error('fountain: encoder disposed');
      if (repairBatch === 0) {
        if (cursor < systematic.length) {
          const pkt = systematic[cursor] as Uint8Array;
          cursor += 1;
          return pkt;
        }
        fetchRepairBatch();
      }
      if (cursor >= repairQueue.length) fetchRepairBatch();
      if (repairQueue.length === 0) {
        // ESI space exhausted (u24, ~16.7M repair symbols): restart the
        // repair schedule; re-sent symbols are deduplicated by the receiver.
        repairBatch = 0;
        fetchRepairBatch();
      }
      const pkt = repairQueue[cursor] as Uint8Array;
      cursor += 1;
      return pkt;
    },
    dispose(): void {
      if (!disposed) {
        disposed = true;
        encoder.free();
      }
    },
  };
}

export function createDecoder(oti: Uint8Array): FountainDecoder {
  const info = parseOti(oti);
  if (info === null) throw new RangeError('fountain: invalid OTI');
  const decoder = Decoder.with_defaults(BigInt(info.transferLength), info.symbolSize);
  let done: Uint8Array | null = null;
  let disposed = false;
  return {
    addPacket(pkt: Uint8Array): Uint8Array | null {
      if (disposed || done !== null) return done;
      if (pkt.length !== info.packetBytes) return null;
      const result = decoder.add(pkt);
      if (result !== undefined) done = result;
      return done;
    },
    dispose(): void {
      if (!disposed) {
        disposed = true;
        decoder.free();
      }
    },
  };
}
