/**
 * Sender: pick a file, lock grid/fps, stream fountain-coded color frames.
 * Ordered start: build blob -> lock N/fps -> create encoder sized to the
 * frame payload capacity -> random u32 transferId -> wake lock (continue if
 * unavailable). setInterval-driven (not rAF); pauses while hidden; exactly
 * one packet per displayed frame with alternating beacon parity.
 */

import {
  DEFAULT_FPS,
  DEFAULT_GRID,
  GRID_SIZES,
  MAX_FILE_BYTES,
  MAX_FILE_ERROR,
  SENDER_FPS_OPTIONS,
  type GridSize,
  type SenderFps,
} from '../lib/constants';
import { crc32 } from '../lib/crc';
import { encodeFrame } from '../lib/frame-encode';
import { alignedSymbolSize, createEncoder, type FountainEncoder } from '../lib/fountain';
import { buildProtectedHeader } from '../lib/header';
import { capacity } from '../lib/layout';
import { buildTransferBlob } from '../lib/transfer';
import { createRenderer, type SenderRenderer } from './renderer';

const GRID_LABELS: Record<GridSize, string> = {
  60: '60 Robust',
  100: '100 Standard',
  140: '140 Dense',
};

const STREAM_HINT = 'Prop both phones against something for best speed. Set screen brightness to max.';

interface ActiveStream {
  n: GridSize;
  fps: SenderFps;
  transferId: number;
  encoder: FountainEncoder;
  renderer: SenderRenderer;
  payloadBytes: number;
  timer: number | null;
  sequence: number;
  stage: HTMLElement;
  counter: HTMLElement;
  wakeLock: WakeLockSentinel | null;
  onVisibility: () => void;
  onResize: () => void;
  onPageHide: () => void;
  lastIndices: Uint8Array | null;
}

export function mountSender(root: HTMLElement): void {
  let file: File | null = null;
  /** Selection whose start-time read proved empty/oversize; Start stays off. */
  let invalidFile: File | null = null;
  let stream: ActiveStream | null = null;
  let starting = false;

  // Start is armed only while the selected file passes every known check
  // and nothing is streaming or starting — recomputed after every state
  // change, never blanket-enabled from an async continuation.
  function startAllowed(): boolean {
    return (
      !starting &&
      stream === null &&
      file !== null &&
      file !== invalidFile &&
      file.size > 0 &&
      file.size <= MAX_FILE_BYTES
    );
  }

  function refreshStartBtn(): void {
    startBtn.disabled = !startAllowed();
  }

  const wrap = document.createElement('div');
  wrap.className = 'cl-sender';

  const heading = document.createElement('h2');
  heading.textContent = 'Send a file';

  const fileField = document.createElement('label');
  fileField.className = 'cl-field';
  fileField.textContent = 'File';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileField.append(fileInput);

  const gridField = document.createElement('label');
  gridField.className = 'cl-field';
  gridField.textContent = 'Grid';
  const gridSelect = document.createElement('select');
  for (const size of GRID_SIZES) {
    const opt = document.createElement('option');
    opt.value = String(size);
    opt.textContent = GRID_LABELS[size];
    if (size === DEFAULT_GRID) opt.selected = true;
    gridSelect.append(opt);
  }
  gridField.append(gridSelect);

  const fpsField = document.createElement('label');
  fpsField.className = 'cl-field';
  fpsField.textContent = 'Frames per second';
  const fpsSelect = document.createElement('select');
  for (const fps of SENDER_FPS_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = String(fps);
    opt.textContent = String(fps);
    if (fps === DEFAULT_FPS) opt.selected = true;
    fpsSelect.append(opt);
  }
  fpsField.append(fpsSelect);

  const actions = document.createElement('div');
  actions.className = 'cl-actions';
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'cl-btn cl-btn-primary';
  startBtn.textContent = 'Start';
  startBtn.disabled = true;
  actions.append(startBtn);

  const status = document.createElement('p');
  status.className = 'cl-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Choose a file to send.';

  const hint = document.createElement('p');
  hint.className = 'cl-hint';
  hint.textContent =
    'The whole transfer happens on this screen — nothing is uploaded. The receiving phone watches this screen with its camera.';

  wrap.append(heading, fileField, gridField, fpsField, actions, status, hint);
  root.append(wrap);

  function setStatus(text: string, isError: boolean): void {
    status.textContent = text;
    status.classList.toggle('cl-status-error', isError);
  }

  fileInput.addEventListener('change', () => {
    file = fileInput.files && fileInput.files.length > 0 ? (fileInput.files[0] as File) : null;
    invalidFile = null; // a new selection gets a fresh start-time verdict
    if (file === null) {
      setStatus('Choose a file to send.', false);
    } else if (file.size === 0) {
      setStatus('That file is empty — choose a non-empty file.', true);
    } else if (file.size > MAX_FILE_BYTES) {
      setStatus(MAX_FILE_ERROR, true);
    } else {
      setStatus(`${file.name} · ${formatBytes(file.size)} ready.`, false);
    }
    refreshStartBtn();
  });

  function lockedGrid(): GridSize {
    const value = Number(gridSelect.value);
    return (GRID_SIZES as readonly number[]).includes(value) ? (value as GridSize) : DEFAULT_GRID;
  }

  function lockedFps(): SenderFps {
    const value = Number(fpsSelect.value);
    return (SENDER_FPS_OPTIONS as readonly number[]).includes(value) ? (value as SenderFps) : DEFAULT_FPS;
  }

  function stopStream(): void {
    if (stream === null) return;
    const s = stream;
    stream = null;
    if (s.timer !== null) window.clearInterval(s.timer);
    document.removeEventListener('visibilitychange', s.onVisibility);
    window.removeEventListener('resize', s.onResize);
    window.removeEventListener('pagehide', s.onPageHide);
    if (s.wakeLock !== null) {
      s.wakeLock.release().catch(() => undefined);
      s.wakeLock = null;
    }
    s.encoder.dispose();
    s.stage.remove();
    gridSelect.disabled = false;
    fpsSelect.disabled = false;
    fileInput.disabled = false;
    setStatus('Transfer stopped. The receiver keeps whatever it already recovered.', false);
    refreshStartBtn();
  }

  /**
   * Acquire (or re-acquire) the screen wake lock for an active stream. The
   * request resolves asynchronously; if the stream was stopped or the page
   * hidden meanwhile, the freshly granted lock is released immediately
   * instead of being attached to stale state.
   */
  function acquireWakeLock(s: ActiveStream): void {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock
      .request('screen')
      .then((lock) => {
        if (stream === s && document.visibilityState === 'visible' && s.wakeLock === null) {
          s.wakeLock = lock;
        } else {
          lock.release().catch(() => undefined);
        }
      })
      .catch(() => undefined); // unavailable — continue without it
  }

  async function startStream(): Promise<void> {
    const selected = file;
    if (selected === null || !startAllowed()) return;
    starting = true;
    startBtn.disabled = true;
    let encoder: FountainEncoder | null = null;
    let stage: HTMLElement | null = null;
    let s: ActiveStream | null = null;
    try {
      setStatus('Preparing transfer…', false);
      const bytes = new Uint8Array(await selected.arrayBuffer());
      if (bytes.length === 0) {
        invalidFile = selected; // e.g. the file shrank on disk after selection
        setStatus('That file is empty — choose a non-empty file.', true);
        return;
      }
      if (bytes.length > MAX_FILE_BYTES) {
        invalidFile = selected;
        setStatus(MAX_FILE_ERROR, true);
        return;
      }
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const blob = buildTransferBlob(selected.name, bytes, digest);

      const n = lockedGrid();
      const fps = lockedFps();
      const payloadBytes = capacity(n).payloadBytes;
      encoder = createEncoder(blob, alignedSymbolSize(payloadBytes));
      const idWord = new Uint32Array(1);
      crypto.getRandomValues(idWord);
      const transferId = idWord[0] as number;

      stage = document.createElement('div');
      stage.className = 'cl-stage';
      const renderer = createRenderer();
      const meta = document.createElement('div');
      meta.className = 'cl-stage-meta';
      const counter = document.createElement('span');
      counter.textContent = 'frame 0';
      const stopBtn = document.createElement('button');
      stopBtn.type = 'button';
      stopBtn.className = 'cl-btn';
      stopBtn.textContent = 'Stop';
      const stageHint = document.createElement('p');
      stageHint.className = 'cl-stage-meta';
      stageHint.textContent = STREAM_HINT;
      meta.append(counter, document.createTextNode(' · '), stopBtn);
      stage.append(renderer.canvas, meta, stageHint);
      document.body.append(stage);
      renderer.resize(n);

      s = {
        n,
        fps,
        transferId,
        encoder,
        renderer,
        payloadBytes,
        timer: null,
        sequence: 0,
        stage,
        counter,
        wakeLock: null,
        onVisibility: () => undefined,
        onResize: () => undefined,
        onPageHide: () => undefined,
        lastIndices: null,
      };

      const active: ActiveStream = s;
      const tick = (): void => {
        const packet = active.encoder.nextPacket();
        const payload = new Uint8Array(active.payloadBytes);
        payload.set(packet, 0);
        const header = buildProtectedHeader({
          transferId: active.transferId,
          oti: active.encoder.oti,
          payloadId: packet.slice(0, 4),
          payloadCrc32: crc32(payload),
        });
        const indices = encodeFrame({
          n: active.n,
          header,
          payload,
          sequenceParity: (active.sequence & 1) as 0 | 1,
        });
        active.renderer.drawFrame(indices, active.n);
        active.lastIndices = indices;
        active.sequence += 1;
        active.counter.textContent = `frame ${active.sequence}`;
      };

      const startTimer = (): void => {
        if (active.timer === null) {
          active.timer = window.setInterval(tick, 1000 / active.fps);
        }
      };
      const pauseTimer = (): void => {
        if (active.timer !== null) {
          window.clearInterval(active.timer);
          active.timer = null;
        }
      };

      active.onVisibility = () => {
        if (document.visibilityState === 'hidden') {
          pauseTimer();
          // the browser auto-releases hidden wake locks; drop our handle so
          // the visible path can re-acquire (release is idempotent)
          if (active.wakeLock !== null) {
            active.wakeLock.release().catch(() => undefined);
            active.wakeLock = null;
          }
        } else if (stream === active) {
          startTimer();
          acquireWakeLock(active);
        }
      };
      active.onResize = () => {
        if (stream === active) {
          active.renderer.resize(active.n);
          if (active.lastIndices !== null) active.renderer.drawFrame(active.lastIndices, active.n);
        }
      };
      active.onPageHide = () => {
        if (stream === active) stopStream();
      };
      stopBtn.addEventListener('click', () => {
        if (stream === active) stopStream();
      });
      document.addEventListener('visibilitychange', active.onVisibility);
      window.addEventListener('resize', active.onResize);
      window.addEventListener('pagehide', active.onPageHide);

      stream = active;
      gridSelect.disabled = true;
      fpsSelect.disabled = true;
      fileInput.disabled = true;
      setStatus(`Streaming ${selected.name} — grid ${n}, ${fps} fps.`, false);
      startTimer();
      acquireWakeLock(active);
    } catch (err) {
      console.error('ChromaLink sender start failed:', err);
      // a failure before the stream registered must not leave a white
      // stage covering the page or leak the encoder/wake lock
      if (s === null || stream !== s) {
        if (s !== null) {
          document.removeEventListener('visibilitychange', s.onVisibility);
          window.removeEventListener('resize', s.onResize);
          window.removeEventListener('pagehide', s.onPageHide);
          if (s.timer !== null) window.clearInterval(s.timer);
          if (s.wakeLock !== null) {
            s.wakeLock.release().catch(() => undefined);
            s.wakeLock = null;
          }
        }
        stage?.remove();
        encoder?.dispose();
      }
      setStatus('Could not start the transfer. See the console for details.', true);
    } finally {
      starting = false;
      refreshStartBtn();
    }
  }

  startBtn.addEventListener('click', () => {
    void startStream();
  });

  // Grid/fps are locked while streaming (controls disabled); if a change
  // ever lands mid-stream, tear down and start a fresh transfer identity.
  const restartOnChange = (): void => {
    if (stream !== null) {
      stopStream();
      void startStream();
    }
  };
  gridSelect.addEventListener('change', restartOnChange);
  fpsSelect.addEventListener('change', restartOnChange);
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
