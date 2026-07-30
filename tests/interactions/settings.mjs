/* tests/interactions/settings.mjs — Suite Settings (Phase 4 item 1, born in v2: no v1 original)

   The headline feature is the suite-wide backup/restore ROUND TRIP, verified with
   no shortcuts: seed a representative spread of suite.* keys (a fake API key, a
   location, cache envelopes, the theme, a bare v1-style string, unicode bytes,
   and non-canonical JSON spacing that a parse->re-stringify would destroy) ->
   export -> capture the JSON -> wipe every suite.* key -> import -> assert every
   key comes back BYTE-IDENTICAL, key by key, in the log.

   Also verified here: restore's suite.*-only guard (tamper payload), the key
   manager (set via Enter / reveal / clear -> nasa DEMO_KEY demo-fallback nudge),
   relay config + live test (route-fulfilled success proving the ?url= contract,
   then route-aborted failure proving the designed CSP explanation state), the
   theme segmented control (light/dark/system incl. key removal), shared location
   (validation, save, clear), the storage viewer (reflects live keys, per-key
   delete), and cache purge (exactly suite.cache.*, others intact). */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const selectors = [
  "body", ".topbar", ".back", ".theme-btn", "header h1", "header .tag",
  "#backupCard", "#exportBtn", "#keysCard", "#relayCard", "#storageTable", "footer"
];

export const screenshotAfterInteract = true;

/* representative seed — every value class the suite actually stores */
const SEED = {
  "suite.theme": "light",                       // (also what the harness init script writes)
  "suite.key.finnhub": "fake-finnhub-key-for-roundtrip-123",
  "suite.location": JSON.stringify({ lat: 37.77, lon: -122.42, label: "San Francisco" }),
  "suite.cache.demo.one": JSON.stringify({ t: 1752000000000, v: { rows: [1, 2, 3], note: "cache envelope" } }),
  "suite.cache.demo.two": JSON.stringify({ t: 1752000000001, v: "second envelope" }),
  "suite.units": "F",                           // bare v1-style string (not JSON)
  "suite.hub.favorites": JSON.stringify(["weather", "calc", "retired-v2-tool"]),
  "suite.hub.recents": JSON.stringify([
    { id: "calc", t: 1785427200123 },
    { id: "weather", t: 1785427100456 },
    { id: "retired-v2-tool", t: 1700000000789 }
  ]),
  "suite.focus.settings": JSON.stringify({ focus: 25, short: 5, long: 15, rounds: 4, chime: 60, auto: 1 }),
  "suite.notes.test": '{"txt":"café ☕ — naïve ünïcode"}',          // multi-byte fidelity
  "suite.roundtrip.spacing": '{ "a":1,   "b": [2,3] , "c":"x" }'   // non-canonical spacing:
    // JSON.parse->re-stringify would NOT reproduce these bytes; verbatim handling must
};

const RELAY_BASE = "https://relay-probe.local-suite-test.workers.dev/r";
const RELAY_RE = /relay-probe\.local-suite-test\.workers\.dev/;

const txt = async (page, sel) => (await page.locator(sel).innerText()).replace(/\s+/g, " ").trim();
const suiteLS = page => page.evaluate(() => {
  const o = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith("suite.")) o[k] = localStorage.getItem(k);
  }
  return o;
});

export async function interact({ page, log, evidenceDir }) {
  log("NOTE: settings.html is born in v2 (no v1 original) — this run verifies the ROADMAP");
  log("NOTE: Phase 4 spec directly. The relay 'success' path is route-fulfilled (no live");
  log("NOTE: request leaves the machine); the failure path is route-aborted to exercise the");
  log("NOTE: designed blocked/CSP explanation state.");

  /* ================= 1. seed + storage viewer reflects live keys ================= */
  await page.evaluate(s => { for (const k in s) localStorage.setItem(k, s[k]); }, SEED);
  await page.reload();
  await page.waitForSelector("#storageTable tbody tr");

  const before = await suiteLS(page);
  log(`seeded ${Object.keys(before).length} suite.* keys: ${Object.keys(before).sort().join(", ")}`);

  const viewerKeys = await page.$$eval("#storageTable tbody tr", trs =>
    trs.map(r => r.querySelector("td code").textContent));
  const lsKeys = Object.keys(before).sort();
  log(`storage viewer rows (${viewerKeys.length}): ${viewerKeys.join(", ")}`);
  log(`viewer matches live localStorage key set: ${JSON.stringify(viewerKeys) === JSON.stringify(lsKeys)}`);
  log(`storage summary: "${await txt(page, "#storageSummary")}"`);
  const previewCell = await page.$$eval("#storageTable tbody tr", trs => {
    const r = trs.find(t => t.querySelector("td code").textContent === "suite.notes.test");
    return r ? { size: r.children[1].textContent, preview: r.children[2].textContent } : null;
  });
  log(`viewer row suite.notes.test: size=${previewCell.size} (UTF-8 bytes, value has multi-byte chars), preview="${previewCell.preview}"`);

  /* ================= 2. round trip: export -> wipe -> import -> byte-identical ================= */
  await page.click("#exportBtn");
  log(`export msg: "${await txt(page, "#backupMsg")}"`);
  const backupJson = await page.inputValue("#backupText");
  const envelope = JSON.parse(backupJson);
  log(`envelope: format=${envelope.format}, exported=${envelope.exported}, keys=${envelope.keys}, data entries=${Object.keys(envelope.data).length}`);
  let envMatch = true;
  for (const k of lsKeys) if (envelope.data[k] !== before[k]) { envMatch = false; log(`  ENVELOPE MISMATCH at ${k}`); }
  log(`envelope.data verbatim vs live localStorage (${lsKeys.length} keys): ${envMatch ? "all byte-identical" : "MISMATCH"}`);
  log(`download button enabled after export: ${await page.$eval("#downloadBtn", b => !b.disabled)}`);
  // download the same string as a real file event
  try {
    const dl = await Promise.race([
      (async () => { const p = page.waitForEvent("download"); await page.click("#downloadBtn"); return p; })(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("no download event in 5s")), 5000))
    ]);
    log(`download event: suggested filename "${dl.suggestedFilename()}"`);
    await dl.cancel().catch(() => {});
  } catch (e) {
    log(`download event: not observed in harness (${e.message}) — same JSON is verified via the textarea`);
  }
  writeFileSync(join(evidenceDir, "backup-export.json"), backupJson);

  // wipe every suite.* key ("scratch profile" state), reload
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("suite.")) localStorage.removeItem(k);
  });
  await page.reload();
  await page.waitForSelector("#exportBtn");
  const wiped = await suiteLS(page);
  log(`after wipe + reload: ${Object.keys(wiped).length} suite.* key(s) present: ${Object.keys(wiped).join(", ") || "(none)"}`);
  log(`  (suite.theme is re-seeded by the harness's addInitScript on every load; its restored`);
  log(`   value "light" is byte-identical to the seeded one, so the round trip still covers it)`);
  log(`storage summary on wiped profile: "${await txt(page, "#storageSummary")}"`);
  await page.screenshot({ path: join(evidenceDir, "wiped-profile.png"), fullPage: true });

  // restore guards first: empty, invalid JSON, wrong format
  await page.click("#restoreBtn");
  log(`restore with empty textarea -> "${await txt(page, "#restoreMsg")}"`);
  await page.fill("#restoreText", "this is not json{");
  await page.click("#restoreBtn");
  log(`restore with invalid JSON -> "${await txt(page, "#restoreMsg")}"`);
  await page.fill("#restoreText", JSON.stringify({ format: "something-else", data: {} }));
  await page.click("#restoreBtn");
  log(`restore with wrong format -> "${await txt(page, "#restoreMsg")}"`);

  // the real import
  await page.fill("#restoreText", backupJson);
  await page.click("#restoreBtn");
  log(`restore msg: "${await txt(page, "#restoreMsg")}"`);
  const after = await suiteLS(page);
  let identical = 0, diff = 0;
  for (const k of lsKeys) {
    const ok = after[k] === before[k];
    ok ? identical++ : diff++;
    log(`  round-trip ${k}: ${ok ? "byte-identical" : `MISMATCH before=${JSON.stringify(before[k])} after=${JSON.stringify(after[k])}`}`);
  }
  const extra = Object.keys(after).filter(k => !(k in before));
  log(`ROUND-TRIP VERDICT: ${identical}/${lsKeys.length} keys byte-identical, ${diff} mismatched, ${extra.length} unexpected extra key(s)${extra.length ? ": " + extra.join(", ") : ""}`);
  await page.screenshot({ path: join(evidenceDir, "roundtrip-restored.png"), fullPage: true });

  /* tamper payload: non-suite keys and non-string values must be skipped */
  const tamper = {
    format: "local-suite.backup.v2", exported: "2026-07-16T00:00:00Z", keys: 3,
    data: { "evil.key": "injected", "localStorageBomb": "x", "suite.bad.nonstring": 42, "suite.tamper.ok": "kept" }
  };
  await page.fill("#restoreText", JSON.stringify(tamper));
  await page.click("#restoreBtn");
  log(`tamper restore msg: "${await txt(page, "#restoreMsg")}"`);
  const postTamper = await page.evaluate(() => ({
    evil: localStorage.getItem("evil.key"), bomb: localStorage.getItem("localStorageBomb"),
    nonstring: localStorage.getItem("suite.bad.nonstring"), ok: localStorage.getItem("suite.tamper.ok")
  }));
  log(`tamper guard: evil.key=${postTamper.evil}, localStorageBomb=${postTamper.bomb}, suite.bad.nonstring=${postTamper.nonstring} (all must be null), suite.tamper.ok=${JSON.stringify(postTamper.ok)} (written)`);

  /* v2 backup compatibility: restoring only suite.location must replace, not be
     overwritten by, the collection that already exists in this v3 profile. */
  const v2LocationBackup = {
    format: "local-suite.backup.v2", exported: "2026-07-15T00:00:00Z", keys: 1,
    data: { "suite.location": JSON.stringify({ lat: 55, lon: 66, label: "Restored legacy" }) }
  };
  await page.fill("#restoreText", JSON.stringify(v2LocationBackup));
  await page.click("#restoreBtn");
  const v2Restored = await page.evaluate(() => ({
    mirror: JSON.parse(localStorage.getItem("suite.location")),
    collection: JSON.parse(localStorage.getItem("suite.locations"))
  }));
  log(`v2 location-only restore wins over prior v3 collection: ${JSON.stringify(v2Restored)}`);
  // Restore the full seed snapshot so the remaining checks retain their known baseline.
  await page.fill("#restoreText", backupJson);
  await page.click("#restoreBtn");

  /* ================= 3. key manager ================= */
  const nasa = 'div.keyrow[data-key="nasa"]';
  log(`nasa status before set (demo fallback): "${await txt(page, nasa + " .kstatus")}"`);
  log(`finnhub status (restored custom key): "${await txt(page, 'div.keyrow[data-key="finnhub"] .kstatus')}"`);
  log(`finnhub input masked: type=${await page.getAttribute('div.keyrow[data-key="finnhub"] input', "type")}`);
  log(`aviationstack key row available for Flight Tracker: count=${await page.locator('div.keyrow[data-key="aviationstack"]').count()}, status="${await txt(page, 'div.keyrow[data-key="aviationstack"] .kstatus')}"`);

  await page.fill(nasa + " input", "TESTKEY-NASA-LOCAL-HARNESS");
  await page.press(nasa + " input", "Enter"); // a11y: Enter saves
  log(`nasa key saved via Enter: stored=${await page.evaluate(() => JSON.stringify(localStorage.getItem("suite.key.nasa")))}, ` +
    `status="${await txt(page, nasa + " .kstatus")}", card msg="${await txt(page, "#keysMsg")}"`);

  // reveal toggle
  const revealSel = nasa + " button[aria-label*='NASA API key'][aria-pressed]";
  log(`reveal before: input type=${await page.getAttribute(nasa + " input", "type")}, aria-pressed=${await page.getAttribute(revealSel, "aria-pressed")}, aria-label="${await page.getAttribute(revealSel, "aria-label")}"`);
  await page.click(revealSel);
  log(`reveal after click: input type=${await page.getAttribute(nasa + " input", "type")}, aria-pressed=${await page.getAttribute(revealSel, "aria-pressed")}, aria-label="${await page.getAttribute(revealSel, "aria-label")}", visible value="${await page.inputValue(nasa + " input")}"`);
  await page.click(revealSel);
  log(`reveal toggled back: input type=${await page.getAttribute(nasa + " input", "type")}`);

  // empty-save guard
  await page.fill(nasa + " input", "TEMP");
  await page.fill(nasa + " input", "");
  await page.click(nasa + " button:has-text('Save')");
  log(`save with empty field -> "${await txt(page, "#keysMsg")}" (stored key untouched: ${await page.evaluate(() => JSON.stringify(localStorage.getItem("suite.key.nasa")))})`);

  // clear -> demo fallback nudge (Suite.key("nasa").isDemo path)
  await page.click(nasa + " button:has-text('Clear')");
  log(`nasa cleared: stored=${await page.evaluate(() => JSON.stringify(localStorage.getItem("suite.key.nasa")))}, ` +
    `status="${await txt(page, nasa + " .kstatus")}" (must show the shared DEMO_KEY nudge)`);
  log(`bart demo status (published public key): "${await txt(page, 'div.keyrow[data-key="bart"] .kstatus')}"`);
  log(`eia no-demo status: "${await txt(page, 'div.keyrow[data-key="eia"] .kstatus')}"`);
  await page.screenshot({ path: join(evidenceDir, "key-manager.png"), fullPage: true });

  /* ================= 4. relay config + live test ================= */
  log(`relay current (unset): "${await txt(page, "#relayCur")}"`);
  await page.fill("#relayInput", "not-a-url");
  await page.click("#relaySaveBtn");
  log(`relay save with non-URL -> "${await txt(page, "#relayMsg")}"`);
  await page.fill("#relayInput", RELAY_BASE);
  await page.click("#relaySaveBtn");
  log(`relay saved: suite.relay.url=${await page.evaluate(() => JSON.stringify(localStorage.getItem("suite.relay.url")))}`);
  log(`relay save msg (shows rewritten probe): "${await txt(page, "#relayMsg")}"`);
  log(`relay current line: "${await txt(page, "#relayCur")}"`);

  // success path: route-fulfil the rewritten ?url= request
  const seen = [];
  await page.route(RELAY_RE, route => {
    seen.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/json",
      headers: { "access-control-allow-origin": "*" }, body: '{"ok":true}' });
  });
  await page.click("#relayTestBtn");
  await page.waitForFunction(() => /Relay reachable/.test(document.getElementById("relayMsg").textContent), null, { timeout: 10000 });
  log(`relay live test (route-fulfilled): "${await txt(page, "#relayMsg")}"`);
  log(`intercepted request URL: ${seen[0]}`);
  const q = new URL(seen[0]).searchParams.get("url");
  log(`?url= contract: decoded target = ${q} (expected https://example.org/probe): ${q === "https://example.org/probe"}`);
  await page.screenshot({ path: join(evidenceDir, "relay-success.png"), fullPage: true });

  // blocked/failure path: abort the request (stands in for the dist CSP block; net::ERR
  // console lines are expected and filtered by the harness)
  await page.unroute(RELAY_RE);
  await page.route(RELAY_RE, route => route.abort());
  await page.click("#relayTestBtn");
  await page.waitForFunction(() => /Test failed/.test(document.getElementById("relayMsg").textContent), null, { timeout: 15000 });
  const failMsg = await txt(page, "#relayMsg");
  log(`relay live test (route-aborted): "${failMsg}"`);
  log(`designed explanation present: mentions CSP=${/Content-Security-Policy/.test(failMsg)}, ` +
    `mentions blocked-by-design=${/by design/.test(failMsg)}, says URL stays saved=${/stays saved/.test(failMsg)}`);
  await page.screenshot({ path: join(evidenceDir, "relay-blocked.png"), fullPage: true });
  await page.unroute(RELAY_RE);

  await page.click("#relayClearBtn");
  log(`relay cleared: suite.relay.url=${await page.evaluate(() => JSON.stringify(localStorage.getItem("suite.relay.url")))}, ` +
    `current line: "${await txt(page, "#relayCur")}", msg: "${await txt(page, "#relayMsg")}"`);

  /* ================= 5. theme segmented control + shared location ================= */
  const segState = () => page.evaluate(() => ({
    dataTheme: document.documentElement.dataset.theme || "(unset)",
    stored: localStorage.getItem("suite.theme"),
    pressed: [...document.querySelectorAll("#themeSeg button")].map(b => b.dataset.th + "=" + b.getAttribute("aria-pressed")).join(" ")
  }));
  log(`theme seg initial: ${JSON.stringify(await segState())}`);
  await page.click('#themeSeg button[data-th="dark"]');
  log(`theme -> dark: ${JSON.stringify(await segState())}, msg="${await txt(page, "#themeMsg")}"`);
  await page.click('#themeSeg button[data-th="system"]');
  log(`theme -> system (key removed): ${JSON.stringify(await segState())}, msg="${await txt(page, "#themeMsg")}"`);
  await page.click('#themeSeg button[data-th="light"]');
  log(`theme -> light: ${JSON.stringify(await segState())}`);

  const migrated = await page.evaluate(() => ({
    legacy: JSON.parse(localStorage.getItem("suite.location")),
    collection: JSON.parse(localStorage.getItem("suite.locations"))
  }));
  log(`v2 location migration: ${JSON.stringify(migrated)}`);
  log(`location current (restored seed): "${await txt(page, "#locCur")}", saved rows=${await page.locator("#locList .locitem").count()}`);

  await page.click("#locAddBtn");
  await page.fill("#locLabel", "London");
  await page.fill("#locLat", "abc");
  await page.click("#locSaveBtn");
  log(`location save with invalid lat -> "${await txt(page, "#locMsg")}"`);
  await page.fill("#locLat", "51.5");
  await page.fill("#locLon", "-0.12");
  await page.press("#locLon", "Enter"); // a11y: Enter saves
  log(`London added: suite.locations=${await page.evaluate(() => localStorage.getItem("suite.locations"))}, rows=${await page.locator("#locList .locitem").count()}, msg="${await txt(page, "#locMsg")}"`);

  // Switching mirrors suite.location, resets ambiguous derived choices, and preserves
  // safe scoped/global caches.
  await page.evaluate(() => {
    localStorage.setItem("suite.cache.location-switch-probe", JSON.stringify({ t: Date.now(), v: "safe scoped data" }));
    localStorage.setItem("suite.radar.station", "OLD-STATION");
    localStorage.setItem("suite.state", "OLD");
  });
  await page.click('.locitem[data-location-id="london"] button:has-text("Use")');
  const afterSwitch = await page.evaluate(() => ({
    mirror: JSON.parse(localStorage.getItem("suite.location")),
    collection: JSON.parse(localStorage.getItem("suite.locations")),
    safeCache: localStorage.getItem("suite.cache.location-switch-probe"),
    radarStation: localStorage.getItem("suite.radar.station"),
    state: localStorage.getItem("suite.state")
  }));
  log(`London activated: ${JSON.stringify(afterSwitch)}, current="${await txt(page, "#locCur")}", msg="${await txt(page, "#locMsg")}"`);

  // Editing active coordinates increments its revision and resets derived station state.
  await page.click('.locitem[data-location-id="london"] button:has-text("Edit")');
  await page.evaluate(() => localStorage.setItem("suite.normals.station", "OLD-NORMALS-STATION"));
  await page.fill("#locLat", "51.51");
  await page.click("#locSaveBtn");
  const afterEdit = await page.evaluate(() => ({
    mirror: JSON.parse(localStorage.getItem("suite.location")),
    collection: JSON.parse(localStorage.getItem("suite.locations")),
    normalsStation: localStorage.getItem("suite.normals.station"),
    focus: document.activeElement && document.activeElement.id
  }));
  log(`active London edited: ${JSON.stringify(afterEdit)}, msg="${await txt(page, "#locMsg")}"`);

  // Deleting the active entry falls back to the migrated v2 location and mirrors it.
  page.once("dialog", d => d.accept());
  await page.click('.locitem[data-location-id="london"] button:has-text("Delete")');
  log(`active London deleted: mirror=${await page.evaluate(() => localStorage.getItem("suite.location"))}, collection=${await page.evaluate(() => localStorage.getItem("suite.locations"))}, rows=${await page.locator("#locList .locitem").count()}, msg="${await txt(page, "#locMsg")}"`);

  /* ================= 6. per-key delete + cache purge ================= */
  const delSel = 'button[aria-label="Delete suite.tamper.ok"]';
  log(`per-key delete: row button aria-label="Delete suite.tamper.ok" present: ${await page.locator(delSel).count() === 1}`);
  await page.click(delSel);
  log(`after delete: suite.tamper.ok=${await page.evaluate(() => JSON.stringify(localStorage.getItem("suite.tamper.ok")))}, ` +
    `storage msg="${await txt(page, "#storageMsg")}"`);

  await page.evaluate(() => {
    localStorage.setItem("suite.cache.purge-test.one", JSON.stringify({ t: Date.now(), v: 1 }));
    localStorage.setItem("suite.cache.purge-test.two", JSON.stringify({ t: Date.now(), v: 2 }));
  });
  const beforePurge = Object.keys(await suiteLS(page)).sort();
  const cacheKeys = beforePurge.filter(k => k.startsWith("suite.cache."));
  log(`before purge: ${beforePurge.length} keys, cache keys: ${cacheKeys.join(", ")}`);
  await page.click("#purgeBtn");
  const afterPurge = Object.keys(await suiteLS(page)).sort();
  const survivors = beforePurge.filter(k => !k.startsWith("suite.cache."));
  log(`purge msg: "${await txt(page, "#storageMsg")}"`);
  log(`after purge: cache keys remaining=${afterPurge.filter(k => k.startsWith("suite.cache.")).length} (expected 0), ` +
    `non-cache keys intact=${JSON.stringify(afterPurge) === JSON.stringify(survivors)} (${afterPurge.length}/${survivors.length})`);
  log(`storage summary now: "${await txt(page, "#storageSummary")}"`);
  await page.click("#purgeBtn"); // idempotence
  log(`second purge (nothing left): "${await txt(page, "#storageMsg")}"`);

  /* ================= 7. a11y spot-checks (QUALITY.md §2) ================= */
  const a11y = await page.evaluate(() => {
    const live = [...document.querySelectorAll("[aria-live]")].map(e => e.id);
    const unlabeled = [...document.querySelectorAll("input, textarea")].filter(el => {
      if (el.hidden || el.type === "file" || el.type === "hidden") return false;
      return !el.getAttribute("aria-label") && !document.querySelector(`label[for="${el.id}"]`);
    }).map(el => el.id || el.name || el.type);
    const iconBtnsNoLabel = [...document.querySelectorAll("button")].filter(b =>
      !/[a-z]/i.test(b.textContent) && !b.getAttribute("aria-label")).map(b => b.textContent);
    return { live, unlabeled, iconBtnsNoLabel, overlays: document.querySelectorAll("dialog, [role=dialog]").length };
  });
  log(`a11y: aria-live regions on all async/result areas: ${a11y.live.join(", ")}`);
  log(`a11y: inputs/textareas without label or aria-label: ${a11y.unlabeled.length ? a11y.unlabeled.join(", ") : "(none)"}`);
  log(`a11y: icon-only buttons missing aria-label: ${a11y.iconBtnsNoLabel.length ? a11y.iconBtnsNoLabel.join(", ") : "(none)"} ` +
    `(theme-btn "◐ theme" has text + core label; reveal/delete buttons carry per-item labels)`);
  log(`a11y: overlays/dialogs needing Esc: ${a11y.overlays} (none exist by design)`);
}
