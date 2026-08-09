import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';

const nodeRequire = createRequire(import.meta.url);

/**
 * Provides the raptorq wasm binary as a base64 string module so the built app
 * (and its Local Suite single-file export) needs no runtime asset fetch.
 * The bytes come from the locked raptorq package; the module is therefore
 * exactly as deterministic as package-lock.json.
 */
function raptorqWasmBase64(): Plugin {
  const virtualId = 'virtual:raptorq-wasm-base64';
  const resolvedId = `\0${virtualId}`;
  const glueFallback = "input = new URL('raptorq_bg.wasm', import.meta.url);";
  return {
    name: 'chromalink:raptorq-wasm-base64',
    resolveId(id) {
      return id === virtualId ? resolvedId : undefined;
    },
    load(id) {
      if (id !== resolvedId) return undefined;
      const wasmPath = nodeRequire.resolve('raptorq/raptorq_bg.wasm');
      const b64 = readFileSync(wasmPath).toString('base64');
      return `export default ${JSON.stringify(b64)};`;
    },
    transform(code, id) {
      // initFountain() always passes explicit bytes, so the glue's
      // URL-relative fallback is dead code — and if left in place Vite
      // emits a second, unused copy of the wasm as a build asset.
      if (!id.endsWith('/raptorq.js') || !id.includes('raptorq')) return undefined;
      const count = code.split(glueFallback).length - 1;
      if (count !== 1) {
        throw new Error('raptorq glue fallback changed — re-verify the pinned package');
      }
      return code.replace(
        glueFallback,
        "throw new Error('raptorq: wasm bytes must be provided explicitly');",
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [raptorqWasmBase64()],
  resolve: {
    alias: {
      // raptorq publishes only a "module" entry; point every resolver at it.
      raptorq: nodeRequire.resolve('raptorq/raptorq.js'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    alias: [
      // The inline-worker import cannot be evaluated under vitest (no
      // bundler worker wrapper in the node/happy-dom runtimes), so tests
      // that mount the receiver get a controllable stub instead. The
      // production build never consults test.alias.
      {
        find: /^\.\/decode-worker\?worker&inline$/,
        replacement: fileURLToPath(new URL('./test/stubs/decode-worker-stub.ts', import.meta.url)),
      },
    ],
    server: {
      deps: {
        // raptorq ships only a "module" entry; Node's own resolver cannot
        // load it, so it must go through Vite's transform pipeline.
        inline: ['raptorq'],
      },
    },
  },
});
