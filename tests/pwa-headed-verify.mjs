// Final headed Chromium PWA release check.
// Verifies the real beforeinstallprompt eligibility event, manifest icons/CSP,
// service-worker control, and precache state in a visible browser window.
import { chromium } from "playwright";
import http from "node:http";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PORT = 8032;
const SCREENSHOT = process.argv[2] || join(ROOT, "tests", "evidence", "v4-release", "headed-installability.png");
const executable = process.env.CHROMIUM_EXECUTABLE || chromium.executablePath();
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer((req, res) => {
  const rel = req.url.split("?")[0].replace(/^\/+/, "") || "index.html";
  if (rel === "favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  const path = join(DIST, rel);
  if (!existsSync(path)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": mime[extname(path)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(readFileSync(path));
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
const profile = `/tmp/local-suite-headed-release-${process.pid}`;
rmSync(profile, { recursive: true, force: true });
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: executable,
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  await context.addInitScript(() => {
    window.__suiteInstallPromptEvents = 0;
    addEventListener("beforeinstallprompt", () => { window.__suiteInstallPromptEvents += 1; });
  });
  const page = context.pages()[0] || await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => window.__suiteInstallPromptEvents > 0, { timeout: 15000 });

  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send("Page.getAppManifest");
  const installability = await cdp.send("Page.getInstallabilityErrors");
  const state = await page.evaluate(async () => ({
    title: document.title,
    manifest: document.querySelector('link[rel="manifest"]')?.href,
    serviceWorkerRegistered: Boolean(await navigator.serviceWorker.getRegistration()),
    serviceWorkerControlsPage: Boolean(navigator.serviceWorker.controller),
    cacheNames: await caches.keys(),
    installPromptEvents: window.__suiteInstallPromptEvents,
  }));
  await page.screenshot({ path: SCREENSHOT, fullPage: true });

  console.log(`Chromium: ${context.browser().version()}`);
  console.log(`Executable: ${executable}`);
  console.log(`Manifest: ${manifest.url}`);
  console.log(`Manifest parse errors: ${JSON.stringify(manifest.errors)}`);
  console.log(`Installability errors: ${JSON.stringify(installability.installabilityErrors)}`);
  console.log(`State: ${JSON.stringify(state)}`);
  console.log(`Console/page errors: ${JSON.stringify(errors)}`);
  console.log(`Screenshot: ${SCREENSHOT}`);

  if (manifest.errors.some((e) => e.critical)) throw new Error("critical webmanifest error");
  if (installability.installabilityErrors.length) throw new Error("PWA is not installable");
  if (!state.serviceWorkerRegistered || !state.serviceWorkerControlsPage) throw new Error("service worker is not controlling the page");
  if (!state.cacheNames.some((name) => name.startsWith("suite-v4-"))) throw new Error("v4 precache missing");
  if (state.installPromptEvents < 1) throw new Error("beforeinstallprompt did not fire");
  if (errors.length) throw new Error("headed browser reported errors");
  console.log("HEADED INSTALLABILITY VERIFICATION OK");
} finally {
  if (context) await context.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
