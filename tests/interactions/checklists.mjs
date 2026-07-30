/* tests/interactions/checklists.mjs — exercises the Checklist & Routine Tracker end-to-end.
   Fully offline tool: list create/rename/delete (soft confirms), add/check/uncheck/edit/
   delete/reorder items, progress math, the defining reset-checks flow (unchecks, keeps items),
   template instantiation, persistence across reload, export/import JSON round-trip,
   a11y (checkbox/label association, aria-labels, aria-pressed) and 390 px no-overflow.
   Deterministic — no network, no native dialogs. */
import { join } from "node:path";
import { readFileSync } from "node:fs";

export const selectors = [
  "body", ".wrap", "header h1", ".theme-btn", ".toolbar", "#listPick",
  ".btn", ".tplcard", ".progress-card", "#progressText", "progress",
  "#items", ".iconbtn", "#status", "footer"
];
export const screenshotAfterInteract = true;

const itemTexts = page =>
  page.locator("#items .item label").allInnerTexts();

async function progress(page) {
  const text = await page.locator("#progressText").innerText();
  const bar = await page.evaluate(() => {
    const b = document.getElementById("bar");
    return { value: b.value, max: b.max };
  });
  return { text, bar };
}

export async function interact({ page, log, evidenceDir }) {
  /* 1 — designed empty state: templates offered, no list view */
  const tplCount = await page.locator(".tplcard").count();
  const emptyVisible = await page.locator("#emptyHint").isVisible();
  const listHidden = !(await page.locator("#listView").isVisible());
  log(`empty state: ${tplCount} starter templates visible, empty hint=${emptyVisible}, list view hidden=${listHidden}`);
  if (tplCount !== 3 || !emptyVisible || !listHidden) throw new Error("empty state wrong");

  /* 2 — create a blank list via the inline name form (Enter submits) */
  await page.click("#newListBtn");
  await page.fill("#nameInput", "Morning routine");
  await page.press("#nameInput", "Enter");
  const opt1 = await page.locator("#listPick option").allInnerTexts();
  log(`created list, picker options: [${opt1.join(", ")}], list view visible=${await page.locator("#listView").isVisible()}`);
  if (opt1.join() !== "Morning routine") throw new Error("list not created");

  /* 3 — add items via input + Enter */
  for (const t of ["Stretch", "Make coffee", "Journal"]) {
    await page.fill("#newItem", t);
    await page.press("#newItem", "Enter");
  }
  let texts = await itemTexts(page);
  let p = await progress(page);
  log(`added 3 items: [${texts.join(", ")}], progress="${p.text}" bar=${p.bar.value}/${p.bar.max}`);
  if (texts.length !== 3 || p.text !== "0 of 3 · 0%" || p.bar.value !== 0 || p.bar.max !== 3)
    throw new Error("add/progress wrong");

  /* 4 — check two (one via label click proves association), progress math 2/3 = 67% */
  await page.locator("#items .item").nth(0).locator("input[type=checkbox]").check();
  await page.locator("#items .item label").nth(1).click(); // label toggles its checkbox
  p = await progress(page);
  const checkedCount = await page.locator("#items input[type=checkbox]:checked").count();
  log(`checked 2 of 3 (one via label click): progress="${p.text}" bar=${p.bar.value}/${p.bar.max}, checked=${checkedCount}`);
  if (p.text !== "2 of 3 · 67%" || p.bar.value !== 2 || checkedCount !== 2) throw new Error("check/progress wrong");

  /* 5 — uncheck one -> 1/3 = 33% */
  await page.locator("#items .item").nth(0).locator("input[type=checkbox]").uncheck();
  p = await progress(page);
  log(`unchecked one: progress="${p.text}"`);
  if (p.text !== "1 of 3 · 33%") throw new Error("uncheck/progress wrong");

  /* 6 — a11y: checkbox/label for-id association + aria-labels on icon buttons */
  const a11y = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#items .item")];
    const assoc = rows.every(r => {
      const cb = r.querySelector("input[type=checkbox]");
      const lb = r.querySelector("label");
      return cb && lb && cb.id && lb.htmlFor === cb.id;
    });
    const labels = [...document.querySelectorAll("#items .iconbtn")].map(b => b.getAttribute("aria-label"));
    const tplPressed = document.getElementById("templatesBtn").getAttribute("aria-pressed");
    return { assoc, labels: [...new Set(labels)], tplPressed };
  });
  log(`a11y: checkbox/label for-id association=${a11y.assoc}, icon aria-labels=[${a11y.labels.join(" | ")}], templates aria-pressed=${a11y.tplPressed}`);
  if (!a11y.assoc || a11y.labels.length !== 4) throw new Error("a11y association/labels wrong");
  for (const need of ["Move item up", "Move item down", "Edit item", "Delete item"])
    if (!a11y.labels.includes(need)) throw new Error("missing aria-label: " + need);

  /* 7 — edit item text inline */
  await page.locator("#items .item").nth(2).locator('[data-act="edit"]').click();
  await page.locator("#items .edit-input").fill("Journal for 5 minutes");
  await page.locator("#items .edit-input").press("Enter");
  texts = await itemTexts(page);
  log(`edited item 3: now "${texts[2]}"`);
  if (texts[2] !== "Journal for 5 minutes") throw new Error("edit failed");

  /* 8 — reorder with ↑/↓ buttons; first row's ↑ disabled, last row's ↓ disabled */
  const upDisabled = await page.locator("#items .item").nth(0).locator('[data-act="up"]').isDisabled();
  const downDisabled = await page.locator("#items .item").nth(2).locator('[data-act="down"]').isDisabled();
  await page.locator("#items .item").nth(0).locator('[data-act="down"]').click();
  texts = await itemTexts(page);
  log(`reorder: moved row 1 down -> [${texts.join(", ")}]; edge buttons disabled: first ↑=${upDisabled}, last ↓=${downDisabled}`);
  if (texts.join() !== "Make coffee,Stretch,Journal for 5 minutes" || !upDisabled || !downDisabled)
    throw new Error("reorder wrong");
  await page.locator("#items .item").nth(2).locator('[data-act="up"]').click();
  texts = await itemTexts(page);
  log(`reorder: moved last row up -> [${texts.join(", ")}]`);
  if (texts.join() !== "Make coffee,Journal for 5 minutes,Stretch") throw new Error("reorder up wrong");

  /* 9 — reset checks: soft confirm, cancel path first, then confirm; items are KEPT */
  for (let i = 0; i < 3; i++)
    await page.locator("#items .item").nth(i).locator("input[type=checkbox]").check();
  p = await progress(page);
  log(`all checked before reset: progress="${p.text}"`);
  await page.click("#resetBtn");
  const confirmMsg = await page.locator("#confirmMsg").innerText();
  log(`reset soft-confirm shown: "${confirmMsg}"`);
  await page.click("#confirmNo");
  p = await progress(page);
  log(`after cancel: progress unchanged "${p.text}", confirm hidden=${!(await page.locator("#confirmBar").isVisible())}`);
  if (p.text !== "3 of 3 · 100%") throw new Error("cancel changed state");
  await page.click("#resetBtn");
  await page.click("#confirmYes");
  texts = await itemTexts(page);
  p = await progress(page);
  log(`after reset-checks confirm: progress="${p.text}", items kept=${texts.length} [${texts.join(", ")}], status="${await page.locator("#status").innerText()}"`);
  if (p.text !== "0 of 3 · 0%" || texts.length !== 3) throw new Error("reset-checks wrong");

  /* 10 — rename the list */
  await page.click("#renameBtn");
  const prefill = await page.inputValue("#nameInput");
  await page.fill("#nameInput", "AM routine");
  await page.click("#nameSave");
  log(`rename: form prefilled "${prefill}" -> picker now [${(await page.locator("#listPick option").allInnerTexts()).join(", ")}]`);
  if ((await page.locator("#listPick option").allInnerTexts()).join() !== "AM routine") throw new Error("rename failed");

  /* 11 — template instantiation: Travel packing becomes a second, editable list */
  await page.click("#templatesBtn");
  await page.locator('.tplcard button[data-tpl="0"]').click();
  const opts = await page.locator("#listPick option").allInnerTexts();
  texts = await itemTexts(page);
  p = await progress(page);
  log(`template: picker=[${opts.join(", ")}], active list has ${texts.length} items, first="${texts[0]}", progress="${p.text}"`);
  if (opts.join() !== "AM routine,Travel packing" || texts.length !== 8 || p.text !== "0 of 8 · 0%")
    throw new Error("template instantiation wrong");
  await page.locator("#items .item").nth(0).locator("input[type=checkbox]").check(); // state to persist

  /* 12 — persistence: storage key + reload keeps lists, active list, and check state */
  const lsKeys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("suite.")).sort());
  log(`storage keys: [${lsKeys.join(", ")}]`);
  if (!lsKeys.includes("suite.checklists.v1")) throw new Error("storage key missing");
  await page.reload();
  await page.waitForTimeout(300);
  const afterReload = {
    opts: await page.locator("#listPick option").allInnerTexts(),
    active: await page.locator("#listPick option:checked").innerText(),
    items: (await itemTexts(page)).length,
    progress: (await progress(page)).text,
  };
  log(`after reload: lists=[${afterReload.opts.join(", ")}], active="${afterReload.active}", items=${afterReload.items}, progress="${afterReload.progress}"`);
  if (afterReload.opts.join() !== "AM routine,Travel packing" || afterReload.active !== "Travel packing" ||
      afterReload.items !== 8 || afterReload.progress !== "1 of 8 · 13%")
    throw new Error("persistence wrong");

  /* 13 — export the whole store as JSON (valid, complete) */
  const dlPromise = page.waitForEvent("download", { timeout: 5000 });
  await page.click("#exportBtn");
  const download = await dlPromise;
  const exportPath = join(evidenceDir, "checklists-export.json");
  await download.saveAs(exportPath);
  const exported = JSON.parse(readFileSync(exportPath, "utf8"));
  log(`export: filename="${download.suggestedFilename()}", valid JSON with ${exported.lists.length} lists ` +
      `[${exported.lists.map(l => `${l.name}:${l.items.length} items`).join(", ")}], active id present=${!!exported.active}`);
  if (download.suggestedFilename() !== "checklists.json" || exported.lists.length !== 2) throw new Error("export wrong");

  /* 14 — delete a list (soft confirm), then import round-trips the export back */
  await page.selectOption("#listPick", { label: "AM routine" });
  await page.click("#deleteBtn");
  log(`delete soft-confirm: "${await page.locator("#confirmMsg").innerText()}"`);
  await page.click("#confirmYes");
  let optsNow = await page.locator("#listPick option").allInnerTexts();
  log(`after delete: picker=[${optsNow.join(", ")}]`);
  if (optsNow.join() !== "Travel packing") throw new Error("delete failed");
  await page.setInputFiles("#importFile", exportPath);
  await page.waitForTimeout(200);
  optsNow = await page.locator("#listPick option").allInnerTexts();
  const roundTrip = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("suite.checklists.v1"));
    return d.lists.map(l => `${l.name}:${l.items.length}:${l.items.filter(i => i.done).length}`).join("|");
  });
  log(`import round-trip: status="${await page.locator("#status").innerText()}", picker=[${optsNow.join(", ")}], store="${roundTrip}"`);
  if (optsNow.join() !== "AM routine,Travel packing" || roundTrip !== "AM routine:3:0|Travel packing:8:1")
    throw new Error("import round-trip wrong");

  /* 15 — malformed import shows a polite error, state untouched */
  const badPath = join(evidenceDir, "bad-import.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(badPath, '{"nope": true}');
  await page.setInputFiles("#importFile", badPath);
  await page.waitForTimeout(200);
  log(`malformed import: status="${await page.locator("#status").innerText()}", lists still=${(await page.locator("#listPick option").count())}`);
  if ((await page.locator("#listPick option").count()) !== 2) throw new Error("bad import mutated state");

  /* 16 — mobile 390 px: no horizontal overflow */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    body: document.body.scrollWidth <= document.body.clientWidth + 1,
  }));
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  log(`mobile 390px: doc no-overflow=${overflow.doc}, body no-overflow=${overflow.body} (mobile.png)`);
  if (!overflow.doc) throw new Error("horizontal overflow at 390px");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
}
