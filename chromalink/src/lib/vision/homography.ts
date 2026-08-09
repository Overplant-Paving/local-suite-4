/** 4-point DLT homography via 8x8 Gaussian elimination with pivoting. */

export type Homography = Float64Array; // 9 entries, row-major, h[8] = 1

export interface Point {
  x: number;
  y: number;
}

/**
 * Solve for H such that H * (src_i, 1) ~ (dst_i, 1). Exactly determined at
 * four correspondences; with more, the normal equations give the
 * least-squares fit (spreading detection error across all anchors instead
 * of forcing it into the farthest corner). Returns null when singular.
 */
export function homographyFromPoints(
  src: readonly Point[],
  dst: readonly Point[],
  weights?: readonly number[],
): Homography | null {
  if (src.length < 4 || src.length !== dst.length) return null;
  // rows: [x y 1 0 0 0 -ux -uy | u], [0 0 0 x y 1 -vx -vy | v]
  const rows = src.length * 2;
  const a = new Float64Array(rows * 8);
  const b = new Float64Array(rows);
  for (let i = 0; i < src.length; i++) {
    const s = src[i] as Point;
    const d = dst[i] as Point;
    const w = weights !== undefined ? (weights[i] as number) : 1;
    const r1 = i * 2 * 8;
    a[r1] = w * s.x;
    a[r1 + 1] = w * s.y;
    a[r1 + 2] = w;
    a[r1 + 6] = w * -d.x * s.x;
    a[r1 + 7] = w * -d.x * s.y;
    b[i * 2] = w * d.x;
    const r2 = (i * 2 + 1) * 8;
    a[r2 + 3] = w * s.x;
    a[r2 + 4] = w * s.y;
    a[r2 + 5] = w;
    a[r2 + 6] = w * -d.y * s.x;
    a[r2 + 7] = w * -d.y * s.y;
    b[i * 2 + 1] = w * d.y;
  }
  // normal equations: (A^T A) h = A^T b, solved as an 8x9 augmented system
  const m = new Float64Array(8 * 9);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      let acc = 0;
      for (let r = 0; r < rows; r++) {
        acc += (a[r * 8 + i] as number) * (a[r * 8 + j] as number);
      }
      m[i * 9 + j] = acc;
    }
    let accB = 0;
    for (let r = 0; r < rows; r++) {
      accB += (a[r * 8 + i] as number) * (b[r] as number);
    }
    m[i * 9 + 8] = accB;
  }

  // Gaussian elimination with partial pivoting on the 8x9 augmented system.
  for (let col = 0; col < 8; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(m[col * 9 + col] as number);
    for (let r = col + 1; r < 8; r++) {
      const a = Math.abs(m[r * 9 + col] as number);
      if (a > pivotAbs) {
        pivotAbs = a;
        pivotRow = r;
      }
    }
    if (pivotAbs < 1e-12) return null;
    if (pivotRow !== col) {
      for (let c = 0; c < 9; c++) {
        const tmp = m[col * 9 + c] as number;
        m[col * 9 + c] = m[pivotRow * 9 + c] as number;
        m[pivotRow * 9 + c] = tmp;
      }
    }
    const pivot = m[col * 9 + col] as number;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const factor = (m[r * 9 + col] as number) / pivot;
      if (factor === 0) continue;
      for (let c = col; c < 9; c++) {
        m[r * 9 + c] = (m[r * 9 + c] as number) - factor * (m[col * 9 + c] as number);
      }
    }
  }

  const h = new Float64Array(9);
  for (let i = 0; i < 8; i++) {
    h[i] = (m[i * 9 + 8] as number) / (m[i * 9 + i] as number);
  }
  h[8] = 1;
  return h;
}

/** Map (x, y) through the homography. */
export function applyHomography(h: Homography, x: number, y: number, out: Point): void {
  const w = (h[6] as number) * x + (h[7] as number) * y + (h[8] as number);
  out.x = ((h[0] as number) * x + (h[1] as number) * y + (h[2] as number)) / w;
  out.y = ((h[3] as number) * x + (h[4] as number) * y + (h[5] as number)) / w;
}

/** Inverse homography via the adjugate (scale-free). Returns null if singular. */
export function invertHomography(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, i, j] = h as unknown as [
    number, number, number, number, number, number, number, number, number,
  ];
  const out = new Float64Array(9);
  out[0] = e * j - f * i;
  out[1] = c * i - b * j;
  out[2] = b * f - c * e;
  out[3] = f * g - d * j;
  out[4] = a * j - c * g;
  out[5] = c * d - a * f;
  out[6] = d * i - e * g;
  out[7] = b * g - a * i;
  out[8] = a * e - b * d;
  const det = a * (out[0] as number) + b * (out[3] as number) + c * (out[6] as number);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return out;
}
