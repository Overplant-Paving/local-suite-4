/**
 * Systematic Reed–Solomon over GF(256), poly 0x11D, alpha = 2, fcr = 0.
 * Decoder: Berlekamp–Massey + Chien search + Forney; corrects up to
 * floor(parityLen / 2) byte errors and returns null on any inconsistency.
 */

import { GF_EXP, GF_LOG, gfDiv, gfInv, gfMul, gfPow } from './gf256';

/** Monic generator polynomial, descending powers: [1, g_{p-1}, ..., g_0]. */
export function generatorPoly(parityLen: number): Uint8Array {
  let g = new Uint8Array([1]);
  for (let i = 0; i < parityLen; i++) {
    const root = gfPow(2, i);
    // multiply by (x + root): shift for the x term, scale for the root term
    const next = new Uint8Array(g.length + 1);
    for (let j = 0; j < g.length; j++) {
      const gj = g[j] as number;
      next[j] = (next[j] as number) ^ gj;
      next[j + 1] = (next[j + 1] as number) ^ gfMul(gj, root);
    }
    g = next;
  }
  return g;
}

/** Systematic encode: returns data || parity (length data.length + parityLen). */
export function encode(data: Uint8Array, parityLen: number): Uint8Array {
  if (parityLen < 1 || data.length + parityLen > 255) {
    throw new RangeError('rs: codeword must fit GF(256)');
  }
  const gen = generatorPoly(parityLen);
  const parity = new Uint8Array(parityLen);
  for (let i = 0; i < data.length; i++) {
    const factor = (data[i] as number) ^ (parity[0] as number);
    parity.copyWithin(0, 1);
    parity[parityLen - 1] = 0;
    if (factor !== 0) {
      const flog = GF_LOG[factor] as number;
      for (let j = 0; j < parityLen; j++) {
        const g = gen[j + 1] as number;
        if (g !== 0) {
          parity[j] = (parity[j] as number) ^ (GF_EXP[flog + (GF_LOG[g] as number)] as number);
        }
      }
    }
  }
  const out = new Uint8Array(data.length + parityLen);
  out.set(data, 0);
  out.set(parity, data.length);
  return out;
}

function syndromes(codeword: Uint8Array, parityLen: number): { syn: Uint8Array; clean: boolean } {
  const syn = new Uint8Array(parityLen);
  let clean = true;
  for (let j = 0; j < parityLen; j++) {
    // S_j = codeword polynomial evaluated at alpha^j (Horner, c[0] = highest power)
    const a = gfPow(2, j);
    let acc = 0;
    for (let i = 0; i < codeword.length; i++) {
      acc = gfMul(acc, a) ^ (codeword[i] as number);
    }
    syn[j] = acc;
    if (acc !== 0) clean = false;
  }
  return { syn, clean };
}

function polyDegree(p: Uint8Array): number {
  for (let d = p.length - 1; d > 0; d--) {
    if ((p[d] as number) !== 0) return d;
  }
  return 0;
}

/** Berlekamp–Massey over an arbitrary syndrome sequence (ascending sigma). */
function berlekampMassey(seq: Uint8Array): { sigma: Uint8Array; nu: number } | null {
  const q = seq.length;
  let sigma = new Uint8Array(q + 1);
  let prev = new Uint8Array(q + 1);
  sigma[0] = 1;
  prev[0] = 1;
  let nu = 0;
  let m = 1;
  let bcoef = 1;
  for (let n = 0; n < q; n++) {
    let d = seq[n] as number;
    for (let i = 1; i <= nu; i++) {
      d ^= gfMul(sigma[i] as number, seq[n - i] as number);
    }
    if (d === 0) {
      m += 1;
    } else if (2 * nu <= n) {
      const t = sigma.slice();
      const coef = gfDiv(d, bcoef);
      for (let i = 0; i + m <= q; i++) {
        const pv = prev[i] as number;
        if (pv !== 0) sigma[i + m] = (sigma[i + m] as number) ^ gfMul(coef, pv);
      }
      nu = n + 1 - nu;
      prev = t;
      bcoef = d;
      m = 1;
    } else {
      const coef = gfDiv(d, bcoef);
      for (let i = 0; i + m <= q; i++) {
        const pv = prev[i] as number;
        if (pv !== 0) sigma[i + m] = (sigma[i + m] as number) ^ gfMul(coef, pv);
      }
      m += 1;
    }
  }
  if (2 * nu > q) return null;
  if (polyDegree(sigma) !== nu) return null;
  return { sigma, nu };
}

/** Multiply two ascending-coefficient polynomials over GF(256). */
function polyMulAsc(a: Uint8Array, degA: number, b: Uint8Array, degB: number): Uint8Array {
  const out = new Uint8Array(degA + degB + 1);
  for (let i = 0; i <= degA; i++) {
    const av = a[i] as number;
    if (av === 0) continue;
    for (let j = 0; j <= degB; j++) {
      const bv = b[j] as number;
      if (bv !== 0) out[i + j] = (out[i + j] as number) ^ gfMul(av, bv);
    }
  }
  return out;
}

/**
 * Decode a systematic codeword; corrects e errors and E declared erasures
 * whenever 2e + E <= parityLen (so up to floor(parityLen/2) plain errors).
 * Erasures are codeword positions the caller believes are unreliable —
 * errors-and-erasures decoding via Forney syndromes doubles the value of
 * the classifier's own confidence information. Returns the corrected DATA
 * portion, or null when decoding fails. Never throws on malformed content.
 */
export function decode(
  codeword: Uint8Array,
  parityLen: number,
  erasures?: readonly number[],
): Uint8Array | null {
  const total = codeword.length;
  if (parityLen < 1 || total <= parityLen || total > 255) return null;
  const dataLen = total - parityLen;
  const { syn, clean } = syndromes(codeword, parityLen);
  if (clean) return codeword.slice(0, dataLen);

  // erasure locator Gamma(x) = prod(1 + X_i x), ascending coefficients
  const erasedPositions: number[] = [];
  if (erasures !== undefined) {
    const seen = new Set<number>();
    for (const pos of erasures) {
      if (!Number.isInteger(pos) || pos < 0 || pos >= total || seen.has(pos)) continue;
      seen.add(pos);
      erasedPositions.push(pos);
    }
  }
  const e = erasedPositions.length;
  if (e > parityLen - 2) return null;
  let gamma = new Uint8Array([1]);
  let gammaDeg = 0;
  for (const pos of erasedPositions) {
    const x = gfPow(2, (total - 1 - pos) % 255);
    const next = new Uint8Array(gammaDeg + 2);
    for (let i = 0; i <= gammaDeg; i++) {
      const gv = gamma[i] as number;
      next[i] = (next[i] as number) ^ gv;
      next[i + 1] = (next[i + 1] as number) ^ gfMul(gv, x);
    }
    gamma = next;
    gammaDeg += 1;
  }

  // Forney syndromes: coefficients E..p-1 of Gamma(x) * S(x)
  const forney = new Uint8Array(parityLen - e);
  for (let j = e; j < parityLen; j++) {
    let acc = 0;
    for (let k = 0; k <= Math.min(j, gammaDeg); k++) {
      acc ^= gfMul(gamma[k] as number, syn[j - k] as number);
    }
    forney[j - e] = acc;
  }

  const bm = berlekampMassey(forney);
  if (bm === null) return null;
  const nu = bm.nu;
  if (nu === 0 && e === 0) return null;

  // combined locator Psi = sigma * Gamma covers errors and erasures alike
  const psi = polyMulAsc(bm.sigma, nu, gamma, gammaDeg);
  const psiDeg = nu + gammaDeg;

  // Chien search over the shortened positions: position i has locator
  // X = alpha^(total-1-i); it is affected when Psi(X^-1) = 0.
  const positions: number[] = [];
  const locators: number[] = [];
  for (let i = 0; i < total; i++) {
    const power = total - 1 - i;
    const xInv = gfPow(2, (255 - (power % 255)) % 255);
    let acc = 0;
    let xp = 1;
    for (let k = 0; k <= psiDeg; k++) {
      acc ^= gfMul(psi[k] as number, xp);
      xp = gfMul(xp, xInv);
    }
    if (acc === 0) {
      positions.push(i);
      locators.push(gfPow(2, power % 255));
    }
  }
  if (positions.length !== psiDeg) return null;

  // Forney: Omega(x) = S(x) * Psi(x) mod x^parityLen.
  const omega = new Uint8Array(parityLen);
  for (let i = 0; i < parityLen; i++) {
    let acc = 0;
    for (let k = 0; k <= Math.min(i, psiDeg); k++) {
      acc ^= gfMul(psi[k] as number, syn[i - k] as number);
    }
    omega[i] = acc;
  }

  const corrected = codeword.slice();
  for (let idx = 0; idx < positions.length; idx++) {
    const x = locators[idx] as number;
    const xInv = gfInv(x);
    let omegaVal = 0;
    let xp = 1;
    for (let k = 0; k < parityLen; k++) {
      omegaVal ^= gfMul(omega[k] as number, xp);
      xp = gfMul(xp, xInv);
    }
    // Psi'(x) keeps odd-power terms only
    let psiPrime = 0;
    let xp2 = 1; // xInv^0, used for term k=1 => xInv^(k-1)
    for (let k = 1; k <= psiDeg; k += 2) {
      psiPrime ^= gfMul(psi[k] as number, xp2);
      xp2 = gfMul(xp2, gfMul(xInv, xInv));
    }
    if (psiPrime === 0) return null;
    const magnitude = gfMul(x, gfDiv(omegaVal, psiPrime));
    const pos = positions[idx] as number;
    corrected[pos] = (corrected[pos] as number) ^ magnitude;
  }

  // A decode that does not re-verify is a decode that can lie.
  const check = syndromes(corrected, parityLen);
  if (!check.clean) return null;
  return corrected.slice(0, dataLen);
}
