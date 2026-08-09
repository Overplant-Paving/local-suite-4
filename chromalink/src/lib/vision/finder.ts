/**
 * Finder detection: 1:1:3:1:1 run scanning over rows and columns of the
 * thresholded downscale (with a half-pixel quantization allowance — modules
 * are ~1.3 px here), clustering within 5 px with >= 2 confirmations,
 * area-based structural verification and scoring, sub-pixel centroid
 * refinement, TL/TR/BL assignment by perpendicularity and orientation, and
 * the bottom-right beacon search.
 */

import type { GridSize } from '../constants';
import type { BinaryImage } from './threshold';
import type { GrayImage } from './image';

export interface FinderHit {
  x: number;
  y: number;
  moduleSize: number;
}

export interface FinderCluster {
  x: number;
  y: number;
  count: number;
  moduleSize: number;
  /** Structural quality in [0, 3]; filled by scoreFinderCluster. */
  score: number;
}

export interface FinderTriple {
  tl: FinderCluster;
  tr: FinderCluster;
  bl: FinderCluster;
}

function checkRuns(runs: readonly number[], tolerancePct: number): boolean {
  let total = 0;
  for (const r of runs) total += r;
  const m = total / 7;
  if (m < 0.6) return false;
  // tolerance is geometric; +0.5 px absorbs integer run quantization
  const single = (tolerancePct / 100) * m + 0.5;
  const center = 3 * (tolerancePct / 100) * m + 1;
  return (
    Math.abs((runs[0] as number) - m) <= single &&
    Math.abs((runs[1] as number) - m) <= single &&
    Math.abs((runs[2] as number) - 3 * m) <= center &&
    Math.abs((runs[3] as number) - m) <= single &&
    Math.abs((runs[4] as number) - m) <= single
  );
}

function scanLine(
  read: (i: number) => number,
  length: number,
  tolerancePct: number,
  emit: (center: number, moduleSize: number) => void,
): void {
  let runStart = 0;
  let runValue = read(0);
  const starts: number[] = [];
  const lengths: number[] = [];
  const values: number[] = [];
  for (let i = 1; i <= length; i++) {
    const v = i < length ? read(i) : -1;
    if (v !== runValue) {
      starts.push(runStart);
      lengths.push(i - runStart);
      values.push(runValue);
      runStart = i;
      runValue = v;
    }
  }
  for (let r = 0; r + 4 < lengths.length; r++) {
    if ((values[r] as number) !== 1) continue; // pattern starts dark
    const win = [
      lengths[r] as number,
      lengths[r + 1] as number,
      lengths[r + 2] as number,
      lengths[r + 3] as number,
      lengths[r + 4] as number,
    ];
    if (!checkRuns(win, tolerancePct)) continue;
    const center = (starts[r + 2] as number) + (lengths[r + 2] as number) / 2;
    const total =
      (win[0] as number) +
      (win[1] as number) +
      (win[2] as number) +
      (win[3] as number) +
      (win[4] as number);
    emit(center, total / 7);
  }
}

export function findFinderCandidates(bin: BinaryImage, tolerancePct: number): FinderHit[] {
  const hits: FinderHit[] = [];
  const { width, height, pixels } = bin;
  for (let y = 0; y < height; y++) {
    const base = y * width;
    scanLine((i) => pixels[base + i] as number, width, tolerancePct, (cx, m) => {
      hits.push({ x: cx, y: y + 0.5, moduleSize: m });
    });
  }
  for (let x = 0; x < width; x++) {
    scanLine((i) => pixels[i * width + x] as number, height, tolerancePct, (cy, m) => {
      hits.push({ x: x + 0.5, y: cy, moduleSize: m });
    });
  }
  return hits;
}

export function clusterCandidates(hits: readonly FinderHit[], radiusPx = 5): FinderCluster[] {
  const clusters: Array<{ sx: number; sy: number; sm: number; count: number }> = [];
  for (const hit of hits) {
    let merged = false;
    for (const c of clusters) {
      const cx = c.sx / c.count;
      const cy = c.sy / c.count;
      if (Math.abs(cx - hit.x) <= radiusPx && Math.abs(cy - hit.y) <= radiusPx) {
        c.sx += hit.x;
        c.sy += hit.y;
        c.sm += hit.moduleSize;
        c.count += 1;
        merged = true;
        break;
      }
    }
    if (!merged) clusters.push({ sx: hit.x, sy: hit.y, sm: hit.moduleSize, count: 1 });
  }
  return clusters
    .filter((c) => c.count >= 2)
    .map((c) => ({
      x: c.sx / c.count,
      y: c.sy / c.count,
      count: c.count,
      moduleSize: c.sm / c.count,
      score: 0,
    }));
}

function binAt(bin: BinaryImage, x: number, y: number): number {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= bin.width || yi >= bin.height) return 0;
  return bin.pixels[yi * bin.width + xi] as number;
}

/**
 * Re-measure the module size from the dark core's actual extent (the core
 * spans 3 modules): walk outward along both axes until two consecutive
 * light pixels. Run-length averages are too noisy at ~1.3 px modules and a
 * wrong m makes every structural sample land on the wrong ring.
 */
export function measureCoreModuleSize(bin: BinaryImage, cluster: FinderCluster): number {
  const extents: number[] = [];
  for (const [ux, uy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    let lightRun = 0;
    let extent = 0;
    for (let step = 1; step <= 16; step++) {
      if (binAt(bin, cluster.x + ux * step, cluster.y + uy * step) === 1) {
        lightRun = 0;
        extent = step;
      } else {
        lightRun += 1;
        if (lightRun >= 2) break;
      }
    }
    extents.push(extent + 0.5);
  }
  const sum = extents.reduce((a, b) => a + b, 0);
  const m = sum / extents.length / 1.5;
  return Math.min(8, Math.max(0.8, m));
}

/**
 * Scale-free structural check: a real finder shows, from its center along
 * each axis, a solid dark core run, then a light ring run, then a dark
 * border run — regardless of how many pixels one module spans. Multiplied
 * radius sampling is hopeless at ~1.3 px modules because any module-size
 * error lands the probes on the wrong ring; radial run matching is not.
 * Returns a quality score or null when the structure is absent.
 */
export function scoreFinderCluster(bin: BinaryImage, cluster: FinderCluster): number | null {
  // solid immediate core
  let coreDark = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      coreDark += binAt(bin, cluster.x + dx, cluster.y + dy);
    }
  }
  const coreFrac = coreDark / 9;
  if (coreFrac < 0.7) return null;

  let passes = 0;
  const coreExtents: number[] = [];
  for (const [ux, uy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    // radial run pattern: dark core (<=8), light ring (1..6), dark border (1..6)
    let step = 1;
    let coreEnd = 0;
    while (step <= 8 && binAt(bin, cluster.x + ux * step, cluster.y + uy * step) === 1) {
      coreEnd = step;
      step += 1;
    }
    if (step > 8) continue; // never left the dark area — not a finder core
    let lightLen = 0;
    while (step <= coreEnd + 7 && binAt(bin, cluster.x + ux * step, cluster.y + uy * step) === 0) {
      lightLen += 1;
      step += 1;
    }
    if (lightLen < 1 || lightLen > 6) continue;
    let darkLen = 0;
    while (step <= coreEnd + 13 && binAt(bin, cluster.x + ux * step, cluster.y + uy * step) === 1) {
      darkLen += 1;
      step += 1;
    }
    if (darkLen < 1 || darkLen > 6) continue;
    passes += 1;
    coreExtents.push(coreEnd + 0.5);
  }
  if (passes < 3) return null;

  // symmetric core extents are strong evidence of a centered square core
  let mean = 0;
  for (const e of coreExtents) mean += e;
  mean /= coreExtents.length;
  let variance = 0;
  for (const e of coreExtents) variance += (e - mean) * (e - mean);
  variance /= coreExtents.length;
  const m = Math.min(8, Math.max(0.8, mean / 1.5));
  cluster.moduleSize = m;

  // Corner evidence: a real finder has the white quiet zone on exactly two
  // adjacent sides (radial band 5m..7m sits inside the 4-module quiet zone)
  // while random data-field lookalikes are surrounded by noise on all four.
  const light = new Array<number>(4);
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let d = 0; d < 4; d++) {
    const [ux, uy] = dirs[d] as readonly [number, number];
    let lightCount = 0;
    let total = 0;
    for (let radial = 5 * m; radial <= 7 * m; radial += Math.max(0.7, m / 2)) {
      for (let lateral = -2 * m; lateral <= 2 * m; lateral += Math.max(0.7, m / 2)) {
        const px = cluster.x + ux * radial + uy * lateral;
        const py = cluster.y + uy * radial + ux * lateral;
        if (binAt(bin, px, py) === 0) lightCount += 1;
        total += 1;
      }
    }
    light[d] = lightCount / total;
  }
  // adjacent side pairs: (+x,+y) (+x,-y) (-x,+y) (-x,-y) with the opposite
  // pair required to look like data, not quiet
  let cornerness = -1;
  const pairs: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, 2, 1, 3],
    [0, 3, 1, 2],
    [1, 2, 0, 3],
    [1, 3, 0, 2],
  ];
  for (const [a, b, c, d] of pairs) {
    const value =
      Math.min(light[a] as number, light[b] as number) -
      Math.max(light[c] as number, light[d] as number);
    if (value > cornerness) cornerness = value;
  }
  if (cornerness < 0.15) return null;

  return 2 * cornerness + coreFrac + passes / 4 + 0.5 / (1 + variance);
}

/** Sub-pixel refinement: centroid of dark pixels across the 3x3-module core. */
export function refineClusterCenter(bin: BinaryImage, cluster: FinderCluster): void {
  const m = cluster.moduleSize;
  const r = Math.max(2, Math.ceil(1.5 * m));
  let sx = 0;
  let sy = 0;
  let count = 0;
  const x0 = Math.max(0, Math.round(cluster.x - r));
  const x1 = Math.min(bin.width - 1, Math.round(cluster.x + r));
  const y0 = Math.max(0, Math.round(cluster.y - r));
  const y1 = Math.min(bin.height - 1, Math.round(cluster.y + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((bin.pixels[y * bin.width + x] as number) === 1) {
        sx += x;
        sy += y;
        count += 1;
      }
    }
  }
  if (count > 0) {
    cluster.x = sx / count;
    cluster.y = sy / count;
  }
}

interface TripleFit {
  tl: FinderCluster;
  tr: FinderCluster;
  bl: FinderCluster;
  cos: number;
  legRatio: number;
  structural: number;
}

function fitTriple(a: FinderCluster, b: FinderCluster, c: FinderCluster): TripleFit | null {
  let best: TripleFit | null = null;
  const items = [a, b, c] as const;
  for (let i = 0; i < 3; i++) {
    const tl = items[i] as FinderCluster;
    const p = items[(i + 1) % 3] as FinderCluster;
    const q = items[(i + 2) % 3] as FinderCluster;
    const v1x = p.x - tl.x;
    const v1y = p.y - tl.y;
    const v2x = q.x - tl.x;
    const v2y = q.y - tl.y;
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 8 || len2 < 8) continue;
    const cos = Math.abs(v1x * v2x + v1y * v2y) / (len1 * len2);
    const legRatio = Math.min(len1, len2) / Math.max(len1, len2);
    const cross = v1x * v2y - v1y * v2x;
    const tr = cross > 0 ? p : q;
    const bl = cross > 0 ? q : p;
    const fit: TripleFit = {
      tl,
      tr,
      bl,
      cos,
      legRatio,
      structural: tl.score + p.score + q.score,
    };
    if (best === null || fit.cos < best.cos) best = fit;
  }
  return best;
}

/**
 * Choose the finder triple from the strongest verified clusters. The grid
 * is square, so the true triple has near-perpendicular, near-equal legs;
 * among geometrically valid combinations the structurally strongest wins.
 * TR/BL are oriented for a positive cross product (screen coords, y down).
 */
function validTriple(a: FinderCluster, b: FinderCluster, c: FinderCluster): TripleFit | null {
  // all three corners share one physical module scale...
  const sizes = [a.moduleSize, b.moduleSize, c.moduleSize];
  if (Math.max(...sizes) / Math.min(...sizes) > 1.6) return null;
  const fit = fitTriple(a, b, c);
  if (fit === null) return null;
  if (fit.cos > 0.25 || fit.legRatio < 0.75) return null;
  // ...and the leg length in modules must fit some supported grid
  const meanSize = ((sizes[0] as number) + (sizes[1] as number) + (sizes[2] as number)) / 3;
  const legModules = Math.hypot(fit.tr.x - fit.tl.x, fit.tr.y - fit.tl.y) / meanSize;
  if (legModules < 34 || legModules > 190) return null;
  return fit;
}

/**
 * Choose the finder triple from the strongest verified clusters. The grid
 * is square, so the true triple has near-perpendicular, near-equal legs;
 * among geometrically valid combinations the structurally strongest wins.
 * When only two corners verified, complete the right triangle they imply
 * and rescue any weaker cluster sitting where the third corner must be.
 * TR/BL are oriented for a positive cross product (screen coords, y down).
 */
export function selectFinders(
  clusters: readonly FinderCluster[],
  weak: readonly FinderCluster[] = [],
): FinderTriple | null {
  const all = selectFinderTriples(clusters, weak, null, 1, 1);
  return all.length > 0 ? (all[0] as FinderTriple) : null;
}

/**
 * Rank up to maxCount geometrically valid triples, best first. A false
 * cluster can complete a perfectly plausible right triangle with two true
 * finders, so the caller should try these in order and let calibration
 * validity make the final call.
 */
export function selectFinderTriples(
  clusters: readonly FinderCluster[],
  weak: readonly FinderCluster[] = [],
  bin: BinaryImage | null = null,
  maxCombos = 6,
  maxCompletions = 4,
): FinderTriple[] {
  if (clusters.length < 2) return [];
  const ranked = [...clusters].sort((a, b) => b.score - a.score || b.count - a.count).slice(0, 8);

  const sameTriple = (a: TripleFit, b: TripleFit): boolean =>
    (a.tl === b.tl || a.tr === b.tl || a.bl === b.tl) &&
    (a.tl === b.tr || a.tr === b.tr || a.bl === b.tr) &&
    (a.tl === b.bl || a.tr === b.bl || a.bl === b.bl);

  const combos: TripleFit[] = [];
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      for (let k = j + 1; k < ranked.length; k++) {
        const fit = validTriple(
          ranked[i] as FinderCluster,
          ranked[j] as FinderCluster,
          ranked[k] as FinderCluster,
        );
        if (fit !== null && !combos.some((c) => sameTriple(c, fit))) combos.push(fit);
      }
    }
  }

  // Completion rescue: for each strong pair, the square grid leaves only a
  // handful of places the third corner can be (right-angle completions and
  // the diagonal midpoint splits); accept a weaker cluster found there.
  // These are ranked separately and guaranteed trial slots — a rescued
  // member contributes no structural score, so mixed ranking would starve
  // exactly the triples this rescue exists to produce.
  const completions: TripleFit[] = [];
  const pool = [...clusters, ...weak];
  for (let i = 0; i < Math.min(ranked.length, 5); i++) {
    for (let j = i + 1; j < Math.min(ranked.length, 5); j++) {
      const a = ranked[i] as FinderCluster;
      const b = ranked[j] as FinderCluster;
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const leg = Math.hypot(vx, vy);
      if (leg < 8) continue;
      const px = -vy;
      const py = vx;
      const spots: ReadonlyArray<readonly [number, number]> = [
        [a.x + px, a.y + py],
        [a.x - px, a.y - py],
        [b.x + px, b.y + py],
        [b.x - px, b.y - py],
        [(a.x + b.x) / 2 + px / 2, (a.y + b.y) / 2 + py / 2],
        [(a.x + b.x) / 2 - px / 2, (a.y + b.y) / 2 - py / 2],
      ];
      const radius = 0.15 * leg;
      for (const [sx, sy] of spots) {
        let matched = false;
        for (const candidate of pool) {
          if (candidate === a || candidate === b) continue;
          if (Math.hypot(candidate.x - sx, candidate.y - sy) > radius) continue;
          matched = true;
          const fit = validTriple(a, b, candidate);
          if (
            fit !== null &&
            !completions.some((c) => sameTriple(c, fit)) &&
            !combos.some((c) => sameTriple(c, fit))
          ) {
            completions.push(fit);
          }
        }
        // No run hit ever landed here, but a real finder can lose every
        // 1:1:3:1:1 run pattern to quantization at ~1.3 px modules. The spot is
        // independently predicted, so verify the structure directly.
        if (!matched && bin !== null) {
          const synthesized: FinderCluster = {
            x: sx,
            y: sy,
            count: 1,
            moduleSize: (a.moduleSize + b.moduleSize) / 2,
            score: 0,
          };
          refineClusterCenter(bin, synthesized);
          if (Math.hypot(synthesized.x - sx, synthesized.y - sy) <= radius) {
            const score = scoreFinderCluster(bin, synthesized);
            if (score !== null) {
              synthesized.score = score;
              const fit = validTriple(a, b, synthesized);
              if (
                fit !== null &&
                !completions.some((c) => sameTriple(c, fit)) &&
                !combos.some((c) => sameTriple(c, fit))
              ) {
                completions.push(fit);
              }
            }
          }
        }
      }
    }
  }

  const byQuality = (a: TripleFit, b: TripleFit): number =>
    b.structural - 2 * b.cos - (a.structural - 2 * a.cos);
  combos.sort(byQuality);
  completions.sort(byQuality);
  return [...combos.slice(0, maxCombos), ...completions.slice(0, maxCompletions)].map((f) => ({
    tl: f.tl,
    tr: f.tr,
    bl: f.bl,
  }));
}

export interface BeaconLocation {
  x: number;
  y: number;
  fromSearch: boolean;
  /** Mean gray of the winning block — dark beacons are trustworthy anchors,
   * white ones blend into the separator/quiet pool and are not. */
  meanGray: number;
}

interface LineFit {
  /** point on the line */
  px: number;
  py: number;
  /** unit direction */
  dx: number;
  dy: number;
}

function fitLine(points: ReadonlyArray<readonly [number, number]>): LineFit | null {
  const count = points.length;
  if (count < 4) return null;
  let mx = 0;
  let my = 0;
  for (const [x, y] of points) {
    mx += x;
    my += y;
  }
  mx /= count;
  my /= count;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) * (x - mx);
    sxy += (x - mx) * (y - my);
    syy += (y - my) * (y - my);
  }
  // principal axis of the 2x2 covariance
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(angle), dy: Math.sin(angle) };
}

function lineResidual(line: LineFit, x: number, y: number): number {
  return Math.abs(-(line.dy) * (x - line.px) + line.dx * (y - line.py));
}

function intersectLines(a: LineFit, b: LineFit): readonly [number, number] | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
  return [a.px + a.dx * t, a.py + a.dy * t];
}

/**
 * Trace one grid boundary on the gray downscale. Sample points travel
 * along `alongX/alongY` starting from `baseX/baseY`; at each, walk inward
 * from outside the grid, first crossing the white quiet zone (which sets a
 * local brightness reference), then accepting two consecutive pixels that
 * drop >= 40 below that reference as the boundary. Gray + a measured
 * reference matters here: bright calibration patches sit right on the
 * bottom boundary and merge with the quiet zone in the binary map.
 */
function traceEdge(
  gray: GrayImage,
  baseX: number,
  baseY: number,
  alongX: number,
  alongY: number,
  outwardX: number,
  outwardY: number,
  spanPx: number,
): LineFit | null {
  const samples: Array<readonly [number, number]> = [];
  const outLen = Math.hypot(outwardX, outwardY);
  const ox = outwardX / outLen;
  const oy = outwardY / outLen;
  for (let t = 0.15; t <= 0.8; t += 0.05) {
    const px = baseX + alongX * t;
    const py = baseY + alongY * t;
    const startX = px + ox * 0.12 * spanPx;
    const startY = py + oy * 0.12 * spanPx;
    let quietRef = -1;
    let lightRun = 0;
    let previousDrop = false;
    for (let step = 0; step <= 0.3 * spanPx; step += 1) {
      const sx = startX - ox * step;
      const sy = startY - oy * step;
      if (sx < 0 || sy < 0 || sx > gray.width - 1 || sy > gray.height - 1) {
        lightRun = 0;
        previousDrop = false;
        continue;
      }
      const value = bilinearGray(gray, sx, sy);
      if (quietRef < 0 || value > quietRef - 40) {
        if (value > 140) {
          lightRun += 1;
          if (lightRun >= 2) {
            quietRef = quietRef < 0 ? value : Math.max(quietRef * 0.7 + value * 0.3, value);
          }
        } else if (quietRef < 0) {
          lightRun = 0;
        }
        previousDrop = false;
        continue;
      }
      // value dropped >= 40 below the measured quiet reference
      if (previousDrop) {
        samples.push([sx + ox * 1.5, sy + oy * 1.5]);
        break;
      }
      previousDrop = true;
    }
  }
  let line = fitLine(samples);
  if (line === null) return null;
  const kept = samples.filter(([x, y]) => lineResidual(line as LineFit, x, y) <= 1.5);
  if (kept.length >= 4 && kept.length < samples.length) {
    const refit = fitLine(kept);
    if (refit !== null) line = refit;
  }
  return line;
}

/**
 * Recover the grid's outer bottom-right corner as the intersection of the
 * fitted right and bottom boundary lines. Lines are projective, so the
 * intersection is exact under perspective — unlike the parallelogram
 * estimate, which the protocol's own +/-4% corner tests push far enough to
 * land the naive beacon search in the quiet zone.
 */
export function locateGridCorner(gray: GrayImage, triple: FinderTriple): readonly [number, number] | null {
  const exX = triple.tr.x - triple.tl.x;
  const exY = triple.tr.y - triple.tl.y;
  const eyX = triple.bl.x - triple.tl.x;
  const eyY = triple.bl.y - triple.tl.y;
  const spanPx = Math.max(Math.hypot(exX, exY), Math.hypot(eyX, eyY)) * 1.08;
  // right edge: runs from TR toward BR (outward normal ~ +ex)
  const right = traceEdge(gray, triple.tr.x, triple.tr.y, eyX, eyY, exX, exY, spanPx);
  // bottom edge: runs from BL toward BR (outward normal ~ +ey)
  const bottom = traceEdge(gray, triple.bl.x, triple.bl.y, exX, exY, eyX, eyY, spanPx);
  if (right === null || bottom === null) return null;
  const corner = intersectLines(right, bottom);
  if (corner === null) return null;
  // sanity: the corner must sit in the BR quadrant, near the parallelogram
  const estX = triple.tr.x + eyX;
  const estY = triple.tr.y + eyY;
  if (Math.hypot(corner[0] - estX, corner[1] - estY) > 0.35 * spanPx) return null;
  return corner;
}

function bilinearGray(gray: GrayImage, x: number, y: number): number {
  const cx = Math.min(Math.max(x, 0), gray.width - 1);
  const cy = Math.min(Math.max(y, 0), gray.height - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, gray.width - 1);
  const y1 = Math.min(y0 + 1, gray.height - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const p00 = gray.pixels[y0 * gray.width + x0] as number;
  const p10 = gray.pixels[y0 * gray.width + x1] as number;
  const p01 = gray.pixels[y1 * gray.width + x0] as number;
  const p11 = gray.pixels[y1 * gray.width + x1] as number;
  return p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
}

interface BeaconScore {
  x: number;
  y: number;
  variance: number;
  score: number;
  mean: number;
}

function beaconCandidate(
  gray: GrayImage,
  cx: number,
  cy: number,
  exx: number,
  exy: number,
  eyx: number,
  eyy: number,
  driftModules: number,
): BeaconScore {
  const blockHalf = 2.4; // sample the inner ~5 of the 6 beacon modules
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let sy = -blockHalf; sy <= blockHalf; sy += blockHalf / 2) {
    for (let sx = -blockHalf; sx <= blockHalf; sx += blockHalf / 2) {
      const px = cx + (exx * sx + eyx * sy);
      const py = cy + (exy * sx + eyy * sy);
      const v = bilinearGray(gray, px, py);
      sum += v;
      sumSq += v * v;
      count += 1;
    }
  }
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  // Regularize toward the parallelogram estimate: the white quiet zone
  // three modules past the beacon is exactly as uniform as a white beacon,
  // so raw variance alone would happily walk off the grid.
  return { x: cx, y: cy, variance, mean, score: variance + 25 * driftModules * driftModules };
}

/**
 * Estimate the beacon center: start from the affine parallelogram estimate
 * (TR + BL - TL adjusted to the beacon's module position), coarse-search a
 * 15%-of-grid region for the most uniform 6x6-module block, then refine
 * around the winner; fall back to the parallelogram estimate when nothing
 * is convincingly uniform.
 */
export function locateBeacon(
  gray: GrayImage,
  triple: FinderTriple,
  n: GridSize,
  estimate?: readonly [number, number],
): BeaconLocation {
  const span = n - 7; // modules between finder centers
  const exx = (triple.tr.x - triple.tl.x) / span;
  const exy = (triple.tr.y - triple.tl.y) / span;
  const eyx = (triple.bl.x - triple.tl.x) / span;
  const eyy = (triple.bl.y - triple.tl.y) / span;
  const du = n - 3 - 3.5; // beacon center (n-3) relative to TL finder (3.5)
  const estX = estimate !== undefined ? estimate[0] : triple.tl.x + exx * du + eyx * du;
  const estY = estimate !== undefined ? estimate[1] : triple.tl.y + exy * du + eyy * du;

  const modulePx = Math.hypot(exx, exy);
  const gridPx = modulePx * n;
  // With a corner-anchored estimate the beacon is within a couple of
  // modules, so search a tight region at sub-module steps (the scoring
  // basin is under a module wide). The parallelogram fallback estimate can
  // be ~10 px off under the protocol's own +/-4% corner perspective, so it
  // is granted the full 15%-of-grid radius instead.
  const windowPx = estimate !== undefined ? 3 * modulePx : gridPx * 0.15;

  let best: BeaconScore | null = null;
  const coarse = estimate !== undefined ? Math.max(0.4, modulePx / 2) : Math.max(0.5, windowPx / 4);
  for (let oy = -windowPx; oy <= windowPx; oy += coarse) {
    for (let ox = -windowPx; ox <= windowPx; ox += coarse) {
      const cand = beaconCandidate(
        gray,
        estX + ox,
        estY + oy,
        exx,
        exy,
        eyx,
        eyy,
        Math.hypot(ox, oy) / Math.max(modulePx, 1e-6),
      );
      if (best === null || cand.score < best.score) best = cand;
    }
  }
  if (best !== null) {
    const fine = Math.max(0.2, coarse / 4);
    const baseX = best.x;
    const baseY = best.y;
    for (let oy = -coarse; oy <= coarse; oy += fine) {
      for (let ox = -coarse; ox <= coarse; ox += fine) {
        const cx = baseX + ox;
        const cy = baseY + oy;
        const cand = beaconCandidate(
          gray,
          cx,
          cy,
          exx,
          exy,
          eyx,
          eyy,
          Math.hypot(cx - estX, cy - estY) / Math.max(modulePx, 1e-6),
        );
        if (cand.score < best.score) best = cand;
      }
    }
  }

  if (best !== null && best.variance <= 900) {
    return { x: best.x, y: best.y, fromSearch: true, meanGray: best.mean };
  }
  return { x: estX, y: estY, fromSearch: false, meanGray: 255 };
}
