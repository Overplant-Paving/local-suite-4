/** Frame CRCs: CRC32 (via crc-32) for payloads, CRC16-CCITT for headers. */

import { buf as crc32buf } from 'crc-32';

/** IEEE CRC32 as an unsigned 32-bit integer. */
export function crc32(bytes: Uint8Array): number {
  return crc32buf(bytes) >>> 0;
}

/** CRC16-CCITT (poly 0x1021, init 0xFFFF, no reflection, no final xor). */
export function crc16ccitt(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i] as number) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}
