/**
 * Serializes an async acquire → deliver frame pipeline: at most one
 * acquisition (or its delivery) is ever in flight. Pulses arriving while
 * an acquisition is pending — or while the consumer reports busy — are
 * dropped, never queued, so a slow consumer can never accumulate a
 * backlog of in-flight acquisitions.
 */

export interface FrameGateHooks<T> {
  /** Start acquiring one frame (e.g. createImageBitmap). */
  acquire: () => Promise<T>;
  /** Consumer busy? Checked only when no acquisition is in flight. */
  busy: () => boolean;
  /** Hand a frame to the consumer (synchronous). */
  deliver: (item: T) => void;
  /** Release a frame that will not be delivered (e.g. bitmap.close). */
  dispose: (item: T) => void;
}

export interface FrameGate {
  /** Frame signal: acquire unless one is already in flight or busy. */
  pulse(): void;
  /** Stop; a late acquisition resolves into dispose, not deliver. */
  stop(): void;
  dropped(): number;
  inFlight(): boolean;
}

export function createFrameGate<T>(hooks: FrameGateHooks<T>): FrameGate {
  let running = true;
  let inFlight = false;
  let dropped = 0;
  return {
    pulse(): void {
      if (!running) return;
      if (inFlight || hooks.busy()) {
        dropped += 1;
        return;
      }
      inFlight = true;
      hooks.acquire().then(
        (item) => {
          if (!running) {
            inFlight = false;
            hooks.dispose(item);
            return;
          }
          try {
            hooks.deliver(item);
          } finally {
            inFlight = false;
          }
        },
        () => {
          inFlight = false;
          dropped += 1;
        },
      );
    },
    stop(): void {
      running = false;
    },
    dropped: () => dropped,
    inFlight: () => inFlight,
  };
}
