// @vitest-environment happy-dom
/**
 * Receiver finalization-ownership regression. Scenario: a SHA-256
 * finalization (A) is pending when the user hits Reset; a second transfer
 * completes and its finalization (B) starts; then A's digest finally
 * resolves. The stale finalizer must not mutate the UI, must not create a
 * download URL, and — the actual regression — must not clear the CURRENT
 * finalization's ownership, which would let a third completion (C) start a
 * duplicate finalization while B is still pending.
 *
 * Everything is deterministic: the camera and decode worker are stubbed
 * (see vite.config.ts test.alias for the ?worker&inline mapping), the
 * fountain decoder is injected to complete on the first packet, and
 * crypto.subtle.digest returns deferred promises the test resolves in a
 * chosen order.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PACKET_ID_BYTES } from '../src/lib/constants';
import { alignedSymbolSize, buildOti } from '../src/lib/fountain';
import { capacity } from '../src/lib/layout';
import { buildTransferBlob, SHA256_BYTES } from '../src/lib/transfer';
import type { WorkerOutMessage, WorkerStats } from '../src/receiver/decode-worker';
import { stubWorkerInstances } from './stubs/decode-worker-stub';

const decoderState = vi.hoisted(() => ({
  raw: null as Uint8Array | null,
  cameraStops: 0,
}));

vi.mock('../src/receiver/camera', () => ({
  CAMERA_PERMISSION_MESSAGE: 'Camera permission required',
  CameraPermissionError: class CameraPermissionError extends Error {},
  openCamera: () =>
    Promise.resolve({
      stream: null as unknown as MediaStream,
      track: null as unknown as MediaStreamTrack,
      freezeFocusAndWhiteBalance: () => Promise.resolve(),
      stop: () => {
        decoderState.cameraStops += 1;
      },
    }),
  startFramePump: () => ({ stop: () => undefined, droppedFrames: () => 0 }),
}));

vi.mock('../src/lib/fountain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/fountain')>();
  return {
    ...actual,
    // completes on the first accepted packet with the test's transfer blob
    createDecoder: () => ({
      addPacket: () => decoderState.raw,
      dispose: () => undefined,
    }),
  };
});

import { mountReceiver } from '../src/receiver/receiver-app';

const N = 100 as const;
const SYMBOL = alignedSymbolSize(capacity(N).payloadBytes);

const BAKED_SHA = new Uint8Array(SHA256_BYTES).fill(0xab);
const ORIGINAL = new Uint8Array(1000).map((_, i) => (i * 7) & 0xff);

function freshStats(): WorkerStats {
  return {
    frames: 1,
    displayedSeen: 1,
    decoded: 1,
    dups: 0,
    rejects: {
      blur: 0,
      nofinder: 0,
      washout: 0,
      nogrid: 0,
      undecodable: 0,
      filtered: 0,
      'payload-mismatch': 0,
      error: 0,
    },
    finderStreak: 1,
    recentBlurFraction: 0,
  };
}

function packetMessage(epoch: number, transferId: number, seed: number): WorkerOutMessage {
  const payloadId = new Uint8Array([0, seed & 0xff, (seed >> 8) & 0xff, 1]);
  const packet = new Uint8Array(capacity(N).payloadBytes);
  packet.set(payloadId, 0);
  for (let i = PACKET_ID_BYTES; i < packet.length; i++) packet[i] = (i + seed) & 0xff;
  const oti = buildOti(SYMBOL, SYMBOL, 1);
  return {
    type: 'packet',
    epoch,
    packet: packet.buffer as ArrayBuffer,
    transferId,
    oti: oti.buffer as ArrayBuffer,
    payloadId: payloadId.buffer as ArrayBuffer,
    n: N,
    pitchPx: 10,
    stats: freshStats(),
  };
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('receiver finalization ownership', () => {
  let pendingDigests: Array<(digest: ArrayBuffer) => void>;
  let createdUrls: string[];
  let revokedUrls: string[];

  beforeEach(() => {
    decoderState.raw = buildTransferBlob('fixture.bin', ORIGINAL, BAKED_SHA);
    decoderState.cameraStops = 0;
    stubWorkerInstances.length = 0;
    pendingDigests = [];
    createdUrls = [];
    revokedUrls = [];
    vi.stubGlobal('crypto', {
      subtle: {
        digest: () =>
          new Promise<ArrayBuffer>((resolve) => {
            pendingDigests.push(resolve);
          }),
      },
    });
    URL.createObjectURL = () => {
      const url = `blob:test-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      revokedUrls.push(url);
    };
  });

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide')); // receiver teardown
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('a stale finalizer resolving after Reset neither mutates UI nor unblocks a duplicate', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountReceiver(root);
    await flush();
    await flush(); // openCamera + video.play settle

    expect(stubWorkerInstances.length).toBe(1);
    const worker = stubWorkerInstances[0];
    if (worker === undefined || worker.onmessage === null) throw new Error('worker not wired');
    const post = (message: WorkerOutMessage): void => {
      worker.onmessage?.({ data: message });
    };
    const doneEl = root.querySelector('.cl-done') as HTMLElement;
    const resetBtn = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reset receiver',
    ) as HTMLButtonElement;

    // transfer 1 completes; finalization A parks on its deferred digest
    post(packetMessage(0, 7, 1));
    expect(pendingDigests.length).toBe(1);

    // user resets while A is still pending; a fresh sender completes and
    // finalization B parks on its own deferred digest
    resetBtn.click();
    post(packetMessage(1, 9, 2));
    expect(pendingDigests.length).toBe(2);

    // A resolves late — after the Reset and after B started
    pendingDigests[0]?.(BAKED_SHA.slice().buffer);
    await flush();
    expect(doneEl.hidden).toBe(true); // stale A mutated no UI
    expect(createdUrls.length).toBe(0); // and created no download URL

    // a third completion on the CURRENT session must not start a duplicate
    // finalization while B is still pending (the stale finally used to
    // clear the shared flag and let C through)
    post(packetMessage(1, 9, 3));
    expect(pendingDigests.length).toBe(2);

    // B resolves and completes exactly once
    pendingDigests[1]?.(BAKED_SHA.slice().buffer);
    await flush();
    expect(doneEl.hidden).toBe(false);
    expect(doneEl.textContent).toContain('Received fixture.bin');
    expect(createdUrls.length).toBe(1);
    expect(revokedUrls.length).toBe(0);
    expect(worker.terminated).toBe(true); // completion released the pipeline
    expect(decoderState.cameraStops).toBe(1);
  });
});
