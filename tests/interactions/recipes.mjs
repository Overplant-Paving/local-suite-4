/* tests/interactions/recipes.mjs — exercises Recipe Box end-to-end.
   Offline tool: starter seed, create with mixed-form quantities, fraction-aware
   scaling with exact string assertions, ephemeral step checkboxes, edit round-trip,
   persistence across reload, export JSON shape, import merge with title-collision
   suffix, delete with confirm, print CSS (chrome hidden), mobile no-overflow, a11y. */
import { join } from "node:path";
import { readFileSync } from "node:fs";

export const selectors = [
  "body", ".wrap", "header h1", ".theme-btn", ".btn", ".rcard",
  ".recipe-card", ".stepper", "#vIngredients", "#vSteps", "footer"
];
export const screenshotAfterInteract = true;
export const printShots = true;

function expect(cond, msg) { if (!cond) throw new Error("EXPECT FAILED: " + msg); }

function cardByTitle(page, title) {
  return page.locator(".rcard").filter({ has: page.locator(`.rtitle:text-is("${title}")`) });
}
async function ingredientTexts(page) {
  return page.locator("#vIngredients li").allInnerTexts();
}

const BASE_INGREDIENTS = [
  "2 cups flour",
  "1 1/2 tsp baking powder",
  "3/4 cup sugar",
  "1.5 cups milk — whole",
  "salt to taste",
  "3 eggs",
];
/* 1.5 cups is displayed normalized as the kitchen fraction "1 1/2" */
const AT_4 = [
  "2 cups flour",
  "1 1/2 tsp baking powder",
  "3/4 cup sugar",
  "1 1/2 cups milk — whole",
  "salt to taste",
  "3 eggs",
];
const AT_6 = [
  "3 cups flour",
  "2 1/4 tsp baking powder",
  "1 1/8 cup sugar",
  "2 1/4 cups milk — whole",
  "salt to taste",
  "4 1/2 eggs",
];

export async function interact({ page, log, evidenceDir }) {
  /* 1 — starter example recipe seeds on first run */
  expect(await page.locator(".rcard").count() === 1, "exactly one starter recipe on first run");
  const starter = await page.locator(".rcard .rtitle").first().innerText();
  const starterMeta = await page.locator(".rcard .rmeta").first().innerText();
  log(`first-run starter recipe: "${starter}" (${starterMeta})`);
  expect(starter === "Everyday Pancakes", "starter recipe is Everyday Pancakes");
  expect(starterMeta === "serves 4 · 7 ingredients", "card shows servings + ingredient count");

  /* 2 — create a recipe with mixed-form quantities (int, mixed, fraction, decimal, none) */
  await page.click("#newBtn");
  expect(await page.locator("#editView").isVisible(), "editor opens for a new recipe");
  /* a11y: every editor field has a matching <label for> */
  for (const id of ["fTitle", "fServings", "fIngredients", "fSteps", "fSource"]) {
    expect(await page.locator(`label[for="${id}"]`).count() === 1, `label[for=${id}] present`);
  }
  log("a11y: labels present for fTitle, fServings, fIngredients, fSteps, fSource");
  await page.fill("#fTitle", "Scaling Test Pancakes");
  await page.fill("#fServings", "4");
  await page.fill("#fIngredients", BASE_INGREDIENTS.join("\n"));
  await page.fill("#fSteps", "Mix the dry ingredients.\nWhisk the wet ingredients.\nCombine and cook.");
  await page.fill("#fSource", "Family card");
  await page.click("#saveBtn");
  expect(await page.locator("#viewView").isVisible(), "viewer opens after save");
  log("status after save: " + (await page.locator("#status").innerText()));

  /* 3 — viewer at base servings */
  let ing = await ingredientTexts(page);
  log("viewer at 4 servings: " + JSON.stringify(ing));
  expect(JSON.stringify(ing) === JSON.stringify(AT_4), "base quantities render as kitchen fractions");
  expect(await page.locator("#servVal").innerText() === "4", "stepper shows base servings");

  /* 4 — scale 4 → 6: fraction-aware rewrite, exact strings */
  await page.click("#servPlus");
  await page.click("#servPlus");
  expect(await page.locator("#servVal").innerText() === "6", "stepper shows 6");
  const meta = await page.locator("#vMeta").innerText();
  log("meta at 6 servings: " + meta);
  expect(meta.includes("Serves 6") && meta.includes("×1.5") && meta.includes("from 4"),
    "meta announces the 1.5x scale");
  ing = await ingredientTexts(page);
  for (let i = 0; i < AT_6.length; i++) {
    log(`scaled 4->6: "${AT_4[i]}" -> "${ing[i]}"`);
    expect(ing[i] === AT_6[i], `scaled line ${i}: expected "${AT_6[i]}", got "${ing[i]}"`);
  }
  expect(ing[4] === "salt to taste", 'unscalable line "salt to taste" untouched at 6 servings');
  log('unscalable line untouched: "salt to taste" (1 1/2 -> 2 1/4 verified above)');

  /* 5 — step checkboxes while cooking (ephemeral) */
  await page.check("#vSteps li:first-child input");
  expect(await page.locator("#vSteps li:first-child input").isChecked(), "step 1 checkbox checks");
  await page.click("#servPlus"); // scaling must not wipe cooking progress
  expect(await page.locator("#vSteps li:first-child input").isChecked(),
    "step checkbox survives a servings change");
  await page.click("#servMinus");
  log("step 1 checked while cooking; survives servings changes; persistence checked after reload");

  /* 6 — edit round-trip: form repopulates exactly, title change flows through */
  await page.click("#editBtn");
  expect(await page.locator("#fTitle").inputValue() === "Scaling Test Pancakes", "edit: title round-trips");
  expect(await page.locator("#fServings").inputValue() === "4", "edit: servings round-trips");
  expect(await page.locator("#fIngredients").inputValue() === BASE_INGREDIENTS.join("\n"),
    "edit: ingredients textarea round-trips verbatim (original forms kept)");
  expect(await page.locator("#fSource").inputValue() === "Family card", "edit: source round-trips");
  log("edit round-trip: all fields repopulate with the original text (1 1/2, 3/4, 1.5 kept verbatim)");
  await page.fill("#fTitle", "Scaling Test Pancakes v2");
  await page.click("#saveBtn");
  expect(await page.locator("#vTitle").innerText() === "Scaling Test Pancakes v2", "renamed title shows in viewer");
  log("edited title saved: viewer shows Scaling Test Pancakes v2");

  /* 7 — persistence: reload, storage key, checkboxes NOT persisted */
  await page.reload();
  await page.waitForTimeout(400);
  expect(await page.locator(".rcard").count() === 2, "both recipes persist across reload");
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("suite.recipes.v1");
    const arr = raw ? JSON.parse(raw) : null;
    return arr && { n: arr.length, titles: arr.map(r => r.title), keys: Object.keys(arr[0]).sort() };
  });
  log("suite.recipes.v1 after reload: " + JSON.stringify(stored));
  expect(stored && stored.n === 2 && stored.titles.includes("Scaling Test Pancakes v2"),
    "suite.recipes.v1 holds both recipes");
  await cardByTitle(page, "Scaling Test Pancakes v2").click();
  const ingAfter = await ingredientTexts(page);
  expect(JSON.stringify(ingAfter) === JSON.stringify(AT_4), "recipe content intact after reload");
  expect(!(await page.locator("#vSteps li:first-child input").isChecked()),
    "step checkboxes are ephemeral — unchecked after reload");
  log("after reload: content intact at base servings, step checkboxes reset (not persisted)");

  /* 8 — export JSON shape */
  await page.click("#backBtn");
  const dlPromise = page.waitForEvent("download", { timeout: 5000 });
  await page.click("#exportBtn");
  const dl = await dlPromise;
  const exported = JSON.parse(readFileSync(await dl.path(), "utf8"));
  log(`export: ${dl.suggestedFilename()} — format=${exported.format}, recipes=${exported.recipes.length}`);
  expect(/^recipes-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), "export filename shape");
  expect(exported.format === "suite.recipes.v1" && Array.isArray(exported.recipes)
    && exported.recipes.length === 2, "export envelope shape");
  const er = exported.recipes.find(r => r.title === "Scaling Test Pancakes v2");
  expect(er && er.servings === 4 && Array.isArray(er.ingredients) && er.ingredients.length === 6
    && Array.isArray(er.steps) && er.steps.length === 3 && er.source === "Family card"
    && typeof er.id === "string" && typeof er.updated === "number",
    "exported recipe has id/title/servings/ingredients/steps/source/updated");
  log("export recipe shape verified: " + JSON.stringify(Object.keys(er).sort()));

  /* 9 — import merge: title collision gets a suffix, new recipe just lands */
  const fixture = JSON.stringify({
    format: "suite.recipes.v1",
    recipes: [
      { title: "Scaling Test Pancakes v2", servings: 4, ingredients: ["1 cup imported flour"], steps: ["Stir."] },
      { title: "Imported Soup", servings: 2, ingredients: ["4 cups stock", "1/2 cup orzo"], steps: ["Simmer."], source: "a friend" },
    ],
  });
  await page.setInputFiles("#importFile", {
    name: "recipes-import.json", mimeType: "application/json", buffer: Buffer.from(fixture),
  });
  await page.waitForFunction(() => document.getElementById("status").textContent.includes("Imported"));
  log("import status: " + (await page.locator("#status").innerText()));
  expect(await page.locator(".rcard").count() === 4, "4 recipes after import merge");
  expect(await cardByTitle(page, "Scaling Test Pancakes v2 (2)").count() === 1,
    "title collision merged with (2) suffix");
  expect(await cardByTitle(page, "Imported Soup").count() === 1, "new imported recipe present");
  log("import merge: collision renamed to 'Scaling Test Pancakes v2 (2)', 'Imported Soup' added");

  /* 10 — delete with confirm */
  await cardByTitle(page, "Imported Soup").click();
  page.once("dialog", d => {
    log("delete confirm dialog: " + d.message());
    d.accept();
  });
  await page.click("#deleteBtn");
  await page.waitForTimeout(100);
  expect(await page.locator("#listView").isVisible(), "back on the list after delete");
  expect(await page.locator(".rcard").count() === 3, "3 recipes after delete");
  expect(await cardByTitle(page, "Imported Soup").count() === 0, "deleted recipe gone");
  log("delete: confirmed dialog, Imported Soup removed, status: " +
    (await page.locator("#status").innerText()));

  /* 11 — print CSS: viewer prints as a single tidy card, all chrome hidden */
  await cardByTitle(page, "Scaling Test Pancakes v2").click();
  await page.click("#servPlus");
  await page.click("#servPlus"); // print the scaled 6-serving card
  await page.emulateMedia({ media: "print" });
  const printState = await page.evaluate(() => {
    const disp = sel => getComputedStyle(document.querySelector(sel)).display;
    return {
      topbar: disp(".topbar"), header: disp("header"), footer: disp("footer"),
      actions: disp(".vactions"), stepper: disp(".stepper"), status: disp("#status"),
      card: disp(".recipe-card"),
    };
  });
  log("print media computed display: " + JSON.stringify(printState));
  expect(printState.topbar === "none", "print: nav/topbar hidden (display:none)");
  expect(printState.header === "none" && printState.footer === "none", "print: header + footer hidden");
  expect(printState.actions === "none" && printState.stepper === "none" && printState.status === "none",
    "print: action buttons, stepper, status hidden");
  expect(printState.card !== "none", "print: recipe card visible");
  await page.screenshot({ path: join(evidenceDir, "print-card.png"), fullPage: true });
  log("print screenshot (card only, no chrome): print-card.png");
  await page.emulateMedia({ media: "screen" });

  /* 12 — a11y bits */
  expect(await page.locator("#servMinus").getAttribute("aria-label") === "Decrease servings"
    && await page.locator("#servPlus").getAttribute("aria-label") === "Increase servings",
    "stepper buttons have aria-labels");
  expect(await page.locator("#importFile").getAttribute("aria-label") === "Import recipes JSON file",
    "hidden import input labeled");
  expect(await page.locator("#status").getAttribute("aria-live") === "polite"
    && await page.locator("#vMeta").getAttribute("aria-live") === "polite",
    "status + servings meta are polite live regions");
  log("a11y: stepper aria-labels, labeled import input, aria-live on #status and #vMeta");

  /* 13 — mobile 390px: no horizontal overflow in viewer and list */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  let ovf = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  log(`mobile viewer 390px: scrollWidth=${ovf.sw} clientWidth=${ovf.cw}`);
  expect(ovf.sw <= ovf.cw, "no horizontal overflow in viewer at 390px");
  await page.screenshot({ path: join(evidenceDir, "mobile.png"), fullPage: true });
  await page.click("#backBtn");
  ovf = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  log(`mobile list 390px: scrollWidth=${ovf.sw} clientWidth=${ovf.cw}`);
  expect(ovf.sw <= ovf.cw, "no horizontal overflow in list at 390px");
  await page.setViewportSize({ width: 1280, height: 900 });

  /* end on the scaled viewer so the after-interaction shot shows the feature */
  await cardByTitle(page, "Scaling Test Pancakes v2").click();
  await page.click("#servPlus");
  await page.click("#servPlus");
  log("final state: viewer open at 6 servings for after-interaction screenshot");
}
