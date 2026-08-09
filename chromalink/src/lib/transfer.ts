/**
 * Transfer container ("blob") moved by the fountain code:
 *   u8   UTF-8 filename byte length
 *   ...  filename bytes (truncated to <= 255 bytes on a code-point boundary)
 *   u64  original size, big-endian
 *   32B  SHA-256 of the original bytes
 *   u8   compression (1 = raw deflate, 0 = stored)
 *   ...  compressed bytes when deflate is strictly smaller, else the raw bytes
 */

import { deflateSync, Inflate } from 'fflate';
import { MAX_FILE_BYTES } from './constants';

export const SHA256_BYTES = 32;
const FIXED_FIELDS = 1 + 8 + SHA256_BYTES + 1;

export interface TransferBlobInfo {
  filename: string;
  originalSize: number;
  sha256: Uint8Array;
  compression: 0 | 1;
  payload: Uint8Array;
}

/** UTF-8 encode, truncated to <= 255 bytes without splitting a code point. */
export function encodeFilename(name: string): Uint8Array {
  const encoder = new TextEncoder();
  let bytes = encoder.encode(name);
  if (bytes.length <= 255) return bytes;
  let end = 255;
  // never cut inside a multi-byte sequence (continuation bytes are 10xxxxxx)
  while (end > 0 && ((bytes[end] as number) & 0xc0) === 0x80) end -= 1;
  bytes = bytes.subarray(0, end);
  return bytes;
}

/** Strip directories, control and bidi-formatting characters; bound length. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]+/).pop() ?? '';
  let clean = '';
  for (const ch of base) {
    const code = ch.codePointAt(0) as number;
    if (code < 0x20 || code === 0x7f) continue;
    if (code >= 0x200e && code <= 0x202e) continue; // bidi controls
    if ('<>:"|?*'.includes(ch)) continue;
    clean += ch;
  }
  clean = clean.replace(/^\.+/, '').trim();
  if (clean.length === 0) clean = 'received.bin';
  if (clean.length > 128) clean = clean.slice(0, 128);
  return clean;
}

export function buildTransferBlob(filename: string, data: Uint8Array, sha256: Uint8Array): Uint8Array {
  if (data.length === 0 || data.length > MAX_FILE_BYTES) {
    throw new RangeError('transfer: file size out of range');
  }
  if (sha256.length !== SHA256_BYTES) throw new RangeError('transfer: bad digest length');
  const nameBytes = encodeFilename(filename);
  const deflated = deflateSync(data);
  const useDeflate = deflated.length < data.length;
  const payload = useDeflate ? deflated : data;
  const out = new Uint8Array(1 + nameBytes.length + FIXED_FIELDS - 1 + payload.length);
  let pos = 0;
  out[pos] = nameBytes.length;
  pos += 1;
  out.set(nameBytes, pos);
  pos += nameBytes.length;
  const view = new DataView(out.buffer);
  view.setBigUint64(pos, BigInt(data.length));
  pos += 8;
  out.set(sha256, pos);
  pos += SHA256_BYTES;
  out[pos] = useDeflate ? 1 : 0;
  pos += 1;
  out.set(payload, pos);
  return out;
}

/** Bounded, fail-closed container parse. Returns null on any malformation. */
export function parseTransferBlob(blob: Uint8Array): TransferBlobInfo | null {
  if (blob.length < 1 + FIXED_FIELDS - 1) return null;
  const nameLen = blob[0] as number;
  const headerLen = 1 + nameLen + 8 + SHA256_BYTES + 1;
  if (blob.length < headerLen) return null;
  let filename: string;
  try {
    filename = new TextDecoder('utf-8', { fatal: false }).decode(blob.subarray(1, 1 + nameLen));
  } catch {
    return null;
  }
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const sizeBig = view.getBigUint64(1 + nameLen);
  if (sizeBig <= 0n || sizeBig > BigInt(MAX_FILE_BYTES)) return null;
  const originalSize = Number(sizeBig);
  const sha256 = blob.slice(1 + nameLen + 8, 1 + nameLen + 8 + SHA256_BYTES);
  const compression = blob[1 + nameLen + 8 + SHA256_BYTES] as number;
  if (compression !== 0 && compression !== 1) return null;
  const payload = blob.subarray(headerLen);
  if (compression === 0 && payload.length !== originalSize) return null;
  // the sender only deflates when strictly smaller, so anything else is hostile
  if (compression === 1 && (payload.length === 0 || payload.length >= originalSize)) return null;
  return { filename, originalSize, sha256, compression: compression as 0 | 1, payload };
}

/**
 * Recover the original bytes from a parsed container. Inflation streams into
 * a buffer of exactly the declared size and aborts on the first excess byte,
 * so a hostile stream cannot expand past the declared (already size-capped)
 * length; any length mismatch returns null.
 */
export function restoreOriginal(info: TransferBlobInfo): Uint8Array | null {
  if (info.compression === 0) {
    return info.payload.length === info.originalSize ? info.payload.slice() : null;
  }
  try {
    const target = new Uint8Array(info.originalSize);
    let written = 0;
    let overflow = false;
    const inflater = new Inflate((chunk) => {
      if (overflow) return;
      if (written + chunk.length > target.length) {
        overflow = true;
        return;
      }
      target.set(chunk, written);
      written += chunk.length;
    });
    inflater.push(info.payload, true);
    if (overflow || written !== info.originalSize) return null;
    return target;
  } catch {
    return null;
  }
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if ((a[i] as number) !== (b[i] as number)) return false;
  }
  return true;
}
