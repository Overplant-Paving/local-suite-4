/**
 * Test stand-in for `./decode-worker?worker&inline` (mapped via the vitest
 * `test.alias` entry in vite.config.ts). Instances register themselves so a
 * test can drive `onmessage` with synthesized worker replies and observe
 * what the app posts and whether it terminated the worker.
 */

export interface StubWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  posted: unknown[];
  terminated: boolean;
}

export const stubWorkerInstances: StubWorkerLike[] = [];

export default class StubDecodeWorker implements StubWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  constructor() {
    stubWorkerInstances.push(this);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
}
