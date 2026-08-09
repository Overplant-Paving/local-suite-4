import './ui/styles.css';
import { initFountain } from './lib/fountain';
import { mountSender } from './sender/sender-app';
import { mountReceiver } from './receiver/receiver-app';

type Mode = 'send' | 'receive';

const INIT_TIMEOUT_MS = 10_000;

function appRoot(): HTMLElement {
  const root = document.getElementById('chromalink-app');
  if (root === null) throw new Error('ChromaLink: #chromalink-app root missing');
  return root;
}

function clear(el: HTMLElement): void {
  while (el.firstChild !== null) el.removeChild(el.firstChild);
}

function renderReloadUi(root: HTMLElement, message: string): void {
  clear(root);
  const wrap = document.createElement('div');
  wrap.className = 'cl-error';
  const p = document.createElement('p');
  p.textContent = message;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cl-reload-btn';
  button.textContent = 'Reload';
  button.addEventListener('click', () => {
    location.reload();
  });
  wrap.append(p, button);
  root.append(wrap);
}

function renderLoading(root: HTMLElement): void {
  clear(root);
  const p = document.createElement('p');
  p.className = 'cl-loading';
  p.textContent = 'Loading…';
  p.setAttribute('role', 'status');
  root.append(p);
}

async function boot(root: HTMLElement, mode: Mode): Promise<void> {
  renderLoading(root);
  let timer = 0;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = window.setTimeout(() => resolve('timeout'), INIT_TIMEOUT_MS);
  });
  try {
    const winner = await Promise.race([initFountain().then(() => 'ready' as const), timedOut]);
    if (winner === 'timeout') {
      renderReloadUi(root, 'ChromaLink could not initialize within 10 seconds.');
      return;
    }
    window.clearTimeout(timer);
  } catch (err) {
    window.clearTimeout(timer);
    console.error('ChromaLink init failed:', err);
    renderReloadUi(root, 'ChromaLink failed to initialize.');
    return;
  }
  clear(root);
  if (mode === 'send') {
    mountSender(root);
  } else {
    mountReceiver(root);
  }
}

function renderChooser(root: HTMLElement): void {
  clear(root);
  const wrap = document.createElement('div');
  wrap.className = 'cl-chooser';
  for (const mode of ['send', 'receive'] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cl-mode-btn';
    button.textContent = mode === 'send' ? 'Send' : 'Receive';
    button.addEventListener('click', () => {
      void boot(root, mode);
    });
    wrap.append(button);
  }
  root.append(wrap);
}

function start(): void {
  const root = appRoot();
  const requested = new URLSearchParams(location.search).get('mode');
  if (requested === 'send' || requested === 'receive') {
    void boot(root, requested);
  } else {
    renderChooser(root);
  }
}

start();
