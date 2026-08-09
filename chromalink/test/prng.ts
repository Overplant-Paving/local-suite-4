/** Deterministic PRNG helpers so every test run sees identical inputs. */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBytes(rand: () => number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

/** k distinct integers in [0, n). */
export function distinctIndices(rand: () => number, n: number, k: number): number[] {
  const chosen = new Set<number>();
  while (chosen.size < k) {
    chosen.add(Math.floor(rand() * n));
  }
  return [...chosen];
}
