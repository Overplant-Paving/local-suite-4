import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  buildTransferBlob,
  bytesEqual,
  encodeFilename,
  parseTransferBlob,
  restoreOriginal,
  sanitizeFilename,
} from '../src/lib/transfer';
import { mulberry32, randomBytes } from './prng';

describe('transfer container', () => {
  it('round-trips a compressible file with deflate', () => {
    const data = new Uint8Array(50000).fill(65);
    const digest = sha256(data);
    const blob = buildTransferBlob('hello.txt', data, digest);
    const info = parseTransferBlob(blob);
    expect(info).not.toBeNull();
    expect(info?.filename).toBe('hello.txt');
    expect(info?.originalSize).toBe(data.length);
    expect(info?.compression).toBe(1);
    expect(bytesEqual(info?.sha256 as Uint8Array, digest)).toBe(true);
    const restored = restoreOriginal(info as NonNullable<typeof info>);
    expect(restored).not.toBeNull();
    expect(bytesEqual(restored as Uint8Array, data)).toBe(true);
  });

  it('stores incompressible bytes raw', () => {
    const data = randomBytes(mulberry32(9), 8192);
    const blob = buildTransferBlob('noise.bin', data, sha256(data));
    const info = parseTransferBlob(blob);
    expect(info?.compression).toBe(0);
    const restored = restoreOriginal(info as NonNullable<typeof info>);
    expect(bytesEqual(restored as Uint8Array, data)).toBe(true);
  });

  it('truncates filenames to 255 UTF-8 bytes on a code-point boundary', () => {
    const name = '📦'.repeat(100); // 4 bytes each
    const bytes = encodeFilename(name);
    expect(bytes.length).toBeLessThanOrEqual(255);
    expect(bytes.length % 4).toBe(0); // no split emoji
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded.includes('�')).toBe(false);
  });

  it('sanitizes hostile filenames', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('a‮gnp.exe')).toBe('agnp.exe');
    expect(sanitizeFilename('con<>:"|?*trol\x07.txt')).toBe('control.txt');
    expect(sanitizeFilename('...')).toBe('received.bin');
    expect(sanitizeFilename('')).toBe('received.bin');
  });

  it('fails closed on malformed containers', () => {
    const data = new Uint8Array(1000).fill(3);
    const blob = buildTransferBlob('x.bin', data, sha256(data));
    expect(parseTransferBlob(blob.subarray(0, 10))).toBeNull();

    const badCompression = blob.slice();
    badCompression[1 + 5 + 8 + 32] = 7;
    expect(parseTransferBlob(badCompression)).toBeNull();

    // declared size beyond 64 MiB
    const oversize = blob.slice();
    const view = new DataView(oversize.buffer);
    view.setBigUint64(1 + 5, BigInt(65 * 1024 * 1024));
    expect(parseTransferBlob(oversize)).toBeNull();

    // stored payload whose length disagrees with the declared size
    const stored = buildTransferBlob('y.bin', randomBytes(mulberry32(2), 100), sha256(data));
    const truncated = stored.subarray(0, stored.length - 1);
    expect(parseTransferBlob(truncated)).toBeNull();

    // deflate stream that inflates to the wrong length
    const info = parseTransferBlob(blob);
    expect(info).not.toBeNull();
    if (info && info.compression === 1) {
      const wrongSize = { ...info, originalSize: info.originalSize - 1 };
      expect(restoreOriginal(wrongSize)).toBeNull();
    }
  });
});
