/**
 * Decode worker: a thin DOM shell around lib/receive-pipeline. It
 * rasterizes camera bitmaps on one reused OffscreenCanvas, closes every
 * bitmap, and posts the processor's packets and statistics. Every reply
 * echoes the frame's epoch so the app can discard results that were in
 * flight across a reset before a stale packet can re-lock a session.
 * Malformed frames are absorbed by the processor ('error' status) and the
 * worker keeps running.
 */

import {
  createFrameProcessor,
  type ExpectedTransfer,
  type ReceiveStats,
  type RejectReason,
} from '../lib/receive-pipeline';
import type { RgbaImage } from '../lib/vision/image';

export interface WorkerFrameMessage {
  type: 'frame';
  bitmap: ImageBitmap;
  /** Bumped by the app on every reset; stale replies are discarded. */
  epoch: number;
  expected: { transferId: number; oti: ArrayBuffer } | null;
}

export interface WorkerResetMessage {
  type: 'reset';
}

export type WorkerInMessage = WorkerFrameMessage | WorkerResetMessage;

export type WorkerStats = ReceiveStats;

export type WorkerOutMessage =
  | {
      type: 'packet';
      epoch: number;
      packet: ArrayBuffer;
      transferId: number;
      oti: ArrayBuffer;
      payloadId: ArrayBuffer;
      n: number;
      pitchPx: number;
      stats: WorkerStats;
    }
  | {
      type: 'status';
      epoch: number;
      outcome: RejectReason | 'dup';
      n: number | null;
      pitchPx: number | null;
      stats: WorkerStats;
    };

interface WorkerScope {
  postMessage(message: WorkerOutMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const scope = self as unknown as WorkerScope;
const processor = createFrameProcessor();

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function rasterize(bitmap: ImageBitmap): RgbaImage | null {
  if (canvas === null || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (ctx === null) return null;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: data.width, height: data.height, pixels: data.data };
}

function handleFrame(message: WorkerFrameMessage): void {
  let img: RgbaImage | null = null;
  try {
    img = rasterize(message.bitmap);
  } catch {
    img = null;
  } finally {
    message.bitmap.close();
  }
  const expected: ExpectedTransfer | null =
    message.expected === null
      ? null
      : { transferId: message.expected.transferId, oti: new Uint8Array(message.expected.oti) };
  const result = processor.process(img, expected);
  if (result.type === 'packet') {
    const packetBuffer = result.packet.slice().buffer;
    const otiBuffer = result.oti.slice().buffer;
    const payloadIdBuffer = result.payloadId.slice().buffer;
    scope.postMessage(
      {
        type: 'packet',
        epoch: message.epoch,
        packet: packetBuffer,
        transferId: result.transferId,
        oti: otiBuffer,
        payloadId: payloadIdBuffer,
        n: result.n,
        pitchPx: result.pitchPx,
        stats: result.stats,
      },
      [packetBuffer, otiBuffer, payloadIdBuffer],
    );
    return;
  }
  scope.postMessage({
    type: 'status',
    epoch: message.epoch,
    outcome: result.outcome,
    n: result.n,
    pitchPx: result.pitchPx,
    stats: result.stats,
  });
}

scope.onmessage = (event: MessageEvent) => {
  const message = event.data as WorkerInMessage;
  try {
    if (message.type === 'reset') {
      processor.reset();
      return;
    }
    handleFrame(message);
  } catch (err) {
    // a single bad message must never kill the worker — and every frame
    // message must produce a reply, or the app-side busy flag would stick
    console.error('ChromaLink worker frame error:', err);
    if (message.type === 'frame') {
      try {
        scope.postMessage({
          type: 'status',
          epoch: message.epoch,
          outcome: 'error',
          n: null,
          pitchPx: null,
          stats: processor.stats(),
        });
      } catch {
        /* posting failed — nothing left to do for this frame */
      }
    }
  }
};
