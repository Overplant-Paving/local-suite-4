/**
 * Frame gate regression (never queue frames): at most one async
 * acquisition — or its delivered frame — may ever be in flight. The
 * original pump checked busy before the async createImageBitmap but only
 * marked busy after it resolved, so several bitmap creations could stack
 * up; these tests pin the corrected contract with a delayed-acquire seam.
 */

import { describe, expect, it } from 'vitest';
import { createFrameGate } from '../src/lib/frame-gate';

interface Deferred {
  promise: Promise<number>;
  resolve: (value: number) => void;
  reject: (err: Error) => void;
}

function deferred(): Deferred {
  let resolve!: (value: number) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<number>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(busyRef: { busy: boolean }): {
  gate: ReturnType<typeof createFrameGate>;
  pending: Deferred[];
  delivered: number[];
  disposed: number[];
  acquires: () => number;
} {
  const pending: Deferred[] = [];
  const delivered: number[] = [];
  const disposed: number[] = [];
  const gate = createFrameGate<number>({
    acquire: () => {
      const d = deferred();
      pending.push(d);
      return d.promise;
    },
    busy: () => busyRef.busy,
    deliver: (item) => delivered.push(item),
    dispose: (item) => disposed.push(item),
  });
  return { gate, pending, delivered, disposed, acquires: () => pending.length };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('frame gate', () => {
  it('starts exactly one acquisition while the first is still pending', async () => {
    const busyRef = { busy: false };
    const h = harness(busyRef);
    h.gate.pulse();
    h.gate.pulse();
    h.gate.pulse();
    // delayed bitmap creation: the later pulses must drop, not stack
    expect(h.acquires()).toBe(1);
    expect(h.gate.dropped()).toBe(2);
    expect(h.gate.inFlight()).toBe(true);

    (h.pending[0] as Deferred).resolve(11);
    await tick();
    expect(h.delivered).toEqual([11]);
    expect(h.gate.inFlight()).toBe(false);

    // only after delivery may the next pulse acquire again
    h.gate.pulse();
    expect(h.acquires()).toBe(2);
  });

  it('drops frames while the consumer reports busy', () => {
    const busyRef = { busy: true };
    const h = harness(busyRef);
    h.gate.pulse();
    h.gate.pulse();
    expect(h.acquires()).toBe(0);
    expect(h.gate.dropped()).toBe(2);
    busyRef.busy = false;
    h.gate.pulse();
    expect(h.acquires()).toBe(1);
  });

  it('a late acquisition after stop is disposed, never delivered', async () => {
    const busyRef = { busy: false };
    const h = harness(busyRef);
    h.gate.pulse();
    h.gate.stop();
    (h.pending[0] as Deferred).resolve(7);
    await tick();
    expect(h.delivered).toEqual([]);
    expect(h.disposed).toEqual([7]);
    // stopped gates ignore further pulses entirely
    h.gate.pulse();
    expect(h.acquires()).toBe(1);
  });

  it('an acquisition failure frees the gate for the next pulse', async () => {
    const busyRef = { busy: false };
    const h = harness(busyRef);
    h.gate.pulse();
    (h.pending[0] as Deferred).reject(new Error('camera hiccup'));
    await tick();
    expect(h.gate.inFlight()).toBe(false);
    expect(h.gate.dropped()).toBe(1);
    h.gate.pulse();
    expect(h.acquires()).toBe(2);
    (h.pending[1] as Deferred).resolve(3);
    await tick();
    expect(h.delivered).toEqual([3]);
  });

  it('a pulse landing between resolve and deliver cannot double-acquire', async () => {
    // deliver() synchronously re-pulses (worst-case reentrancy): the gate
    // is still in flight during delivery, so the nested pulse must drop
    const busyRef = { busy: false };
    const pending: Deferred[] = [];
    const delivered: number[] = [];
    const gate = createFrameGate<number>({
      acquire: () => {
        const d = deferred();
        pending.push(d);
        return d.promise;
      },
      busy: () => busyRef.busy,
      deliver: (item) => {
        delivered.push(item);
        gate.pulse();
      },
      dispose: () => undefined,
    });
    gate.pulse();
    (pending[0] as Deferred).resolve(1);
    await tick();
    expect(delivered).toEqual([1]);
    expect(pending.length).toBe(1);
    expect(gate.dropped()).toBe(1);
  });
});
