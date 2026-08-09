/**
 * Receive session regressions: hostile OTI containment, exact
 * transferId + OTI locking, grid/packet-size agreement, PayloadId
 * consistency ahead of RaptorQ, contained decoder-construction failures,
 * and the two-strike digest policy. Everything runs against an injected
 * decoder factory — no wasm needed.
 */

import { describe, expect, it } from 'vitest';
import { PACKET_ID_BYTES, type GridSize } from '../src/lib/constants';
import { alignedSymbolSize, buildOti, type FountainDecoder } from '../src/lib/fountain';
import { capacity } from '../src/lib/layout';
import { createReceiveSession, type SessionPacket } from '../src/lib/receive-session';

const N = 100 as GridSize;
const SYMBOL = alignedSymbolSize(capacity(N).payloadBytes); // 2888
const PACKET_BYTES = SYMBOL + PACKET_ID_BYTES;

interface FakeFactory {
  factory: (oti: Uint8Array) => FountainDecoder;
  created: Uint8Array[];
  fed: Uint8Array[][];
  disposed: number[];
  completeAfter: number;
  raw: Uint8Array;
  failNext: boolean;
  /** Next addPacket call throws (a hostile CRC-valid packet or wasm fault). */
  failAddNext: boolean;
  /** dispose() of every decoder created while set throws (broken wasm). */
  failDispose: boolean;
}

function fakeFactory(completeAfter: number): FakeFactory {
  const state: FakeFactory = {
    created: [],
    fed: [],
    disposed: [],
    completeAfter,
    raw: new Uint8Array([1, 2, 3]),
    failNext: false,
    failAddNext: false,
    failDispose: false,
    factory: (oti: Uint8Array): FountainDecoder => {
      if (state.failNext) {
        state.failNext = false;
        throw new Error('decoder construction blew up');
      }
      const index = state.created.length;
      const disposeThrows = state.failDispose;
      state.created.push(oti.slice());
      const feed: Uint8Array[] = [];
      state.fed.push(feed);
      return {
        addPacket(pkt: Uint8Array): Uint8Array | null {
          if (state.failAddNext) {
            state.failAddNext = false;
            throw new Error('decoder addPacket blew up');
          }
          feed.push(pkt.slice());
          return feed.length >= state.completeAfter ? state.raw : null;
        },
        dispose(): void {
          state.disposed.push(index);
          if (disposeThrows) throw new Error('decoder dispose blew up');
        },
      };
    },
  };
  return state;
}

function packetFor(
  transferId: number,
  oti: Uint8Array,
  payloadIdSeed: number,
  n: GridSize = N,
): SessionPacket {
  const payloadId = new Uint8Array([0, payloadIdSeed & 0xff, (payloadIdSeed >> 8) & 0xff, 1]);
  const packet = new Uint8Array(capacity(n).payloadBytes);
  packet.set(payloadId, 0);
  for (let i = PACKET_ID_BYTES; i < packet.length; i++) packet[i] = (i + payloadIdSeed) & 0xff;
  return { packet, transferId, oti, payloadId, n };
}

describe('receive session', () => {
  it('locks transferId + OTI on the first packet and rejects every divergence', () => {
    const fake = fakeFactory(1000);
    const session = createReceiveSession(fake.factory);
    const oti = buildOti(100000, SYMBOL, 1);
    expect(session.expected()).toBeNull();

    expect(session.accept(packetFor(7, oti, 1)).kind).toBe('accepted');
    expect(session.expected()?.transferId).toBe(7);
    expect([...(session.expected()?.oti as Uint8Array)]).toEqual([...oti]);

    // a different transfer id never reaches the decoder
    expect(session.accept(packetFor(8, oti, 2))).toEqual({ kind: 'rejected', reason: 'locked' });

    // the SAME transfer id with a different OTI is hostile — locked out too
    const otherOti = buildOti(200000, SYMBOL, 1);
    expect(session.accept(packetFor(7, otherOti, 3))).toEqual({
      kind: 'rejected',
      reason: 'locked',
    });

    expect(session.accept(packetFor(7, oti, 4)).kind).toBe('accepted');
    expect(fake.created.length).toBe(1);
    expect((fake.fed[0] as Uint8Array[]).length).toBe(2);
    session.dispose();
  });

  it('rejects malformed and oversized OTIs before any decoder exists', () => {
    const fake = fakeFactory(1000);
    const session = createReceiveSession(fake.factory);
    // hostile 40-bit transfer length (~512 GiB) and truncated OTI
    expect(session.accept(packetFor(1, buildOti(2 ** 39, SYMBOL, 1), 1))).toEqual({
      kind: 'rejected',
      reason: 'oti-invalid',
    });
    expect(session.accept(packetFor(1, new Uint8Array(11), 1))).toEqual({
      kind: 'rejected',
      reason: 'oti-invalid',
    });
    expect(fake.created.length).toBe(0);
    expect(session.expected()).toBeNull();
    session.dispose();
  });

  it('requires the OTI packet size to match the detected grid', () => {
    const fake = fakeFactory(1000);
    const session = createReceiveSession(fake.factory);
    // a valid N60-symbol OTI arriving on frames decoded from an N100 grid
    const n60Oti = buildOti(50000, alignedSymbolSize(capacity(60).payloadBytes), 1);
    expect(session.accept(packetFor(1, n60Oti, 1, N))).toEqual({
      kind: 'rejected',
      reason: 'grid-mismatch',
    });
    // ... and the same OTI on its true grid is fine
    expect(session.accept(packetFor(1, n60Oti, 1, 60 as GridSize)).kind).toBe('accepted');
    session.dispose();
  });

  it('rejects packets whose leading bytes disagree with the header PayloadId', () => {
    const fake = fakeFactory(1000);
    const session = createReceiveSession(fake.factory);
    const oti = buildOti(100000, SYMBOL, 1);
    const packet = packetFor(1, oti, 1);
    packet.packet[0] = (packet.packet[0] as number) ^ 0xff; // bytes 0..3 no longer match
    expect(session.accept(packet)).toEqual({ kind: 'rejected', reason: 'payload-mismatch' });
    expect(fake.created.length).toBe(0); // nothing reached RaptorQ
    session.dispose();
  });

  it('contains decoder-construction failures and stays unlocked', () => {
    const fake = fakeFactory(1000);
    fake.failNext = true;
    const session = createReceiveSession(fake.factory);
    const oti = buildOti(100000, SYMBOL, 1);
    expect(session.accept(packetFor(1, oti, 1))).toEqual({
      kind: 'rejected',
      reason: 'decoder-failed',
    });
    expect(session.expected()).toBeNull();
    // the next good packet can still lock a fresh decoder
    expect(session.accept(packetFor(1, oti, 2)).kind).toBe('accepted');
    expect(session.expected()?.transferId).toBe(1);
    session.dispose();
  });

  it('contains addPacket failures: typed rejection, then a clean transfer completes', () => {
    const fake = fakeFactory(2);
    fake.failAddNext = true;
    const session = createReceiveSession(fake.factory);
    const oti = buildOti(2 * SYMBOL, SYMBOL, 1);
    // a CRC-valid but decoder-poisoning packet must surface as a typed
    // rejection, never a throw escaping toward the worker-message handler
    expect(session.accept(packetFor(1, oti, 1))).toEqual({
      kind: 'rejected',
      reason: 'decoder-failed',
    });
    // the poisoned decoder was disposed and the transfer lock released
    expect(fake.disposed).toContain(0);
    expect(session.expected()).toBeNull();
    expect(session.uniqueCount()).toBe(0);
    expect(session.progress()).toBe(0);
    // a later clean sender can lock the session and run to completion
    expect(session.accept(packetFor(9, oti, 2)).kind).toBe('accepted');
    expect(session.expected()?.transferId).toBe(9);
    const done = session.accept(packetFor(9, oti, 3));
    expect(done.kind).toBe('complete');
    if (done.kind === 'complete') expect([...done.raw]).toEqual([1, 2, 3]);
    session.dispose();
  });

  it('contains addPacket failures even when dispose also throws', () => {
    const fake = fakeFactory(1000);
    fake.failAddNext = true;
    fake.failDispose = true;
    const session = createReceiveSession(fake.factory);
    const oti = buildOti(100000, SYMBOL, 1);
    // wasm broken enough that dispose throws too: still a typed rejection
    expect(session.accept(packetFor(1, oti, 1))).toEqual({
      kind: 'rejected',
      reason: 'decoder-failed',
    });
    expect(session.expected()).toBeNull();
    fake.failDispose = false;
    expect(session.accept(packetFor(2, oti, 2)).kind).toBe('accepted');
    session.dispose();
  });

  it('feeds the decoder exactly the OTI packet size and completes', () => {
    const fake = fakeFactory(2);
    const session = createReceiveSession(fake.factory);
    const oti = buildOti(2 * SYMBOL, SYMBOL, 1);
    expect(session.accept(packetFor(1, oti, 1)).kind).toBe('accepted');
    const done = session.accept(packetFor(1, oti, 2));
    expect(done.kind).toBe('complete');
    if (done.kind === 'complete') expect([...done.raw]).toEqual([1, 2, 3]);
    for (const fed of fake.fed[0] as Uint8Array[]) {
      expect(fed.length).toBe(PACKET_BYTES);
    }
    expect(session.uniqueCount()).toBe(2);
    session.dispose();
  });

  it('tracks unique PayloadIds for progress, capped at 99%', () => {
    const fake = fakeFactory(1000);
    const session = createReceiveSession(fake.factory);
    const oti = buildOti(3 * SYMBOL, SYMBOL, 1); // K = 3
    expect(session.progress()).toBe(0);
    session.accept(packetFor(1, oti, 1));
    session.accept(packetFor(1, oti, 1)); // duplicate id: unique count unchanged
    expect(session.uniqueCount()).toBe(1);
    session.accept(packetFor(1, oti, 2));
    session.accept(packetFor(1, oti, 3));
    session.accept(packetFor(1, oti, 4));
    expect(session.uniqueCount()).toBe(4);
    expect(session.progress()).toBe(0.99); // capped below 1 until verified
    session.dispose();
  });

  it('first digest mismatch restarts with the locked OTI; second unlocks', () => {
    const fake = fakeFactory(1000);
    const session = createReceiveSession(fake.factory);
    const oti = buildOti(100000, SYMBOL, 1);
    session.accept(packetFor(1, oti, 1));
    expect(fake.created.length).toBe(1);

    expect(session.noteDigestMismatch()).toBe('restarted');
    expect(fake.disposed).toContain(0);
    expect(fake.created.length).toBe(2); // fresh decoder from the SAME locked OTI
    expect([...(fake.created[1] as Uint8Array)]).toEqual([...oti]);
    expect(session.expected()?.transferId).toBe(1); // still locked
    expect(session.uniqueCount()).toBe(0); // progress restarted

    // the restarted decoder keeps rejecting other identities
    expect(session.accept(packetFor(2, oti, 5)).kind).toBe('rejected');
    session.accept(packetFor(1, oti, 6));

    expect(session.noteDigestMismatch()).toBe('unlocked');
    expect(session.expected()).toBeNull();

    // a fresh sender with a new identity can now lock
    const freshOti = buildOti(50000, SYMBOL, 1);
    expect(session.accept(packetFor(9, freshOti, 7)).kind).toBe('accepted');
    expect(session.expected()?.transferId).toBe(9);
    session.dispose();
  });
});
