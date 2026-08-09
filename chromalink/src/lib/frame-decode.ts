/**
 * Frame decoder: classified n*n palette indices -> validated header and
 * payload. Header validation always precedes payload work; every failure
 * path returns null and nothing here throws on malformed input.
 *
 * When per-module classification margins are supplied, codewords that fail
 * plain decoding retry with escalating erasure sets over their least
 * confident bytes — errors-and-erasures decoding corrects 2e + E <=
 * parityLen, doubling the value of correction for flagged positions.
 */

import { RS_PARITY, type GridSize } from './constants';
import { indexToBinaryBit } from './palette';
import {
  capacity,
  dataModuleOrder,
  deinterleaveCodewords,
  headerModuleOrder,
  PROTECTED_HEADER_BITS,
  PROTECTED_HEADER_BYTES,
  rsChunkLengths,
} from './layout';
import { decodeProtectedHeader, type FrameHeader } from './header';
import { decode as rsDecode } from './rs';
import { crc32 } from './crc';

export interface DecodedFrame {
  header: FrameHeader;
  payload: Uint8Array;
}

const ERASURE_STEPS = [10, 20, 28] as const;

function headerCopyBytes(indices: Uint8Array, order: Uint32Array, copy: number): Uint8Array | null {
  const start = copy * PROTECTED_HEADER_BITS;
  if (start + PROTECTED_HEADER_BITS > order.length) return null;
  const bytes = new Uint8Array(PROTECTED_HEADER_BYTES);
  for (let k = 0; k < PROTECTED_HEADER_BITS; k++) {
    const moduleIndex = order[start + k] as number;
    const bit = indexToBinaryBit(indices[moduleIndex] as number);
    bytes[k >> 3] = (bytes[k >> 3] as number) | (bit << (7 - (k & 7)));
  }
  return bytes;
}

/** Decode the protected header (first copy, then the second if present). */
export function decodeFrameHeader(indices: Uint8Array, n: GridSize): FrameHeader | null {
  if (indices.length !== n * n) return null;
  const order = headerModuleOrder(n);
  for (let copy = 0; copy < 2; copy++) {
    const bytes = headerCopyBytes(indices, order, copy);
    if (bytes === null) break;
    const header = decodeProtectedHeader(bytes);
    if (header !== null) return header;
  }
  return null;
}

function decodeCodeword(
  codeword: Uint8Array,
  weakness: Float32Array | null,
): Uint8Array | null {
  const plain = rsDecode(codeword, RS_PARITY);
  if (plain !== null || weakness === null) return plain;
  // escalate erasures over the least confident byte positions
  const offsets = Array.from({ length: codeword.length }, (_, i) => i);
  offsets.sort((a, b) => (weakness[a] as number) - (weakness[b] as number));
  for (const count of ERASURE_STEPS) {
    const recovered = rsDecode(codeword, RS_PARITY, offsets.slice(0, count));
    if (recovered !== null) return recovered;
  }
  return null;
}

/** RS-decode and CRC-verify the payload for an already-validated header. */
export function decodeFramePayload(
  indices: Uint8Array,
  n: GridSize,
  header: FrameHeader,
  margins?: Float32Array,
): Uint8Array | null {
  if (indices.length !== n * n) return null;
  const cap = capacity(n);
  const order = dataModuleOrder(n);
  const raw = new Uint8Array(cap.rawBytes);
  const rawBits = cap.rawBytes * 8;
  const useMargins = margins !== undefined && margins.length === n * n;
  const rawWeakness = useMargins
    ? new Float32Array(cap.rawBytes).fill(Number.POSITIVE_INFINITY)
    : null;
  for (let m = 0; m < order.length; m++) {
    const moduleIndex = order[m] as number;
    const index = indices[moduleIndex] as number;
    const base = m * 3;
    for (let b = 0; b < 3; b++) {
      const bitIndex = base + b;
      if (bitIndex >= rawBits) break;
      const bit = (index >> (2 - b)) & 1;
      const byteIndex = bitIndex >> 3;
      raw[byteIndex] = (raw[byteIndex] as number) | (bit << (7 - (bitIndex & 7)));
      if (rawWeakness !== null) {
        const margin = (margins as Float32Array)[moduleIndex] as number;
        if (margin < (rawWeakness[byteIndex] as number)) rawWeakness[byteIndex] = margin;
      }
    }
  }
  const codewords = deinterleaveCodewords(raw, n);
  if (codewords === null) return null;

  // mirror the byte-wise deinterleave for the weakness values
  let codewordWeakness: Float32Array[] | null = null;
  if (rawWeakness !== null) {
    const lengths = rsChunkLengths(n).map((len) => len + RS_PARITY);
    codewordWeakness = lengths.map((len) => new Float32Array(len));
    const maxLen = Math.max(...lengths);
    let pos = 0;
    for (let j = 0; j < maxLen; j++) {
      for (let i = 0; i < lengths.length; i++) {
        if (j < (lengths[i] as number)) {
          (codewordWeakness[i] as Float32Array)[j] = rawWeakness[pos] as number;
          pos += 1;
        }
      }
    }
  }

  const payload = new Uint8Array(cap.payloadBytes);
  let offset = 0;
  for (let i = 0; i < codewords.length; i++) {
    const data = decodeCodeword(
      codewords[i] as Uint8Array,
      codewordWeakness !== null ? (codewordWeakness[i] as Float32Array) : null,
    );
    if (data === null) return null;
    payload.set(data, offset);
    offset += data.length;
  }
  if (offset !== cap.payloadBytes) return null;
  if (crc32(payload) !== header.payloadCrc32) return null;
  return payload;
}

/**
 * Full frame decode. When expectedTransferId is non-null, a header carrying
 * any other transfer id is rejected before payload work.
 */
export function decodeFrame(
  indices: Uint8Array,
  n: GridSize,
  expectedTransferId: number | null,
  margins?: Float32Array,
): DecodedFrame | null {
  const header = decodeFrameHeader(indices, n);
  if (header === null) return null;
  if (expectedTransferId !== null && header.transferId !== expectedTransferId) return null;
  const payload =
    margins !== undefined
      ? decodeFramePayload(indices, n, header, margins)
      : decodeFramePayload(indices, n, header);
  if (payload === null) return null;
  return { header, payload };
}
