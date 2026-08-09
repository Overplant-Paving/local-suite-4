/**
 * Receiver: camera preview with an aiming guide, worker-driven decoding,
 * session-locked fountain reassembly, SHA-256-gated completion.
 *
 * Status contract (first match wins): exactly "Searching for code…" when
 * no finder for 1 s, "Hold steady" when >40% of the last 30 frames were
 * blurred, "Move closer" when locked with pitch < 3.5 camera px, else
 * "{pct}% · {kbps} KB/s". The first digest mismatch shows exactly
 * "Transfer corrupted — restarting collection"; the second also releases
 * the transfer lock and listens for a fresh sender.
 *
 * Lifecycle: every async continuation (getUserMedia, video.play, focus
 * freeze, worker replies, SHA-256 finalization) is guarded so it cannot
 * touch torn-down or reset state — teardown is guarded by `alive`, reset
 * by session identity and a worker epoch, and camera opening by an
 * in-flight flag so repeated Retry/Reset can never open two cameras.
 * Finalization ownership is keyed to the session instance, not a shared
 * flag: a stale finalizer resolving after Reset can never clear the
 * current finalizer's ownership and let a duplicate through.
 * Completion terminates the worker, stops the camera and pump, and only
 * ever holds one download URL; earlier ones are revoked first.
 */

import {
  CAMERA_PERMISSION_MESSAGE,
  CameraPermissionError,
  openCamera,
  startFramePump,
  type CameraSession,
  type FramePump,
} from './camera';
import DecodeWorker from './decode-worker?worker&inline';
import type { WorkerOutMessage } from './decode-worker';
import { createDecoder } from '../lib/fountain';
import { createReceiveSession, type ReceiveSession } from '../lib/receive-session';
import {
  bytesEqual,
  parseTransferBlob,
  restoreOriginal,
  sanitizeFilename,
} from '../lib/transfer';

const FINDER_TIMEOUT_MS = 1000;
const FREEZE_STREAK = 30;
const MIN_PITCH_PX = 3.5;
const STATUS_REFRESH_MS = 250;
const CORRUPT_HOLD_MS = 2500;

export const SEARCHING_TEXT = 'Searching for code…';
export const HOLD_STEADY_TEXT = 'Hold steady';
export const MOVE_CLOSER_TEXT = 'Move closer';
export const CORRUPTED_TEXT = 'Transfer corrupted — restarting collection';
export const CORRUPTED_UNLOCKED_TEXT =
  'Transfer corrupted — restarting collection. Listening for a fresh transfer.';

export function mountReceiver(root: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'cl-receiver';

  const heading = document.createElement('h2');
  heading.textContent = 'Receive a file';

  const hint = document.createElement('p');
  hint.className = 'cl-hint';
  hint.textContent =
    'Point this camera at the sending screen and keep the code inside the square. Receiving asks only for camera permission; nothing is uploaded anywhere.';

  const stage = document.createElement('div');
  stage.className = 'cl-receive-stage';
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  const guide = document.createElement('div');
  guide.className = 'cl-guide';
  guide.setAttribute('aria-hidden', 'true');
  const overlay = document.createElement('div');
  overlay.className = 'cl-overlay-status';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.textContent = 'Starting camera…';
  stage.append(video, guide, overlay);

  const actions = document.createElement('div');
  actions.className = 'cl-actions';
  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'cl-btn cl-btn-primary';
  retryBtn.textContent = 'Retry camera';
  retryBtn.hidden = true;
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'cl-btn';
  resetBtn.textContent = 'Reset receiver';
  actions.append(retryBtn, resetBtn);

  const done = document.createElement('div');
  done.className = 'cl-done';
  done.hidden = true;

  wrap.append(heading, hint, stage, actions, done);
  root.append(wrap);

  let alive = true;
  let worker: Worker | null = null;
  let workerBusy = false;
  let workerEpoch = 0;
  let camera: CameraSession | null = null;
  let cameraOpening = false;
  let pump: FramePump | null = null;
  let session: ReceiveSession = createReceiveSession(createDecoder);
  let startedAt: number | null = null;
  /** Session whose completion is being finalized, or null when idle. */
  let finalizingFor: ReceiveSession | null = null;
  let completed = false;
  let downloadUrl: string | null = null;
  let lastFinderAt = 0;
  let lastBlurFraction = 0;
  let lastPitch: number | null = null;
  let frozenRequested = false;
  let overlayHoldUntil = 0;

  function setOverlay(text: string, holdMs = 0): void {
    overlay.textContent = text;
    overlayHoldUntil = holdMs > 0 ? performance.now() + holdMs : 0;
  }

  function statusLine(): string {
    const now = performance.now();
    if (now - lastFinderAt > FINDER_TIMEOUT_MS) return SEARCHING_TEXT;
    if (lastBlurFraction > 0.4) return HOLD_STEADY_TEXT;
    const locked = session.expected() !== null;
    if (locked && lastPitch !== null && lastPitch < MIN_PITCH_PX) return MOVE_CLOSER_TEXT;
    if (!locked || startedAt === null) return SEARCHING_TEXT;
    const pct = session.progress();
    const info = session.info();
    const elapsed = (now - startedAt) / 1000;
    const kbps =
      info !== null && elapsed > 0 ? (session.uniqueCount() * info.symbolSize) / 1024 / elapsed : 0;
    return `${Math.floor(pct * 100)}% · ${kbps.toFixed(0)} KB/s`;
  }

  function refreshOverlay(): void {
    if (completed || camera === null) return;
    if (performance.now() < overlayHoldUntil) return;
    setOverlay(statusLine());
  }

  const statusTimer = window.setInterval(() => {
    if (alive) refreshOverlay();
  }, STATUS_REFRESH_MS);

  function revokeDownloadUrl(): void {
    if (downloadUrl !== null) {
      URL.revokeObjectURL(downloadUrl);
      downloadUrl = null;
    }
  }

  function beep(): void {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
      osc.onended = () => {
        void ctx.close();
      };
    } catch (err) {
      console.info('ChromaLink: completion beep unavailable:', err);
    }
  }

  function terminateWorker(): void {
    worker?.terminate();
    worker = null;
    workerBusy = false;
  }

  function stopCapture(): void {
    pump?.stop();
    pump = null;
    camera?.stop();
    camera = null;
    video.srcObject = null;
  }

  async function finalize(raw: Uint8Array): Promise<void> {
    if (finalizingFor !== null || completed) return;
    const current = session;
    finalizingFor = current;
    try {
      const parsed = parseTransferBlob(raw);
      const restored = parsed !== null ? restoreOriginal(parsed) : null;
      let digestOk = false;
      if (parsed !== null && restored !== null) {
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', restored.slice().buffer));
        digestOk = bytesEqual(digest, parsed.sha256);
      }
      // the digest await may have raced pagehide or Reset — never touch
      // torn-down or replaced state from here on
      if (!alive || session !== current || completed) return;
      if (parsed === null || restored === null || !digestOk) {
        const verdict = current.noteDigestMismatch();
        if (verdict === 'restarted') {
          startedAt = performance.now();
          setOverlay(CORRUPTED_TEXT, CORRUPT_HOLD_MS);
        } else {
          startedAt = null;
          setOverlay(CORRUPTED_UNLOCKED_TEXT, CORRUPT_HOLD_MS);
        }
        return;
      }

      completed = true;
      const elapsed = startedAt !== null ? (performance.now() - startedAt) / 1000 : 0;
      const kbps = restored.length / 1024 / Math.max(elapsed, 0.001);
      const name = sanitizeFilename(parsed.filename);
      const blob = new Blob([restored.slice().buffer], { type: 'application/octet-stream' });
      revokeDownloadUrl();
      downloadUrl = URL.createObjectURL(blob);

      done.hidden = false;
      while (done.firstChild !== null) done.removeChild(done.firstChild);
      const title = document.createElement('p');
      title.textContent = `Received ${name}`;
      const meta = document.createElement('p');
      meta.className = 'cl-hint';
      meta.textContent = `${formatBytes(restored.length)} · ${elapsed.toFixed(1)}s · ${kbps.toFixed(0)} KB/s average · SHA-256 verified`;
      const link = document.createElement('a');
      link.className = 'cl-download';
      link.href = downloadUrl;
      link.download = name;
      link.textContent = `Download ${name}`;
      done.append(title, meta, link);
      setOverlay('Complete');
      beep();
      if ('vibrate' in navigator) {
        navigator.vibrate(200);
      }
      // completion releases the capture pipeline: camera, pump, and worker
      stopCapture();
      terminateWorker();
    } finally {
      // release only our own ownership — after a Reset this finalizer is
      // stale and the current session's finalizer may already hold it
      if (finalizingFor === current) finalizingFor = null;
    }
  }

  function handlePacket(message: Extract<WorkerOutMessage, { type: 'packet' }>): void {
    if (completed) return;
    const wasLocked = session.expected() !== null;
    const result = session.accept({
      packet: new Uint8Array(message.packet),
      transferId: message.transferId,
      oti: new Uint8Array(message.oti),
      payloadId: new Uint8Array(message.payloadId),
      n: message.n as 60 | 100 | 140,
    });
    if (result.kind === 'rejected') return;
    if (!wasLocked && session.expected() !== null) {
      startedAt = performance.now();
    }
    if (result.kind === 'complete') {
      void finalize(result.raw);
    }
  }

  function onWorkerMessage(event: MessageEvent): void {
    workerBusy = false;
    if (!alive) return;
    const message = event.data as WorkerOutMessage;
    if (message.epoch !== workerEpoch) return; // in flight across a reset
    lastBlurFraction = message.stats.recentBlurFraction;
    if (message.type === 'packet') {
      lastFinderAt = performance.now();
      lastPitch = message.pitchPx;
      handlePacket(message);
    } else {
      if (
        message.outcome !== 'nofinder' &&
        message.outcome !== 'blur' &&
        message.outcome !== 'error'
      ) {
        lastFinderAt = performance.now();
      }
      if (message.pitchPx !== null) lastPitch = message.pitchPx;
    }
    refreshOverlay();
    if (!frozenRequested && message.stats.finderStreak >= FREEZE_STREAK && camera !== null) {
      frozenRequested = true;
      void camera.freezeFocusAndWhiteBalance();
    }
  }

  function ensureWorker(): void {
    if (worker === null) {
      worker = new DecodeWorker();
      worker.onmessage = onWorkerMessage;
      workerBusy = false;
    }
  }

  async function startCamera(): Promise<void> {
    if (cameraOpening || camera !== null || !alive) return;
    cameraOpening = true;
    retryBtn.hidden = true;
    setOverlay('Starting camera…');
    let opened: CameraSession;
    try {
      opened = await openCamera();
    } catch (err) {
      cameraOpening = false;
      if (!alive) return;
      if (err instanceof CameraPermissionError) {
        setOverlay(CAMERA_PERMISSION_MESSAGE);
      } else {
        console.error('ChromaLink camera failed:', err);
        setOverlay('Camera unavailable. Mobile browsers generally require hosted HTTPS for camera access.');
      }
      retryBtn.hidden = false;
      return;
    }
    if (!alive) {
      // pagehide raced getUserMedia: release the track, leak nothing
      opened.stop();
      cameraOpening = false;
      return;
    }
    camera = opened;
    video.srcObject = opened.stream;
    try {
      await video.play();
    } catch (err) {
      console.info('ChromaLink: video play interrupted:', err);
    }
    cameraOpening = false;
    if (!alive || camera !== opened) return; // torn down while play settled
    setOverlay(SEARCHING_TEXT);
    ensureWorker();
    pump = startFramePump(
      video,
      () => workerBusy,
      (bitmap) => {
        if (worker === null || completed || !alive) {
          bitmap.close();
          return;
        }
        const expected = session.expected();
        workerBusy = true;
        worker.postMessage(
          {
            type: 'frame',
            bitmap,
            epoch: workerEpoch,
            expected:
              expected === null
                ? null
                : { transferId: expected.transferId, oti: expected.oti.slice().buffer },
          },
          [bitmap],
        );
      },
    );
  }

  function teardown(): void {
    if (!alive) return;
    alive = false;
    window.clearInterval(statusTimer);
    stopCapture();
    terminateWorker();
    revokeDownloadUrl();
    session.dispose();
  }

  retryBtn.addEventListener('click', () => {
    void startCamera();
  });
  resetBtn.addEventListener('click', () => {
    // invalidate every in-flight worker result before a stale packet can
    // re-lock, then start a fresh session over the same (or a new) camera
    workerEpoch += 1;
    session.dispose();
    session = createReceiveSession(createDecoder);
    startedAt = null;
    completed = false;
    finalizingFor = null; // any in-flight finalizer is now stale
    done.hidden = true;
    revokeDownloadUrl();
    frozenRequested = false;
    lastFinderAt = 0;
    lastBlurFraction = 0;
    lastPitch = null;
    ensureWorker();
    worker?.postMessage({ type: 'reset' });
    workerBusy = false;
    setOverlay(SEARCHING_TEXT);
    if (camera === null) void startCamera();
  });
  window.addEventListener('pagehide', teardown, { once: true });

  ensureWorker();
  void startCamera();
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
