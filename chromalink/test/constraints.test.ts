/**
 * Architecture constraints, enforced mechanically:
 *  - src/lib/** is DOM-free and imports only src/lib/** or npm packages
 *  - src/lib/fountain.ts is the only raptorq importer
 *  - the decode worker imports lib only
 *  - sender and receiver never import each other
 *  - tests import lib only (never sender/receiver/worker/main)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (full.endsWith('.ts') || full.endsWith('.css')) out.push(full);
  }
  return out;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specs: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)[^;'"]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const spec = m[1] ?? m[2];
    if (spec !== undefined) specs.push(spec);
  }
  return specs;
}

const FORBIDDEN_LIB_GLOBALS = ['document', 'window', 'navigator', 'OffscreenCanvas'];

describe('architecture constraints', () => {
  const libFiles = listFiles(join(ROOT, 'src', 'lib')).filter((f) => f.endsWith('.ts'));
  const testFiles = listFiles(join(ROOT, 'test')).filter((f) => f.endsWith('.ts'));

  it('lib never touches DOM globals', () => {
    for (const file of libFiles) {
      const text = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN_LIB_GLOBALS) {
        const re = new RegExp(`\\b${token}\\b`);
        expect(re.test(text), `${relative(ROOT, file)} must not mention ${token}`).toBe(false);
      }
    }
  });

  it('lib imports only lib-relative modules or npm packages', () => {
    const libRoot = join(ROOT, 'src', 'lib');
    for (const file of libFiles) {
      for (const spec of importsOf(file)) {
        if (spec.startsWith('.')) {
          // relative specifiers must resolve inside src/lib
          const resolved = join(file, '..', spec);
          const stays = !relative(libRoot, resolved).startsWith('..');
          expect(stays, `${relative(ROOT, file)} escapes lib via ${spec}`).toBe(true);
        } else {
          const ok = spec.startsWith('virtual:') || !spec.startsWith('/');
          expect(ok, `${relative(ROOT, file)} imports ${spec}`).toBe(true);
        }
      }
    }
  });

  it('only fountain.ts imports raptorq', () => {
    for (const file of [...listFiles(join(ROOT, 'src'))].filter((f) => f.endsWith('.ts'))) {
      const specs = importsOf(file);
      const usesRaptorq = specs.some((s) => s === 'raptorq' || s.startsWith('virtual:raptorq'));
      if (usesRaptorq) {
        expect(relative(ROOT, file).replace(/\\/g, '/')).toBe('src/lib/fountain.ts');
      }
    }
  });

  it('the decode worker imports lib only', () => {
    const worker = join(ROOT, 'src', 'receiver', 'decode-worker.ts');
    let specs: string[];
    try {
      specs = importsOf(worker);
    } catch {
      return; // worker not created yet (pre-Phase 4 checkouts)
    }
    for (const spec of specs) {
      expect(spec.startsWith('../lib/'), `decode-worker imports ${spec}`).toBe(true);
    }
  });

  it('sender and receiver never import each other', () => {
    for (const file of listFiles(join(ROOT, 'src', 'sender')).filter((f) => f.endsWith('.ts'))) {
      for (const spec of importsOf(file)) {
        expect(spec.includes('receiver'), `${relative(ROOT, file)} imports ${spec}`).toBe(false);
      }
    }
    for (const file of listFiles(join(ROOT, 'src', 'receiver')).filter((f) => f.endsWith('.ts'))) {
      for (const spec of importsOf(file)) {
        expect(spec.includes('sender'), `${relative(ROOT, file)} imports ${spec}`).toBe(false);
      }
    }
  });

  it('tests import lib only (plus the dedicated receiver lifecycle test)', () => {
    // The receiver finalization-ownership regression must mount the real
    // receiver shell; it alone may reach into src/receiver. Everything else
    // stays confined to the pure library.
    const receiverTestExceptions = new Set(['test/receiver-finalize.test.ts']);
    for (const file of testFiles) {
      const allowReceiver = receiverTestExceptions.has(relative(ROOT, file));
      for (const spec of importsOf(file)) {
        if (spec.startsWith('.')) {
          const escapesToSrc = spec.includes('/src/');
          if (escapesToSrc) {
            const allowed =
              spec.includes('/src/lib/') || (allowReceiver && spec.includes('/src/receiver/'));
            expect(allowed, `${relative(ROOT, file)} imports ${spec}`).toBe(true);
          }
        }
      }
    }
  });
});
