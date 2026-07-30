/* tests/interactions/hash.mjs — exercises the File Integrity & Hash Desk end-to-end.
   Fully offline tool: files are created IN-PAGE via `new File([bytes], name)` and pushed
   through the real <input type=file> change handler (and the drop handler once), so the
   whole pipeline — read → crypto.subtle.digest ×4 → render → verify — runs for real
   against known NIST test vectors. Deterministic; no network. */
import { join } from "node:path";

export const selectors = [
  "body", "header h1", ".theme-btn", "footer", ".tab", ".card",
  ".dropzone", "#fileList", "#verifyIn", "#verifyOut", "#textIn"
];
export const screenshotAfterInteract = true;

/* NIST FIPS 180 test vectors for the message "abc" + SHA-256 of the empty string */
const V = {
  abc256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  abc384: "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed" +
          "8086072ba1e7cc2358baeca134c825a7",
  abc512: "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a" +
          "2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
  abc1:   "a9993e364706816aba3e25717850c26c9cd0d89d",
  empty256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};

function expect(cond, msg) { if (!cond) throw new Error("EXPECT FAILED: " + msg); }

/* build File objects in-page and fire the real change handler on #fileInput */
async function addFilesViaInput(page, specs) {
  await page.evaluate(fs => {
    const dt = new DataTransfer();
    for (const f of fs) dt.items.add(new File([new TextEncoder().encode(f.text)], f.name));
    const input = document.getElementById("fileInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, specs);
}

async function digestOfCard(page, cardIndex, algo) {
  return page
    .locator("#fileList .fcard").nth(cardIndex)
    .locator(`.drow[data-algo="${algo}"] code.dhex`).innerText();
}

export async function interact({ page, log, evidenceDir }) {
  /* 1 — designed empty state */
  log("empty state: " + (await page.locator("#fileEmpty").innerText()));

  /* 2 — single file "abc.txt" through the input's change handler; known SHA vectors */
  await addFilesViaInput(page, [{ name: "abc.txt", text: "abc" }]);
  await page.waitForFunction(() =>
    document.querySelectorAll("#fileList .fcard .drow code.dhex").length >= 4);
  const got = {};
  for (const a of ["SHA-256", "SHA-384", "SHA-512", "SHA-1"]) {
    got[a] = await digestOfCard(page, 0, a);
  }
  expect(got["SHA-256"] === V.abc256, `SHA-256("abc") got ${got["SHA-256"]}`);
  expect(got["SHA-384"] === V.abc384, `SHA-384("abc") got ${got["SHA-384"]}`);
  expect(got["SHA-512"] === V.abc512, `SHA-512("abc") got ${got["SHA-512"]}`);
  expect(got["SHA-1"] === V.abc1, `SHA-1("abc") got ${got["SHA-1"]}`);
  log(`file vectors OK for abc.txt: SHA-256=${got["SHA-256"]}`);
  log(`  SHA-384=${got["SHA-384"].slice(0, 32)}… SHA-512=${got["SHA-512"].slice(0, 32)}… ` +
      `SHA-1=${got["SHA-1"]} — all four equal the NIST "abc" vectors`);
  log("file meta: " + (await page.locator("#fileList .fcard .fhead").innerText())
      .replace(/\s+/g, " "));
  const legacy = await page.locator('#fileList .drow[data-algo="SHA-1"] .legacy').innerText();
  expect(legacy.includes("collision-broken"), "SHA-1 legacy warning text: " + legacy);
  log("SHA-1 labelled: " + legacy);

  /* 3 — multi-file in one change event, incl. the empty file */
  await addFilesViaInput(page, [
    { name: "hello world.bin", text: "hello world\n" },
    { name: "empty.dat", text: "" },
  ]);
  await page.waitForFunction(() =>
    document.querySelectorAll("#fileList .fcard").length === 3 &&
    document.querySelectorAll("#fileList .fcard .drow code.dhex").length === 12);
  const emptySha = await digestOfCard(page, 2, "SHA-256");
  expect(emptySha === V.empty256, `SHA-256(empty file) got ${emptySha}`);
  log("multi-file flow: 3 cards / 12 digests; SHA-256(empty.dat) = " + emptySha +
      " (empty-string vector)");

  /* 4 — verify field: match, tolerant formats, mismatch, junk */
  const verify = async (val, label) => {
    await page.fill("#verifyIn", val);
    await page.waitForTimeout(60);
    const cls = await page.locator("#verifyOut").getAttribute("class");
    const txt = (await page.locator("#verifyOut").innerText()).replace(/\s+/g, " ");
    log(`verify [${label}] -> class="${cls}" text="${txt}"`);
    return { cls, txt };
  };
  let r = await verify(V.abc256, "plain hex");
  expect(r.cls.includes("match") && !r.cls.includes("mismatch"), "plain hex should MATCH");
  expect(r.txt.includes("SHA-256") && r.txt.includes("abc.txt"),
    "match names algorithm+file: " + r.txt);
  r = await verify("  " + V.abc256.toUpperCase().match(/.{1,8}/g).join(" ") + "  ",
    "uppercase + grouped whitespace");
  expect(r.cls.includes("match") && !r.cls.includes("mismatch"), "grouped/case should MATCH");
  r = await verify("sha256:" + V.abc256, "sha256: prefix");
  expect(r.cls.includes("match") && !r.cls.includes("mismatch"), "sha256: prefix should MATCH");
  r = await verify(`SHA256 (abc.txt) = ${V.abc256}`, "BSD tag format");
  expect(r.cls.includes("match") && !r.cls.includes("mismatch"), "BSD format should MATCH");
  r = await verify(V.abc256 + "  abc.txt", "sha256sum checksum line");
  expect(r.cls.includes("match") && !r.cls.includes("mismatch"), "sum line should MATCH");
  r = await verify(V.abc256.slice(0, 63) + "e", "flipped last char");
  expect(r.cls.includes("mismatch"), "altered digest should MISMATCH");
  expect(r.txt.includes("SHA-256"), "mismatch states which algorithm was compared");
  r = await verify("sha512:" + V.abc1, "prefix/length disagreement");
  expect(r.cls.includes("note") && r.txt.includes("Prefix disagrees"),
    "sha512-prefixed 40-char value must warn, not guess: " + r.txt);
  r = await verify("not-a-digest zz", "junk");
  expect(r.cls.includes("note") && r.txt.includes("Not a digest"), "junk gets the note state");

  /* 5 — text tab vector */
  await page.click('.tab[data-tab="text"]');
  expect(await page.locator("#tab-text").isVisible(), "text tab visible after switch");
  await page.fill("#textIn", "abc");
  await page.waitForFunction(() =>
    document.querySelectorAll("#textOut .drow code.dhex").length >= 4);
  const t256 = await page.locator('#textOut .drow[data-algo="SHA-256"] code.dhex').innerText();
  const t1 = await page.locator('#textOut .drow[data-algo="SHA-1"] code.dhex').innerText();
  expect(t256 === V.abc256, `text-tab SHA-256("abc") got ${t256}`);
  expect(t1 === V.abc1, `text-tab SHA-1("abc") got ${t1}`);
  log(`text tab vectors OK: SHA-256=${t256} SHA-1=${t1} (` +
      (await page.locator("#textOut .hint").innerText()) + ")");
  r = await verify(V.abc1, "SHA-1 hex against text result");
  expect(r.cls.includes("match") && r.txt.includes("SHA-1") && r.txt.includes("pasted text"),
    "SHA-1 of pasted text should MATCH and say so: " + r.txt);

  /* 6 — copy button: must never throw; clipboard may be denied on file:// */
  await page.locator('#textOut .drow[data-algo="SHA-256"] .copy').click();
  await page.waitForTimeout(150);
  log("copy click -> toast: \"" + (await page.locator("#toast").innerText()) +
      "\" (no unhandled error either way)");

  /* 7 — drop-event path (second input route required by the tool) */
  await page.click('.tab[data-tab="files"]');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new TextEncoder().encode("abc")], "dropped-abc.txt"));
    const dz = document.getElementById("dropzone");
    dz.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
    dz.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
  });
  await page.waitForFunction(() =>
    document.querySelectorAll("#fileList .fcard").length === 4);
  const dropped256 = await digestOfCard(page, 3, "SHA-256");
  expect(dropped256 === V.abc256, "drop-path SHA-256 vector");
  log("drop-zone path: dropped-abc.txt hashed, SHA-256 matches the vector");

  /* 8 — clear results + verify falls back to 'nothing computed' wording for files */
  await page.click("#clearBtn");
  expect((await page.locator("#fileList .fcard").count()) === 0, "clear removes all cards");
  log("clear results: 0 cards, empty state back: " +
      (await page.locator("#fileEmpty").isVisible()));

  /* 9 — a11y assertions */
  const copyLabel = await page
    .locator('#textOut .drow[data-algo="SHA-256"] .copy').getAttribute("aria-label");
  expect(copyLabel && copyLabel.includes("SHA-256"), "copy button aria-label: " + copyLabel);
  const inputLabel = await page.locator("#fileInput").getAttribute("aria-label");
  expect(inputLabel, "file input has aria-label");
  for (const id of ["fileList", "textOut", "verifyOut"]) {
    const live = await page.locator("#" + id).getAttribute("aria-live");
    expect(live === "polite", `#${id} aria-live=${live}`);
  }
  const tabPressed = await page.locator('.tab[data-tab="files"]').getAttribute("aria-pressed");
  log(`a11y: copy aria-label="${copyLabel}", file input aria-label="${inputLabel}", ` +
      `aria-live=polite on fileList/textOut/verifyOut, active tab aria-pressed=${tabPressed}`);

  /* 10 — storage: the tool itself writes only suite.theme; core suite.js chrome also
     records suite.hub.recents on every tool page (suite-wide, not this tool's key) */
  const keys = await page.evaluate(() => Object.keys(localStorage));
  const allowed = new Set(["suite.theme", "suite.hub.recents"]);
  expect(keys.every(k => allowed.has(k)), "unexpected storage keys: " + keys.join(","));
  log("storage keys after full exercise: [" + keys.join(", ") +
      "] — no tool-specific keys beyond the manifest's suite.theme (hub.recents is core chrome)");

  /* 11 — mobile 390px: no horizontal overflow, with a 128-char SHA-512 on screen */
  await addFilesViaInput(page, [{ name: "abc.txt", text: "abc" }]);
  await page.waitForFunction(() =>
    document.querySelectorAll("#fileList .fcard .drow code.dhex").length >= 4);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const ov = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    bsw: document.body.scrollWidth, bcw: document.body.clientWidth,
  }));
  expect(ov.sw <= ov.cw && ov.bsw <= ov.bcw,
    `mobile overflow: html ${ov.sw}/${ov.cw}, body ${ov.bsw}/${ov.bcw}`);
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  log(`mobile 390px: scrollWidth ${ov.sw} <= clientWidth ${ov.cw} (body ${ov.bsw}/${ov.bcw})` +
      " — no horizontal overflow; mobile.png saved");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.fill("#verifyIn", V.abc256);
  await page.waitForTimeout(80);
  log("final state: one hashed file + green MATCH banner for the after-interaction shot");
}
