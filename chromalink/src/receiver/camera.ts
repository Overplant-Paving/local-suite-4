/**
 * Camera acquisition and control. Requests the environment camera at ideal
 * 1920x1080@60; NotAllowedError surfaces the exact "Camera permission
 * required" state, OverconstrainedError retries once with facing mode
 * only. Capabilities are read once per session; each supported constraint
 * is applied once, logging and continuing on rejection. Focus and white
 * balance freeze on demand once the worker reports a steady finder lock.
 */

import { createFrameGate } from '../lib/frame-gate';

export const CAMERA_PERMISSION_MESSAGE = 'Camera permission required';

export class CameraPermissionError extends Error {
  constructor() {
    super(CAMERA_PERMISSION_MESSAGE);
    this.name = 'CameraPermissionError';
  }
}

/** Advanced capabilities not yet in the standard TS DOM library. */
interface ExtendedCapabilities extends MediaTrackCapabilities {
  exposureMode?: string[];
  exposureTime?: { min?: number; max?: number; step?: number };
  focusMode?: string[];
  focusDistance?: { min?: number; max?: number; step?: number };
  whiteBalanceMode?: string[];
  colorTemperature?: { min?: number; max?: number; step?: number };
}

interface ExtendedSettings extends MediaTrackSettings {
  focusDistance?: number;
  colorTemperature?: number;
}

interface ExtendedConstraintSet {
  exposureMode?: string;
  exposureTime?: number;
  focusMode?: string;
  focusDistance?: number;
  whiteBalanceMode?: string;
  colorTemperature?: number;
}

export interface CameraSession {
  stream: MediaStream;
  track: MediaStreamTrack;
  /** Freeze manual focus and white balance at current values (once). */
  freezeFocusAndWhiteBalance(): Promise<void>;
  stop(): void;
}

async function applyAdvanced(track: MediaStreamTrack, set: ExtendedConstraintSet): Promise<void> {
  try {
    await track.applyConstraints({ advanced: [set as MediaTrackConstraintSet] });
  } catch (err) {
    console.info('ChromaLink camera: constraint rejected, continuing:', set, err);
  }
}

export async function openCamera(): Promise<CameraSession> {
  const ideal: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 60 },
    },
  };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(ideal);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new CameraPermissionError();
    }
    if (err instanceof DOMException && err.name === 'OverconstrainedError') {
      // retry once with the environment facing preference only
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      });
    } else {
      throw err;
    }
  }

  const track = stream.getVideoTracks()[0];
  if (track === undefined) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('ChromaLink camera: no video track');
  }

  // Read capabilities once; Safari has no getCapabilities and must work
  // with default controls.
  let capabilities: ExtendedCapabilities = {};
  try {
    if (typeof track.getCapabilities === 'function') {
      capabilities = track.getCapabilities() as ExtendedCapabilities;
    }
  } catch (err) {
    console.info('ChromaLink camera: getCapabilities unavailable:', err);
  }

  // Manual exposure with exposureTime max(min, 20), applied once.
  if (capabilities.exposureMode?.includes('manual') && capabilities.exposureTime !== undefined) {
    const min = capabilities.exposureTime.min ?? 20;
    await applyAdvanced(track, { exposureMode: 'manual', exposureTime: Math.max(min, 20) });
  }

  let frozen = false;
  let stopped = false;
  return {
    stream,
    track,
    async freezeFocusAndWhiteBalance(): Promise<void> {
      if (frozen || stopped) return;
      frozen = true;
      let settings: ExtendedSettings = {};
      try {
        settings = track.getSettings() as ExtendedSettings;
      } catch (err) {
        console.info('ChromaLink camera: getSettings unavailable:', err);
        return;
      }
      if (stopped) return; // stop() raced the settings read
      if (capabilities.focusMode?.includes('manual') && settings.focusDistance !== undefined) {
        await applyAdvanced(track, { focusMode: 'manual', focusDistance: settings.focusDistance });
      }
      if (stopped) return;
      if (
        capabilities.whiteBalanceMode?.includes('manual') &&
        settings.colorTemperature !== undefined
      ) {
        await applyAdvanced(track, {
          whiteBalanceMode: 'manual',
          colorTemperature: settings.colorTemperature,
        });
      }
    },
    stop(): void {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

export interface FramePump {
  stop(): void;
  droppedFrames(): number;
}

/**
 * Pump video frames to a consumer via requestVideoFrameCallback (rAF
 * fallback). The frame gate serializes the async bitmap creation: at most
 * one createImageBitmap (or its delivered frame) is in flight, and frames
 * arriving while it is pending — or while the consumer reports busy — are
 * dropped, never queued.
 */
export function startFramePump(
  video: HTMLVideoElement,
  isBusy: () => boolean,
  deliver: (bitmap: ImageBitmap) => void,
): FramePump {
  let running = true;
  const gate = createFrameGate<ImageBitmap>({
    acquire: () => createImageBitmap(video),
    busy: isBusy,
    deliver,
    dispose: (bitmap) => bitmap.close(),
  });

  type VideoWithVfc = HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number;
  };
  const vfc = (video as VideoWithVfc).requestVideoFrameCallback?.bind(video);

  const schedule = (): void => {
    if (!running) return;
    if (vfc !== undefined) {
      vfc(onFrame);
    } else {
      requestAnimationFrame(onFrame);
    }
  };

  const onFrame = (): void => {
    if (!running) return;
    if (video.readyState >= 2) gate.pulse();
    schedule();
  };

  schedule();
  return {
    stop(): void {
      running = false;
      gate.stop();
    },
    droppedFrames: () => gate.dropped(),
  };
}
