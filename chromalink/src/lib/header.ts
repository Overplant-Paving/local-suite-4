/**
 * 28-byte big-endian frame header, protected by RS(42, 28):
 *   0     magic (0xC7)
 *   1     protocol version
 *   2..5  transferId u32
 *   6..17 RaptorQ OTI (12 bytes)
 *   18..21 RaptorQ PayloadId of this frame's packet (4 bytes)
 *   22..25 CRC32 of the post-inner-RS-decoded payload bytes
 *   26..27 CRC16-CCITT (0x1021 / 0xFFFF) over bytes 0..25
 */

import { HEADER_BYTES, HEADER_RS_PARITY, MAGIC, OTI_BYTES, PACKET_ID_BYTES, PROTOCOL_VERSION } from './constants';
import { crc16ccitt } from './crc';
import { decode as rsDecode, encode as rsEncode } from './rs';

export interface FrameHeader {
  transferId: number;
  oti: Uint8Array;
  payloadId: Uint8Array;
  payloadCrc32: number;
}

export function encodeHeader(h: FrameHeader): Uint8Array {
  if (h.oti.length !== OTI_BYTES) throw new RangeError('header: OTI must be 12 bytes');
  if (h.payloadId.length !== PACKET_ID_BYTES) throw new RangeError('header: PayloadId must be 4 bytes');
  const out = new Uint8Array(HEADER_BYTES);
  out[0] = MAGIC;
  out[1] = PROTOCOL_VERSION;
  out[2] = (h.transferId >>> 24) & 0xff;
  out[3] = (h.transferId >>> 16) & 0xff;
  out[4] = (h.transferId >>> 8) & 0xff;
  out[5] = h.transferId & 0xff;
  out.set(h.oti, 6);
  out.set(h.payloadId, 18);
  out[22] = (h.payloadCrc32 >>> 24) & 0xff;
  out[23] = (h.payloadCrc32 >>> 16) & 0xff;
  out[24] = (h.payloadCrc32 >>> 8) & 0xff;
  out[25] = h.payloadCrc32 & 0xff;
  const crc = crc16ccitt(out.subarray(0, 26));
  out[26] = (crc >>> 8) & 0xff;
  out[27] = crc & 0xff;
  return out;
}

/** 28-byte header -> 42-byte RS-protected header (corrects up to 7 bytes). */
export function protectHeader(header28: Uint8Array): Uint8Array {
  if (header28.length !== HEADER_BYTES) throw new RangeError('header: expected 28 bytes');
  return rsEncode(header28, HEADER_RS_PARITY);
}

export function buildProtectedHeader(h: FrameHeader): Uint8Array {
  return protectHeader(encodeHeader(h));
}

/**
 * RS-decode and validate one 42-byte protected header copy. Returns null on
 * RS failure, bad magic/version, or CRC16 mismatch. Never throws.
 */
export function decodeProtectedHeader(bytes42: Uint8Array): FrameHeader | null {
  if (bytes42.length !== HEADER_BYTES + HEADER_RS_PARITY) return null;
  const header = rsDecode(bytes42, HEADER_RS_PARITY);
  if (header === null) return null;
  if ((header[0] as number) !== MAGIC) return null;
  if ((header[1] as number) !== PROTOCOL_VERSION) return null;
  const declared = ((header[26] as number) << 8) | (header[27] as number);
  if (declared !== crc16ccitt(header.subarray(0, 26))) return null;
  const transferId =
    (((header[2] as number) << 24) |
      ((header[3] as number) << 16) |
      ((header[4] as number) << 8) |
      (header[5] as number)) >>>
    0;
  const payloadCrc32 =
    (((header[22] as number) << 24) |
      ((header[23] as number) << 16) |
      ((header[24] as number) << 8) |
      (header[25] as number)) >>>
    0;
  return {
    transferId,
    oti: header.slice(6, 18),
    payloadId: header.slice(18, 22),
    payloadCrc32,
  };
}
