/**
 * GF(256) arithmetic over the primitive polynomial 0x11D with generator
 * alpha = 2. The exp/log tables are filled once at module load — the one
 * permitted piece of module state in the lib.
 */

export const GF_POLY = 0x11d;

/** exp table doubled (512 entries) so products of logs never need a mod. */
export const GF_EXP = new Uint8Array(512);
export const GF_LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= GF_POLY;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255] as number;
  }
}

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] as number) + (GF_LOG[b] as number)] as number;
}

export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('gf256: division by zero');
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] as number) - (GF_LOG[b] as number) + 255] as number;
}

export function gfPow(a: number, e: number): number {
  if (a === 0) return e === 0 ? 1 : 0;
  const log = ((GF_LOG[a] as number) * e) % 255;
  return GF_EXP[log < 0 ? log + 255 : log] as number;
}

export function gfInv(a: number): number {
  if (a === 0) throw new RangeError('gf256: inverse of zero');
  return GF_EXP[255 - (GF_LOG[a] as number)] as number;
}
