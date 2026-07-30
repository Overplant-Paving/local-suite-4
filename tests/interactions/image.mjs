/* tests/interactions/image.mjs — exercises the Image Toolbox end-to-end, fully offline.
   Builds deterministic test images IN-PAGE (offscreen canvas → toBlob → File), then:
   load facts, preview pixels, aspect-lock math, resize + JPEG/WebP re-encode verified by
   downloading the real output and decoding it back (magic bytes + createImageBitmap dims),
   two JPEG qualities produce different byte sizes, the unsupported-file and corrupt-file
   error cards, clean state reset on a second image, a11y attributes, storage hygiene,
   and mobile no-overflow. No network is used anywhere. */
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

export const selectors = [
  "body", ".wrap", "header h1", ".theme-btn", ".drop", ".card", "#preview",
  "#outW", "#lock", "#format", "#quality", "#download", "#result", "footer"
];
export const screenshotAfterInteract = true;

function expect(cond, msg) { if (!cond) throw new Error("EXPECT FAILED: " + msg); }

/* Deterministic fixture: vertical gradient bars + a white block, encoded in-page. */
async function makeFixture(page, { w, h, type, name }) {
  await page.evaluate(async ({ w, h, type, name }) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d");
    for (let i = 0; i < w; i += 8) {
      x.fillStyle = `rgb(${Math.round(i * 255 / w)},80,${Math.round(200 - i * 180 / w)})`;
      x.fillRect(i, 0, 8, h);
    }
    x.fillStyle = "#ffffff";
    x.fillRect(Math.round(w / 8), Math.round(h / 8), Math.round(w / 4), Math.round(h / 4));
    const blob = await new Promise(r => c.toBlob(r, type, 0.92));
    window.__testFile = new File([blob], name, { type: blob.type });
  }, { w, h, type, name });
}

/* Feed window.__testFile through the real <input type=file> change path. */
async function loadFixture(page) {
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(window.__testFile);
    const inp = document.getElementById("fileInput");
    inp.files = dt.files;
    inp.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const encCount = page => page.evaluate(() => +document.getElementById("result").dataset.enc);
async function waitEncode(page, prev) {
  await page.waitForFunction(p => +document.getElementById("result").dataset.enc > p, prev,
    { timeout: 8000 });
  return encCount(page);
}

/* Trigger the real object-URL download and return the produced bytes. */
async function grabDownload(page) {
  const dlP = page.waitForEvent("download", { timeout: 8000 });
  await page.click("#download");
  const dl = await dlP;
  const buf = readFileSync(await dl.path());
  return { name: dl.suggestedFilename(), buf };
}

const isJpeg = b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
const isPng = b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
const isWebp = b => b.slice(0, 4).toString("ascii") === "RIFF" &&
  b.slice(8, 12).toString("ascii") === "WEBP";

/* Decode produced bytes back in-page (content-sniffed Blob → createImageBitmap). */
async function decodeDims(page, buf) {
  return page.evaluate(async b64 => {
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([arr]));
    const r = { w: bmp.width, h: bmp.height }; bmp.close(); return r;
  }, buf.toString("base64"));
}

const val = (page, sel) => page.locator(sel).inputValue();

export async function interact({ page, log, evidenceDir }) {
  /* 1 — designed empty state: drop zone visible, workspace + error card hidden */
  expect(await page.locator(".drop").isVisible(), "drop zone visible on load");
  expect(!(await page.locator("#workspace").isVisible()), "workspace hidden before any file");
  expect(!(await page.locator("#errCard").isVisible()), "error card hidden on load");
  log("empty state: drop zone visible, workspace + error card hidden");

  /* 2 — load a deterministic 320×200 PNG through the real file-input path */
  await makeFixture(page, { w: 320, h: 200, type: "image/png", name: "fixture.png" });
  await loadFixture(page);
  await page.waitForSelector("#workspace", { state: "visible" });
  const dims = await page.locator("#factDims").innerText();
  const ftype = await page.locator("#factType").innerText();
  const fsize = await page.locator("#factSize").innerText();
  expect(dims === "320 × 200 px", `original dims fact (got "${dims}")`);
  expect(ftype === "image/png", `original type fact (got "${ftype}")`);
  expect(/\d/.test(fsize), "original size fact is populated");
  log(`original facts: ${dims} · ${fsize} · ${ftype} (fixture.png)`);
  expect(await val(page, "#outW") === "320" && await val(page, "#outH") === "200" &&
    await val(page, "#outPct") === "100", "resize fields initialised to original dims / 100%");
  expect(await val(page, "#format") === "image/png", "format defaults to the original type (PNG)");
  expect(await page.locator("#quality").isDisabled(), "quality slider disabled for lossless PNG");
  log("controls initialised: 320 / 200 / 100%, format=PNG, quality disabled (lossless)");

  /* preview canvas is genuinely painted */
  const px = await page.evaluate(() => {
    const c = document.getElementById("preview");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let opaque = 0, colored = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0) opaque++;
      if (d[i] !== d[i + 1] || d[i + 1] !== d[i + 2]) colored++;
    }
    return { w: c.width, h: c.height, opaque, colored };
  });
  expect(px.w === 320 && px.h === 200 && px.opaque === 320 * 200 && px.colored > 1000,
    `preview canvas painted (${JSON.stringify(px)})`);
  log(`preview canvas: ${px.w}x${px.h}, ${px.opaque} opaque px, ${px.colored} colored px`);
  let enc = await waitEncode(page, 0);
  log("initial auto-encode completed: " + (await page.locator("#result").innerText()));

  /* 3 — aspect-lock math (orig 320×200, aspect 1.6) */
  await page.fill("#outW", "160");
  expect(await val(page, "#outH") === "100", "lock on: width 160 → height 100");
  expect(await val(page, "#outPct") === "50", "lock on: width 160 → scale 50%");
  let ro = await page.locator("#dimOut").innerText();
  expect(ro.includes("160 × 100") && ro.includes("50%"), `readout after width edit ("${ro}")`);
  log("aspect lock, width edit: 160 → 160 × 100 (readout: " + ro + ")");
  await page.fill("#outH", "50");
  expect(await val(page, "#outW") === "80" && await val(page, "#outPct") === "25",
    "lock on: height 50 → width 80, scale 25%");
  log("aspect lock, height edit: 50 → 80 × 50 (25%)");
  await page.uncheck("#lock");
  await page.fill("#outW", "123");
  expect(await val(page, "#outH") === "50", "lock off: width edit leaves height untouched");
  ro = await page.locator("#dimOut").innerText();
  expect(ro.includes("123 × 50") && ro.includes("aspect changed"),
    `unlocked readout flags changed aspect ("${ro}")`);
  log("aspect unlock: width 123 keeps height 50, readout: " + ro);
  await page.check("#lock");
  expect(await val(page, "#outH") === "77", "re-lock snaps height to aspect (123 → 77)");
  log("re-lock: height snapped to 77 (round(123·200/320))");
  await page.fill("#outPct", "50");
  expect(await val(page, "#outW") === "160" && await val(page, "#outH") === "100",
    "percent 50 → 160 × 100 from the original");
  log("percent edit: 50% → 160 × 100");

  /* 4 — convert to JPEG at quality 90, download, verify bytes end-to-end */
  enc = await encCount(page);
  await page.selectOption("#format", "image/jpeg");
  expect(!(await page.locator("#quality").isDisabled()), "quality slider enabled for JPEG");
  expect(await val(page, "#quality") === "90", "quality defaults to 90");
  enc = await waitEncode(page, enc);
  const res90 = await page.locator("#result").innerText();
  expect(res90.includes("JPEG") && res90.includes("160 × 100 px"),
    `encode readout shows format + dims ("${res90}")`);
  log("JPEG q90 encode readout: " + res90);
  expect(!(await page.locator("#download").isDisabled()), "download enabled after encode");
  const q90 = await grabDownload(page);
  expect(q90.name === "fixture-160x100.jpg", `download filename derived ("${q90.name}")`);
  expect(isJpeg(q90.buf), "q90 download starts with JPEG magic bytes (FF D8 FF)");
  let dd = await decodeDims(page, q90.buf);
  expect(dd.w === 160 && dd.h === 100, `q90 output decodes to 160×100 (got ${dd.w}×${dd.h})`);
  writeFileSync(join(evidenceDir, "out-q90.jpg"), q90.buf);
  log(`JPEG q90 download: ${q90.name}, ${q90.buf.length} bytes, magic=JPEG, decodes to ${dd.w}×${dd.h}`);

  /* 5 — quality 40 re-encode: different byte size, same dims, still JPEG */
  await page.fill("#quality", "40");
  expect(await page.locator("#qualityVal").innerText() === "40", "quality output tracks slider");
  enc = await waitEncode(page, enc);
  const q40 = await grabDownload(page);
  expect(isJpeg(q40.buf), "q40 download is JPEG");
  dd = await decodeDims(page, q40.buf);
  expect(dd.w === 160 && dd.h === 100, `q40 output decodes to 160×100 (got ${dd.w}×${dd.h})`);
  expect(q40.buf.length !== q90.buf.length,
    `q40 (${q40.buf.length} B) differs from q90 (${q90.buf.length} B)`);
  writeFileSync(join(evidenceDir, "out-q40.jpg"), q40.buf);
  log(`JPEG q40 vs q90: ${q40.buf.length} B vs ${q90.buf.length} B (differ: ` +
    `${q40.buf.length !== q90.buf.length}, q40 smaller: ${q40.buf.length < q90.buf.length})`);

  /* 6 — WebP conversion verified by magic bytes */
  await page.selectOption("#format", "image/webp");
  enc = await waitEncode(page, enc);
  const resW = await page.locator("#result").innerText();
  expect(resW.includes("WebP"), `WebP readout ("${resW}")`);
  const wp = await grabDownload(page);
  expect(wp.name === "fixture-160x100.webp" && isWebp(wp.buf),
    `WebP download name+magic ("${wp.name}")`);
  dd = await decodeDims(page, wp.buf);
  expect(dd.w === 160 && dd.h === 100, "WebP output decodes to 160×100");
  log(`WebP download: ${wp.name}, ${wp.buf.length} bytes, magic=RIFF/WEBP, ${dd.w}×${dd.h}`);

  /* 7 — PNG re-encode path (quality disabled) with magic check */
  await page.selectOption("#format", "image/png");
  expect(await page.locator("#quality").isDisabled(), "quality re-disabled for PNG");
  const qn = await page.locator("#qNote").innerText();
  expect(qn.toLowerCase().includes("lossless"), `PNG note explains lossless ("${qn}")`);
  enc = await waitEncode(page, enc);
  const pn = await grabDownload(page);
  expect(isPng(pn.buf), "PNG download has PNG magic bytes");
  log(`PNG re-encode: ${pn.name}, ${pn.buf.length} bytes, magic=PNG; note: "${qn}"`);

  /* 8 — error path: a text file gets the designed error card */
  await page.evaluate(() => {
    window.__testFile = new File(["hello, I am not an image"], "notes.txt", { type: "text/plain" });
  });
  await loadFixture(page);
  await page.waitForSelector("#errCard", { state: "visible" });
  expect(!(await page.locator("#workspace").isVisible()), "workspace hidden on error");
  expect(await page.locator("#errCard").getAttribute("role") === "alert", "error card role=alert");
  const em = await page.locator("#errMsg").innerText();
  expect(em.includes("notes.txt") && em.includes("not an image"), `error message ("${em}")`);
  log("text-file error card: " + em);
  await page.screenshot({ path: join(evidenceDir, "error-card.png"), fullPage: true });

  /* 9 — corrupt bytes claiming image/png → decode-failure card */
  await page.evaluate(() => {
    window.__testFile = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], "broken.png",
      { type: "image/png" });
  });
  await loadFixture(page);
  await page.waitForSelector("#errCard", { state: "visible" });
  const em2 = await page.locator("#errMsg").innerText();
  expect(em2.includes("broken.png") && em2.includes("decoded"), `decode-error message ("${em2}")`);
  log("corrupt-file error card: " + em2);

  /* 10 — sequential second image: clean reset, JPEG defaults */
  enc = await encCount(page);
  await makeFixture(page, { w: 100, h: 60, type: "image/jpeg", name: "second.jpeg" });
  await loadFixture(page);
  await page.waitForSelector("#workspace", { state: "visible" });
  expect(!(await page.locator("#errCard").isVisible()), "error card cleared on next image");
  expect(await page.locator("#factDims").innerText() === "100 × 60 px", "second image facts");
  expect(await val(page, "#outW") === "100" && await val(page, "#outH") === "60" &&
    await val(page, "#outPct") === "100", "resize fields reset for the new image");
  expect(await val(page, "#format") === "image/jpeg" &&
    !(await page.locator("#quality").isDisabled()),
    "format follows the new original (JPEG), quality re-enabled");
  expect(await page.locator("#lock").isChecked(), "aspect lock back on for the new image");
  await waitEncode(page, enc);
  const res2 = await page.locator("#result").innerText();
  expect(res2.includes("JPEG") && res2.includes("100 × 60 px"),
    `second image auto-encode reflects the new file ("${res2}")`);
  log("second image loaded clean: 100 × 60 px JPEG, fields reset (100/60/100%, lock on), " +
    "readout: " + res2);
  /* small images render at intrinsic size, not stretched by the .card flexbox */
  const pw = await page.evaluate(() =>
    Math.round(document.getElementById("preview").getBoundingClientRect().width));
  expect(pw >= 100 && pw <= 104,   /* intrinsic 100px + 1px border each side */
    `small preview not upscaled (rendered ${pw}px for a 100px image)`);
  log(`preview of 100px-wide image renders at ${pw}px (no blurry upscale)`);

  /* 11 — a11y: labels, live regions, drop-zone semantics */
  const a11y = await page.evaluate(() => {
    const labelFor = id => !!document.querySelector(`label[for="${id}"]`) ||
      !!document.getElementById(id).closest("label");
    return {
      dropRole: document.getElementById("drop").getAttribute("role"),
      dropLabel: document.getElementById("drop").getAttribute("aria-label"),
      dropTab: document.getElementById("drop").tabIndex,
      liveResult: document.getElementById("result").getAttribute("aria-live"),
      liveDims: document.getElementById("dimOut").getAttribute("aria-live"),
      labels: ["outW", "outH", "outPct", "format", "quality", "lock"].every(labelFor),
      previewLabel: document.getElementById("preview").getAttribute("aria-label"),
    };
  });
  expect(a11y.dropRole === "button" && a11y.dropTab === 0 && a11y.dropLabel,
    "drop zone is a labelled keyboard-reachable button");
  expect(a11y.liveResult === "polite" && a11y.liveDims === "polite",
    "encode result + dimension readout are live regions");
  expect(a11y.labels, "every control has an associated label");
  log(`a11y: drop role=button tabindex=0 aria-label="${a11y.dropLabel}"; ` +
    `aria-live=polite on #result + #dimOut; all 6 controls labelled; ` +
    `preview aria-label="${a11y.previewLabel}"`);

  /* 12 — storage hygiene: the tool writes nothing beyond suite.theme.
     (suite.hub.* keys are written by core suite.js's shared favorites/recents
     machinery inside Suite.theme.init(), on every tool page — not by this tool.) */
  const keys = await page.evaluate(() => Object.keys(localStorage));
  const extra = keys.filter(k => k !== "suite.theme" && !k.startsWith("suite.hub."));
  expect(extra.length === 0, `no tool-owned storage beyond suite.theme (found: ${extra.join(", ")})`);
  log(`storage: localStorage keys = [${keys.join(", ")}] — nothing tool-owned beyond suite.theme`);

  /* 13 — mobile 390px: no horizontal overflow */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const ov = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
  }));
  expect(ov.sw <= ov.cw, `no horizontal overflow at 390px (scrollWidth ${ov.sw} vs ${ov.cw})`);
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  log(`mobile 390×844: scrollWidth ${ov.sw} <= clientWidth ${ov.cw}, screenshot mobile.png`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200);
}
