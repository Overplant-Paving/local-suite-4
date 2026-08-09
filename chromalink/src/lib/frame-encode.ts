/**
 * Frame encoder: paints every reserved region and RS-interleaves the payload
 * into 3-bit color modules. Output is n*n palette indices, row-major.
 */

import { RS_PARITY, type GridSize } from './constants';
import {
  BLACK_INDEX,
  WHITE_INDEX,
} from './palette';
import {
  beaconBodyBounds,
  calibrationPatchSpan,
  capacity,
  CORNER,
  dataModuleOrder,
  finderModuleIsBlack,
  finderOrigins,
  headerModuleOrder,
  interleaveCodewords,
  PROTECTED_HEADER_BITS,
  PROTECTED_HEADER_BYTES,
  rsChunkLengths,
} from './layout';
import { encode as rsEncode } from './rs';

export interface FrameEncodeInput {
  n: GridSize;
  /** 42-byte RS-protected header. */
  header: Uint8Array;
  /** Exactly capacity(n).payloadBytes bytes. */
  payload: Uint8Array;
  /**
   * Parity of the displayed sequence number: 0 (even) paints the beacon
   * black, 1 (odd) paints it white. The sender must advance this exactly
   * once per displayed frame so beacon parity never repeats for two
   * different symbols in a row.
   */
  sequenceParity: 0 | 1;
}

function bitOfByte(bytes: Uint8Array, bitIndex: number): number {
  const byte = bytes[bitIndex >> 3] as number;
  return (byte >> (7 - (bitIndex & 7))) & 1;
}

/** Encode one frame; throws only on caller programming errors (bad sizes). */
export function encodeFrame(input: FrameEncodeInput): Uint8Array {
  const { n, header, payload, sequenceParity } = input;
  const cap = capacity(n);
  if (header.length !== PROTECTED_HEADER_BYTES) {
    throw new RangeError('frame-encode: header must be the 42-byte protected header');
  }
  if (payload.length !== cap.payloadBytes) {
    throw new RangeError(`frame-encode: payload must be exactly ${cap.payloadBytes} bytes`);
  }

  const out = new Uint8Array(n * n); // starts all black

  // Corner blocks: white separator field, then the 7x7 QR-style finder.
  for (const [oc, or] of finderOrigins(n)) {
    const blockCol = oc === 0 ? 0 : n - CORNER;
    const blockRow = or === 0 ? 0 : n - CORNER;
    for (let r = blockRow; r < blockRow + CORNER; r++) {
      for (let c = blockCol; c < blockCol + CORNER; c++) {
        out[r * n + c] = WHITE_INDEX;
      }
    }
    for (let dr = 0; dr < 7; dr++) {
      for (let dc = 0; dc < 7; dc++) {
        out[(or + dr) * n + (oc + dc)] = finderModuleIsBlack(dc, dr) ? BLACK_INDEX : WHITE_INDEX;
      }
    }
  }

  // Beacon block: white separator field, then the solid 6x6 body.
  const bb = beaconBodyBounds(n);
  for (let r = n - 7; r < n; r++) {
    for (let c = n - 7; c < n; c++) {
      out[r * n + c] = WHITE_INDEX;
    }
  }
  const beaconColor = sequenceParity === 0 ? BLACK_INDEX : WHITE_INDEX;
  for (let r = bb.min; r <= bb.max; r++) {
    for (let c = bb.min; c <= bb.max; c++) {
      out[r * n + c] = beaconColor;
    }
  }

  // Calibration rows: eight palette patches over rows n-2..n-1.
  for (let patch = 0; patch < 8; patch++) {
    const span = calibrationPatchSpan(n, patch);
    for (let r = n - 2; r < n; r++) {
      for (let c = span.colStart; c <= span.colEnd; c++) {
        out[r * n + c] = patch;
      }
    }
  }

  // Header region: protected header bits repeated from bit zero.
  const headerOrder = headerModuleOrder(n);
  for (let k = 0; k < headerOrder.length; k++) {
    const bit = bitOfByte(header, k % PROTECTED_HEADER_BITS);
    out[headerOrder[k] as number] = bit === 1 ? WHITE_INDEX : BLACK_INDEX;
  }

  // Payload: chunk, RS-encode, interleave, then 3 bits per data module
  // (MSB-first, zero-padded past the final raw byte).
  const chunkLengths = rsChunkLengths(n);
  const codewords: Uint8Array[] = [];
  let offset = 0;
  for (const len of chunkLengths) {
    codewords.push(rsEncode(payload.subarray(offset, offset + len), RS_PARITY));
    offset += len;
  }
  const raw = interleaveCodewords(codewords);
  const rawBits = raw.length * 8;
  const order = dataModuleOrder(n);
  for (let m = 0; m < order.length; m++) {
    const base = m * 3;
    let index = 0;
    for (let b = 0; b < 3; b++) {
      const bitIndex = base + b;
      const bit = bitIndex < rawBits ? bitOfByte(raw, bitIndex) : 0;
      index = (index << 1) | bit;
    }
    out[order[m] as number] = index;
  }

  return out;
}
