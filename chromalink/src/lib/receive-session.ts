/**
 * Receiver transfer session: the authoritative gate between decoded frame
 * packets and the RaptorQ decoder. The first accepted packet locks the
 * transfer identity — transferId AND the exact 12 OTI bytes — and every
 * later packet must match both; a same-id/different-OTI frame is hostile
 * and never reaches the decoder. Before any decoder exists, the declared
 * OTI must parse within wrapper bounds, its packet size must match the
 * detected grid's aligned RaptorQ packet size, and the packet's leading
 * bytes must equal the header PayloadId. Decoder failures — construction,
 * addPacket on a hostile-but-CRC-valid packet, wasm faults, even a throwing
 * dispose — are contained here and reported as a rejection, never thrown; a
 * feed failure releases the lock so a clean sender can be acquired.
 *
 * Digest policy: the first SHA-256 mismatch restarts collection with the
 * locked OTI (fresh decoder, cleared progress); the second also releases
 * the transfer lock so a fresh sender can be acquired.
 */

import { GRID_SIZES, PACKET_ID_BYTES, type GridSize } from './constants';
import { alignedSymbolSize, parseOti, type FountainDecoder, type OtiInfo } from './fountain';
import { capacity } from './layout';
import { bytesEqual } from './transfer';

export type SessionDecoderFactory = (oti: Uint8Array) => FountainDecoder;

export interface SessionPacket {
  /** Frame payload bytes (at least the OTI packet size). */
  packet: Uint8Array;
  transferId: number;
  oti: Uint8Array;
  payloadId: Uint8Array;
  /** Grid the frame was decoded from. */
  n: GridSize;
}

export type SessionRejectReason =
  | 'oti-invalid'
  | 'grid-mismatch'
  | 'locked'
  | 'payload-mismatch'
  | 'decoder-failed';

export type AcceptResult =
  | { kind: 'rejected'; reason: SessionRejectReason }
  | { kind: 'accepted'; uniqueIds: number; k: number }
  | { kind: 'complete'; raw: Uint8Array };

export interface ReceiveSession {
  accept(packet: SessionPacket): AcceptResult;
  /** Locked identity for worker-side filtering, or null before lock. */
  expected(): { transferId: number; oti: Uint8Array } | null;
  info(): OtiInfo | null;
  uniqueCount(): number;
  /** min(unique / K, 0.99), or 0 before lock. */
  progress(): number;
  /** 'restarted' keeps the lock with a fresh decoder; 'unlocked' releases it. */
  noteDigestMismatch(): 'restarted' | 'unlocked';
  dispose(): void;
}

export function createReceiveSession(createDecoderImpl: SessionDecoderFactory): ReceiveSession {
  let transferId: number | null = null;
  let oti: Uint8Array | null = null;
  let info: OtiInfo | null = null;
  let decoder: FountainDecoder | null = null;
  let uniqueIds = new Set<string>();
  let digestFailures = 0;
  let raw: Uint8Array | null = null;

  function disposeDecoder(): void {
    if (decoder === null) return;
    const doomed = decoder;
    decoder = null;
    try {
      doomed.dispose();
    } catch {
      // a wasm decoder broken enough to throw from dispose is already freed
      // as far as this session is concerned
    }
  }

  function unlock(): void {
    disposeDecoder();
    transferId = null;
    oti = null;
    info = null;
    uniqueIds = new Set<string>();
    digestFailures = 0;
    raw = null;
  }

  return {
    accept(packet: SessionPacket): AcceptResult {
      if (transferId !== null && oti !== null) {
        if (packet.transferId !== transferId || !bytesEqual(packet.oti, oti)) {
          return { kind: 'rejected', reason: 'locked' };
        }
      }
      const parsed = info ?? parseOti(packet.oti);
      if (parsed === null) return { kind: 'rejected', reason: 'oti-invalid' };
      // the declared packet size must be exactly what the detected grid carries
      if (!(GRID_SIZES as readonly number[]).includes(packet.n)) {
        return { kind: 'rejected', reason: 'grid-mismatch' };
      }
      const expectedPacketBytes =
        alignedSymbolSize(capacity(packet.n).payloadBytes) + PACKET_ID_BYTES;
      if (parsed.packetBytes !== expectedPacketBytes) {
        return { kind: 'rejected', reason: 'grid-mismatch' };
      }
      if (packet.packet.length < parsed.packetBytes) {
        return { kind: 'rejected', reason: 'grid-mismatch' };
      }
      if (
        packet.payloadId.length !== PACKET_ID_BYTES ||
        !bytesEqual(packet.packet.subarray(0, PACKET_ID_BYTES), packet.payloadId)
      ) {
        return { kind: 'rejected', reason: 'payload-mismatch' };
      }
      if (decoder === null) {
        try {
          decoder = createDecoderImpl(packet.oti);
        } catch {
          return { kind: 'rejected', reason: 'decoder-failed' };
        }
        transferId = packet.transferId;
        oti = packet.oti.slice();
        info = parsed;
      }
      uniqueIds.add(Array.from(packet.payloadId).join('.'));
      if (raw === null) {
        try {
          raw = decoder.addPacket(packet.packet.subarray(0, parsed.packetBytes));
        } catch {
          // the decoder state is no longer trustworthy: drop it and the
          // lock so a clean transfer can be acquired from scratch
          unlock();
          return { kind: 'rejected', reason: 'decoder-failed' };
        }
      }
      if (raw !== null) return { kind: 'complete', raw };
      return { kind: 'accepted', uniqueIds: uniqueIds.size, k: parsed.sourceSymbols };
    },
    expected(): { transferId: number; oti: Uint8Array } | null {
      if (transferId === null || oti === null) return null;
      return { transferId, oti };
    },
    info: () => info,
    uniqueCount: () => uniqueIds.size,
    progress(): number {
      if (info === null || info.sourceSymbols <= 0) return 0;
      return Math.min(uniqueIds.size / info.sourceSymbols, 0.99);
    },
    noteDigestMismatch(): 'restarted' | 'unlocked' {
      digestFailures += 1;
      raw = null;
      if (digestFailures >= 2 || oti === null) {
        unlock();
        return 'unlocked';
      }
      disposeDecoder();
      uniqueIds = new Set<string>();
      try {
        decoder = createDecoderImpl(oti);
      } catch {
        unlock();
        return 'unlocked';
      }
      return 'restarted';
    },
    dispose: unlock,
  };
}
