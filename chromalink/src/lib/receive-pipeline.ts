/**
 * Production receive path on plain buffers: staged-scale vision, header
 * decode, session filtering, duplicate detection, payload decode, and the
 * running statistics contract. The decode worker is a thin DOM shell
 * around this module (rasterize → process → post), which keeps every
 * decision here unit-testable.
 *
 * Scale escalation is decode-aware: the 160 px pass runs always; the
 * costlier 240/320 px passes run only when no cheaper scale produced a
 * packet (or a duplicate — proof the frame is decodable). Cheap rejects
 * stay first: the sharpness gate runs before any detection.
 */

import { SHARPNESS_MIN, type GridSize } from './constants';
import { decodeFrameHeader, decodeFramePayload } from './frame-decode';
import { bytesEqual } from './transfer';
import type { RgbaImage } from './vision/image';
import {
  classifyTrial,
  DEFAULT_TUNING,
  DETECTION_SCALES,
  detectTrialsAtScale,
  freshVisionState,
  prepareFrame,
  updateGridLock,
  type VisionState,
  type VisionTuning,
} from './vision/pipeline';

/** Every reason a frame can fail to contribute a packet. */
export type RejectReason =
  | 'blur'
  | 'nofinder'
  | 'washout'
  | 'nogrid'
  | 'undecodable'
  | 'filtered'
  | 'payload-mismatch'
  | 'error';

const REJECT_REASONS: readonly RejectReason[] = [
  'blur',
  'nofinder',
  'washout',
  'nogrid',
  'undecodable',
  'filtered',
  'payload-mismatch',
  'error',
];

export interface ReceiveStats {
  /** Camera frames analyzed. */
  frames: number;
  /** Frames whose protected header decoded — a displayed code frame seen. */
  displayedSeen: number;
  /** Packets fully decoded and delivered. */
  decoded: number;
  /** Frames skipped because they repeat the last delivered PayloadId. */
  dups: number;
  /** Running reject counts, one bucket per reason. */
  rejects: Record<RejectReason, number>;
  /** Consecutive finder-positive frames (any verified finder triple). */
  finderStreak: number;
  /** Fraction of blur outcomes over the last 30 frames. */
  recentBlurFraction: number;
}

function freshStats(): ReceiveStats {
  const rejects = {} as Record<RejectReason, number>;
  for (const reason of REJECT_REASONS) rejects[reason] = 0;
  return {
    frames: 0,
    displayedSeen: 0,
    decoded: 0,
    dups: 0,
    rejects,
    finderStreak: 0,
    recentBlurFraction: 0,
  };
}

/** The locked transfer identity a session imposes on every later frame. */
export interface ExpectedTransfer {
  transferId: number;
  oti: Uint8Array;
}

export type ProcessResult =
  | {
      type: 'packet';
      /** Full frame payload; the session truncates to the OTI packet size. */
      packet: Uint8Array;
      transferId: number;
      oti: Uint8Array;
      payloadId: Uint8Array;
      n: GridSize;
      pitchPx: number;
      stats: ReceiveStats;
    }
  | {
      type: 'status';
      outcome: RejectReason | 'dup';
      n: GridSize | null;
      pitchPx: number | null;
      stats: ReceiveStats;
    };

export interface FrameProcessor {
  /** Analyze one camera frame; never throws on malformed input. */
  process(img: RgbaImage | null, expected: ExpectedTransfer | null): ProcessResult;
  /** Forget the vision lock, duplicate state, and statistics. */
  reset(): void;
  stats(): ReceiveStats;
  gridLock(): GridSize | null;
}

export function createFrameProcessor(tuning: VisionTuning = DEFAULT_TUNING): FrameProcessor {
  let visionState: VisionState = freshVisionState();
  let lastPayloadKey: string | null = null;
  let stats = freshStats();
  let recentBlur: number[] = [];

  function noteBlur(isBlur: boolean): void {
    recentBlur.push(isBlur ? 1 : 0);
    if (recentBlur.length > 30) recentBlur.shift();
    let sum = 0;
    for (const b of recentBlur) sum += b;
    stats.recentBlurFraction = recentBlur.length > 0 ? sum / recentBlur.length : 0;
  }

  function snapshot(): ReceiveStats {
    return { ...stats, rejects: { ...stats.rejects } };
  }

  function reject(
    reason: RejectReason,
    n: GridSize | null,
    pitchPx: number | null,
    finderPositive: boolean,
  ): ProcessResult {
    stats.rejects[reason] += 1;
    stats.finderStreak = finderPositive ? stats.finderStreak + 1 : 0;
    noteBlur(reason === 'blur');
    return { type: 'status', outcome: reason, n, pitchPx, stats: snapshot() };
  }

  function processInner(img: RgbaImage, expected: ExpectedTransfer | null): ProcessResult {
    const prep = prepareFrame(img);
    if (prep.sharpness < SHARPNESS_MIN) {
      return reject('blur', null, null, false);
    }

    let sawTriple = false;
    let sawWashout = false;
    let sawHeader = false;
    let sawFiltered = false;
    let sawPayloadMismatch = false;
    let firstN: GridSize | null = null;
    let firstPitch: number | null = null;

    for (const width of DETECTION_SCALES) {
      const scale = detectTrialsAtScale(img, visionState, tuning, width, prep);
      sawTriple = sawTriple || scale.sawTriple;
      sawWashout = sawWashout || scale.sawWashout;
      for (const trial of scale.trials.slice(0, 4)) {
        const outcome = classifyTrial(img, trial, prep.sharpness, tuning);
        if (outcome.kind !== 'frame') continue;
        if (firstN === null) {
          firstN = outcome.n;
          firstPitch = outcome.pitchPx;
        }
        const header = decodeFrameHeader(outcome.indices, outcome.n);
        if (header === null) continue;
        sawHeader = true;
        if (
          expected !== null &&
          (header.transferId !== expected.transferId || !bytesEqual(header.oti, expected.oti))
        ) {
          // locked session: a frame with the wrong transfer id — or the
          // same id with a different OTI — never reaches payload work
          sawFiltered = true;
          continue;
        }

        // duplicate detection after header decode, before payload work
        const idKey = `${header.transferId}:${Array.from(header.payloadId).join('.')}`;
        if (idKey === lastPayloadKey) {
          stats.dups += 1;
          stats.displayedSeen += 1;
          stats.finderStreak += 1;
          noteBlur(false);
          updateGridLock(visionState, outcome.n);
          return {
            type: 'status',
            outcome: 'dup',
            n: outcome.n,
            pitchPx: outcome.pitchPx,
            stats: snapshot(),
          };
        }

        const payload = decodeFramePayload(outcome.indices, outcome.n, header, outcome.margins);
        if (payload === null) continue;
        if (!bytesEqual(payload.subarray(0, header.payloadId.length), header.payloadId)) {
          // packet bytes and header PayloadId must agree before RaptorQ
          sawPayloadMismatch = true;
          continue;
        }

        lastPayloadKey = idKey;
        stats.decoded += 1;
        stats.displayedSeen += 1;
        stats.finderStreak += 1;
        noteBlur(false);
        updateGridLock(visionState, outcome.n);
        return {
          type: 'packet',
          packet: payload,
          transferId: header.transferId,
          oti: header.oti,
          payloadId: header.payloadId,
          n: outcome.n,
          pitchPx: outcome.pitchPx,
          stats: snapshot(),
        };
      }
      // no packet at this scale: escalate to the next (costlier) one
    }

    if (sawHeader) stats.displayedSeen += 1;
    if (firstN !== null) updateGridLock(visionState, firstN);
    if (sawPayloadMismatch) return reject('payload-mismatch', firstN, firstPitch, true);
    if (sawFiltered) return reject('filtered', firstN, firstPitch, true);
    if (firstN !== null) return reject('undecodable', firstN, firstPitch, true);
    if (sawTriple) return reject(sawWashout ? 'washout' : 'nogrid', null, null, true);
    return reject('nofinder', null, null, false);
  }

  return {
    process(img: RgbaImage | null, expected: ExpectedTransfer | null): ProcessResult {
      stats.frames += 1;
      try {
        if (
          img === null ||
          img.width <= 0 ||
          img.height <= 0 ||
          img.pixels.length < img.width * img.height * 4
        ) {
          return reject('error', null, null, false);
        }
        return processInner(img, expected);
      } catch {
        // one bad frame must never take the receive loop down
        return reject('error', null, null, false);
      }
    },
    reset(): void {
      visionState = freshVisionState();
      lastPayloadKey = null;
      stats = freshStats();
      recentBlur = [];
    },
    stats: snapshot,
    gridLock: () => visionState.lockedN,
  };
}
