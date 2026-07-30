/* Local Suite v4 — core/suite.js
   One IIFE, one global. Small, boring, dependency-free. Spec: ARCHITECTURE.md §3. */
(() => {
"use strict";

/* Safe storage backend: memory fallback when localStorage is unavailable
   (private mode, file:// quirks). Persistence is polite, never fatal. */
const backend = (() => {
  try {
    const k = "__suite_t";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return localStorage;
  } catch (e) {
    const mem = new Map();
    return {
      getItem: k => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => { mem.set(k, String(v)); },
      removeItem: k => { mem.delete(k); },
      key: i => Array.from(mem.keys())[i] ?? null,
      get length() { return mem.size; }
    };
  }
})();

function assertNamespaced(key) {
  if (typeof key !== "string" || !key.startsWith("suite.")) {
    throw new Error('Suite.store keys must start with "suite." - got: ' + key);
  }
}

const store = {
  /* v1 wrote some keys as bare strings ("dark", "F") and some as JSON.
     Read both: JSON first, raw string when parsing fails. */
  get(key, fallback = null) {
    assertNamespaced(key);
    const raw = backend.getItem(key);
    if (raw === null) return fallback === undefined ? null : fallback;
    try { return JSON.parse(raw); } catch (e) { return raw; }
  },
  /* Strings are written bare so v1 tools keep reading their keys unchanged. */
  set(key, value) {
    assertNamespaced(key);
    try {
      const raw = typeof value === "string" ? value : JSON.stringify(value);
      backend.setItem(key, raw);
      return backend.getItem(key) === raw;
    } catch (e) { return false; /* quota exceeded or denied - never fatal */ }
  },
  /* Deletes a key outright (v1 tools used removeItem for unpin/clear flows). */
  remove(key) {
    assertNamespaced(key);
    try { backend.removeItem(key); return backend.getItem(key) === null; } catch (e) { return false; }
  },
  /* Ordered migrations gated by suite.meta.schemaVersion (ARCHITECTURE.md §6).
     Baseline v2 = v1 layout, so the suite-wide list starts empty. */
  migrate(fns) {
    const KEY = "suite.meta.schemaVersion";
    let v = store.get(KEY, 0);
    if (typeof v !== "number" || !isFinite(v)) v = 0;
    for (; v < fns.length; v++) fns[v]();
    store.set(KEY, fns.length);
  }
};

/* ---- theme: the suite.theme convention (absent = follow system) ---- */
function activeTheme() {
  return document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function paintThemeButtons() {
  document.querySelectorAll("#themeBtn, .theme-btn").forEach(btn => {
    btn.setAttribute("aria-pressed", String(activeTheme() === "dark"));
  });
}
const theme = {
  init() {
    const saved = store.get("suite.theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.dataset.theme = saved;
    }
    document.querySelectorAll("#themeBtn, .theme-btn").forEach(btn => {
      btn.setAttribute("aria-label", "Toggle light/dark theme");
      btn.addEventListener("click", theme.toggle);
    });
    paintThemeButtons();
    initToolChrome();
  },
  toggle() {
    const next = activeTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("suite.theme", next);
    paintThemeButtons();
  }
};

/* ---- fetch: one helper for the whole suite ----
   Returns an envelope {v, t, stale, fromCache}:
     v         the JSON payload
     t         epoch ms the payload was fetched
     stale     true when the network failed and this is the cached fallback -
               render the "Offline - cached from <time>" card
     fromCache true when no request was made (fresh within ttl, or stale)
   Cache lives at localStorage["suite.cache." + cacheKey] as {t, v}
   (the v1 envelope - v1 caches keep working). ttl is in ms; 0 = always fetch. */
async function fetchJSON(url, opts = {}) {
  const {
    timeout = 12000, cacheKey = null, ttl = 0, fallbackToCache = true,
    accept = "application/json", tries = 1, headers = {}
  } = opts;
  const fullKey = cacheKey ? "suite.cache." + cacheKey : null;
  /* A location switch may happen in this or another tab while a request is in
     flight. Never render or cache a response whose location context changed. */
  const locationAtStart = JSON.stringify(store.get("suite.location"));

  let cached = null;
  if (fullKey) {
    const e = store.get(fullKey);
    if (e && typeof e === "object" && "t" in e && "v" in e) cached = e;
  }
  if (cached && ttl > 0 && Date.now() - cached.t < ttl) {
    return { v: cached.v, t: cached.t, stale: false, fromCache: true };
  }

  let lastErr = null;
  const n = Math.max(1, tries);
  for (let i = 0; i < n; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: Object.assign(accept ? { "Accept": accept } : {}, headers)
      });
      clearTimeout(timer);
      if (r.ok) {
        const v = await r.json();
        if (JSON.stringify(store.get("suite.location")) !== locationAtStart) {
          const changed = new Error("active location changed during request");
          changed.locationChanged = true;
          throw changed;
        }
        const t = Date.now();
        if (fullKey) store.set(fullKey, { t, v });
        return { v, t, stale: false, fromCache: false };
      }
      lastErr = new Error("HTTP " + r.status);
      if (r.status === 404) break; /* a 404 will not improve on retry */
    } catch (e) {
      clearTimeout(timer);
      if (e && e.locationChanged) throw e;
      lastErr = (e && e.name === "AbortError") ? new Error("timed out") : e;
    }
    if (i < n - 1) await new Promise(res => setTimeout(res, 600 * (i + 1)));
  }
  if (fallbackToCache && cached) {
    if (JSON.stringify(store.get("suite.location")) !== locationAtStart) {
      throw new Error("active location changed during request");
    }
    return { v: cached.v, t: cached.t, stale: true, fromCache: true };
  }
  throw lastErr || new Error("fetch failed");
}

/* ---- escaping: mandatory for remote data interpolated into innerHTML ---- */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---- a11y: mark an async result container so screen readers hear updates ---- */
function liveRegion(el) {
  el.setAttribute("aria-live", "polite");
  return el;
}

/* ---- shared locations ----
   suite.location remains the active-location mirror, so every v1/v2 tool keeps
   working unchanged. suite.locations stores the named collection used by v3. */
const LOCATIONS_KEY = "suite.locations";
const LOCATIONS_SCHEMA = 1;

function validLocation(l) {
  return l && typeof l === "object" && isFinite(l.lat) && isFinite(l.lon) &&
    Math.abs(+l.lat) <= 90 && Math.abs(+l.lon) <= 180;
}

function cleanLocation(l) {
  return { lat: +l.lat, lon: +l.lon, label: String(l.label || "").trim() };
}

/* Only state that is unsafe or derived from the active location is reset.
   Coordinate/station/query-keyed caches and global feeds remain available. */
const LOCATION_RESET_KEYS = [
  "suite.cache.wildfire.all", /* legacy unscoped key; v3 writes coordinate-scoped keys */
  "suite.radar.station", "suite.tides.station", "suite.normals.station",
  "suite.state", "suite.alerts.seen"
];
function resetLocationState() {
  let n = 0;
  try {
    for (const k of LOCATION_RESET_KEYS) {
      if (backend.getItem(k) !== null) { backend.removeItem(k); n++; }
    }
  } catch (e) {}
  return n;
}

function readLocations() {
  const raw = store.get(LOCATIONS_KEY);
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return null;
  if (raw.schema !== undefined && raw.schema !== LOCATIONS_SCHEMA) {
    return { schema: raw.schema, activeId: null, items: [], unsupported: true };
  }
  const seen = new Set();
  const items = [];
  let damaged = false;
  for (const x of raw.items) {
    if (!validLocation(x) || typeof x.id !== "string" || !x.id || seen.has(x.id)) {
      damaged = true; continue;
    }
    seen.add(x.id);
    items.push(Object.assign({}, x, {
      id: x.id,
      label: String(x.label || "").trim(),
      lat: +x.lat,
      lon: +x.lon,
      revision: Math.max(1, Number.isInteger(x.revision) ? x.revision : 1)
    }));
  }
  const activeId = items.some(x => x.id === raw.activeId)
    ? raw.activeId : (items[0] ? items[0].id : null);
  if (damaged) {
    return { schema: LOCATIONS_SCHEMA, activeId: null, items: [], invalid: true };
  }
  return Object.assign({}, raw, { schema: LOCATIONS_SCHEMA, activeId, items });
}

function sameValue(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
}
function writeLocations(c) {
  const current = store.get(LOCATIONS_KEY);
  return sameValue(current, c) || store.set(LOCATIONS_KEY, c);
}
function mirrorLocation(item) {
  if (item) {
    const next = cleanLocation(item);
    return sameValue(store.get("suite.location"), next) || store.set("suite.location", next);
  }
  return store.get("suite.location") === null || store.remove("suite.location");
}
function activeItem(c) { return c && c.items.find(x => x.id === c.activeId) || null; }
function slug(s) {
  return String(s || "location").toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "location";
}
function uniqueId(c, label) {
  const base = slug(label); let id = base, n = 2;
  while (c.items.some(x => x.id === id)) id = base + "-" + n++;
  return id;
}
function requireSupported(c) {
  if (c && c.unsupported) throw new Error("Saved locations were created by a newer Local Suite version");
  if (c && c.invalid) throw new Error("Saved locations are damaged; restore a backup before editing them");
  return c;
}

const loc = {
  get() {
    const l = store.get("suite.location");
    return validLocation(l) ? cleanLocation(l) : null;
  },
  set(l) {
    if (!validLocation(l)) {
      throw new Error("Suite.location.set needs {lat, lon}");
    }
    const next = cleanLocation(l);
    const c = readLocations();
    const item = activeItem(c);
    if (c && item) {
      const moved = item.lat !== next.lat || item.lon !== next.lon;
      item.lat = next.lat; item.lon = next.lon;
      item.label = next.label;
      if (moved) item.revision++;
      if (!writeLocations(c)) return false;
      const mirrored = mirrorLocation(item);
      if (moved && mirrored) resetLocationState();
      return mirrored;
    }
    return store.set("suite.location", next);
  }
};

/* ---- first-run location, acquired once and shared ----
   The suite has always shared one location; what it never did was acquire the
   first one for you, so every tool cold-started into a "type a ZIP" card. This
   asks the browser once — no network request, so it works under every tool's
   generated CSP and from file:// — and hands the result to loc.set(), which is
   the same path the manual buttons already use. Off switch: suite.location.auto.
   A refusal is remembered so the prompt never appears twice. */
const AUTO_KEY = "suite.location.auto";
const AUTO_DENIED_KEY = "suite.location.autoDenied";
const GEO_TIMEOUT_MS = 10000;

Object.assign(loc, {
  autoEnabled() { return store.get(AUTO_KEY) !== "off"; },   /* absent = on */
  /* sentinel is non-numeric on purpose: store.get JSON-parses first, so "1"
     would come back as the number 1 and never match a string compare */
  autoDenied() { return store.get(AUTO_DENIED_KEY) === "denied"; },
  setAuto(on) {
    /* turning it back on is also how you take back a "Block" — otherwise a
       single misclick would be unrecoverable without the storage viewer */
    if (on) { store.remove(AUTO_DENIED_KEY); return store.remove(AUTO_KEY); }
    return store.set(AUTO_KEY, "off");
  },
  /* true when asking could actually get somewhere — used to stay silent rather
     than paint a "finding you…" state that can never resolve */
  autoPossible() {
    return !loc.get() && loc.autoEnabled() && !loc.autoDenied() &&
      typeof navigator !== "undefined" && !!navigator.geolocation;
  },
  auto() {
    const have = loc.get();
    if (have) return Promise.resolve(have);
    if (!loc.autoPossible()) return Promise.resolve(null);
    return new Promise(resolve => {
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      try {
        navigator.geolocation.getCurrentPosition(
          pos => {
            const lat = +pos.coords.latitude.toFixed(4);
            const lon = +pos.coords.longitude.toFixed(4);
            try {
              loc.set({ lat, lon, label: "My location (" + lat + ", " + lon + ")" });
            } catch (e) { return done(null); }
            /* resolve only on a write that actually stuck: a failed write (storage
               full, denied, private mode) must not report success, or autoBoot
               would reload into the same empty page forever */
            done(loc.get());
          },
          err => {
            if (!err || err.code !== 1) return done(null);   // 1 = PERMISSION_DENIED
            /* Remember only a refusal someone actually made. Automation, headless
               runs and enterprise policy all report the same code 1 while the
               permission state is still "prompt" — persisting that would switch
               the feature off for good for a user who was never asked. When the
               Permissions API can't say (older Safari rejects for geolocation),
               treat it as a real refusal: re-prompting on every load is worse. */
            let q = null;
            try {
              q = navigator.permissions && navigator.permissions.query({ name: "geolocation" });
            } catch (e) { q = null; }
            if (!q || typeof q.then !== "function") {
              store.set(AUTO_DENIED_KEY, "denied");
              return done(null);
            }
            q.then(
              s => { if (!s || s.state !== "prompt") store.set(AUTO_DENIED_KEY, "denied"); },
              () => { store.set(AUTO_DENIED_KEY, "denied"); }
            ).then(() => done(null), () => done(null));
          },
          { timeout: GEO_TIMEOUT_MS, maximumAge: 600000 }
        );
      } catch (e) { done(null); }
    });
  },
  /* Drop-in for a tool's boot: does nothing at all unless this is a genuine cold
     start, then reloads once the location lands. Reload rather than re-render
     because tools read the location in a dozen different shapes — several cache
     it at parse time — and on a cold start there is nothing on screen to lose:
     the page is showing its empty "set your location" card. Same move those
     tools already make on the cross-tab storage event.

     But not every tool blocks on a location — geo, elevation, recalls and the
     station pickers are usable straight away — so anything the user has typed
     cancels the reload. The location is saved and shared either way; only the
     free re-render is given up, and the next visit opens on it. */
  autoBoot() {
    if (!loc.autoPossible()) return Promise.resolve(null);
    let typed = false;
    const mark = () => { typed = true; };
    const watch = typeof document !== "undefined" && document.addEventListener;
    if (watch) {
      document.addEventListener("input", mark, true);
      document.addEventListener("change", mark, true);
    }
    const unwatch = () => {
      if (!watch) return;
      document.removeEventListener("input", mark, true);
      document.removeEventListener("change", mark, true);
    };
    return loc.auto().then(l => {
      unwatch();
      if (l && !typed && typeof window !== "undefined") window.location.reload();
      return l;
    }, () => { unwatch(); return null; });
  }
});

const locations = {
  /* Migration is explicit: only v3 entry points (hub/settings) call init().
     Older tools that merely read suite.location do not gain a surprise key. */
  init() {
    let c = readLocations();
    if (c && (c.unsupported || c.invalid)) return c;
    if (c && c.items.length) {
      const item = activeItem(c);
      if (item) mirrorLocation(item);
      return c;
    }
    if (c) store.remove(LOCATIONS_KEY);
    const legacy = loc.get();
    if (!legacy) return { schema: LOCATIONS_SCHEMA, activeId: null, items: [] };
    const item = Object.assign({ id: "saved-location", revision: 1 }, legacy);
    item.label = legacy.label;
    c = { schema: LOCATIONS_SCHEMA, activeId: item.id, items: [item] };
    writeLocations(c);
    return c;
  },
  all() { return locations.init().items.map(x => Object.assign({}, x)); },
  active() {
    const c = locations.init();
    if (c.unsupported || c.invalid) {
      const legacy = loc.get();
      return legacy ? Object.assign({ id: null, storageIssue: c.unsupported ? "newer" : "invalid" }, legacy) : null;
    }
    const item = activeItem(c);
    return item ? Object.assign({}, item) : null;
  },
  add(l) {
    if (!validLocation(l)) throw new Error("Suite.locations.add needs valid {lat, lon}");
    const c = requireSupported(locations.init());
    const label = String(l.label || "").trim() || "Saved location";
    const item = Object.assign({ id: uniqueId(c, label), label, revision: 1 }, cleanLocation(l));
    item.label = label;
    c.items.push(item);
    const becomesActive = !c.activeId;
    if (becomesActive) c.activeId = item.id;
    const collectionSaved = writeLocations(c);
    const mirrored = collectionSaved && (!becomesActive || mirrorLocation(item));
    let purged = 0;
    if (becomesActive && mirrored) purged = resetLocationState();
    return { location: Object.assign({}, item), purged, saved: !!mirrored };
  },
  update(id, changes) {
    const c = requireSupported(locations.init());
    const item = c.items.find(x => x.id === id);
    if (!item) throw new Error("Unknown saved location: " + id);
    const candidate = {
      lat: changes && changes.lat !== undefined ? changes.lat : item.lat,
      lon: changes && changes.lon !== undefined ? changes.lon : item.lon,
      label: changes && changes.label !== undefined ? changes.label : item.label
    };
    if (!validLocation(candidate)) throw new Error("Suite.locations.update needs valid coordinates");
    const moved = item.lat !== +candidate.lat || item.lon !== +candidate.lon;
    item.lat = +candidate.lat; item.lon = +candidate.lon;
    item.label = String(candidate.label || "").trim() || item.label || "Saved location";
    if (moved) item.revision++;
    const collectionSaved = writeLocations(c);
    let mirrored = collectionSaved;
    let purged = 0;
    if (collectionSaved && c.activeId === id) {
      mirrored = mirrorLocation(item);
      if (moved && mirrored) purged = resetLocationState();
    }
    return { location: Object.assign({}, item), purged, saved: !!mirrored };
  },
  activate(id) {
    const c = requireSupported(locations.init());
    const item = c.items.find(x => x.id === id);
    if (!item) throw new Error("Unknown saved location: " + id);
    const changed = c.activeId !== id;
    c.activeId = id;
    const saved = writeLocations(c);
    const mirrored = saved && mirrorLocation(item);
    return { location: Object.assign({}, item),
      purged: changed && mirrored ? resetLocationState() : 0, saved: !!mirrored };
  },
  remove(id) {
    const c = requireSupported(locations.init());
    const i = c.items.findIndex(x => x.id === id);
    if (i < 0) return { removed: false, active: locations.active(), purged: 0 };
    const wasActive = c.activeId === id;
    c.items.splice(i, 1);
    if (wasActive) c.activeId = c.items[0] ? c.items[0].id : null;
    const saved = c.items.length ? writeLocations(c) : store.remove(LOCATIONS_KEY);
    const next = activeItem(c);
    const mirrored = !wasActive || (saved && mirrorLocation(next));
    return { removed: true, active: next ? Object.assign({}, next) : null,
      purged: wasActive && mirrored ? resetLocationState() : 0, saved: !!(saved && mirrored) };
  }
};

/* ---- API keys: the suite.key.<name> convention (API-AND-RELAY.md §3) ----
   Officially published demo/public keys only — never a personal key. */
const DEMO_KEYS = {
  nasa: "DEMO_KEY",              // api.nasa.gov demo tier: 30/hr, 50/day
  usda: "DEMO_KEY",              // USDA FoodData Central demo tier
  bart: "MW9S-E7SL-26DU-VV8V"    // BART's officially published public key
};
function key(name) {
  const v = store.get("suite.key." + name);
  if (typeof v === "string" && v.trim()) return { value: v.trim(), isDemo: false };
  if (DEMO_KEYS[name]) return { value: DEMO_KEYS[name], isDemo: true };
  return { value: null, isDemo: false };
}

/* ---- favorites & recently used: suite-wide quick access (v4) ----
   suite.hub.favorites is an array of tool ids; suite.hub.recents is
   [{id, t}] newest-first, bounded. The per-tool chrome star is injected next
   to the theme button by theme.init() — every built page already calls it, so
   no tool needed new markup. The hub renders its own card stars plus the
   Favorites and Recently used sections; it is excluded here (and Settings is
   excluded from recents) so "recently used" stays about actual tools. */
const FAV_KEY = "suite.hub.favorites";
const RECENTS_KEY = "suite.hub.recents";
const RECENTS_MAX = 10;

function toolId() {
  try {
    const file = decodeURIComponent((location.pathname.split("/").pop() || ""));
    const m = file.match(/^([a-z][a-z0-9-]*)\.html$/);
    if (m) return m[1];
    /* a hosted scope root ("…/local-suite-4/") serves the hub */
    return /\/$/.test(location.pathname) ? "index" : null;
  } catch (e) { return null; }
}

const favorites = {
  all() {
    const v = store.get(FAV_KEY);
    return Array.isArray(v) ? v.filter(x => typeof x === "string" && x) : [];
  },
  has(id) { return favorites.all().includes(id); },
  /* returns the new state; a write that does not stick reports the old one */
  toggle(id) {
    if (typeof id !== "string" || !id) return false;
    const cur = favorites.all();
    const next = cur.includes(id) ? cur.filter(x => x !== id) : cur.concat(id);
    return store.set(FAV_KEY, next) ? next.includes(id) : cur.includes(id);
  }
};

const recents = {
  all() {
    const v = store.get(RECENTS_KEY);
    if (!Array.isArray(v)) return [];
    return v.filter(x => x && typeof x === "object" &&
      typeof x.id === "string" && x.id && isFinite(x.t)).slice(0, RECENTS_MAX);
  },
  record(id) {
    if (typeof id !== "string" || !id || id === "index" || id === "settings") return false;
    const next = [{ id, t: Date.now() }]
      .concat(recents.all().filter(x => x.id !== id)).slice(0, RECENTS_MAX);
    return store.set(RECENTS_KEY, next);
  },
  clear() { return store.remove(RECENTS_KEY); }
};

function paintFavButtons() {
  document.querySelectorAll(".fav-btn[data-tool]").forEach(btn => {
    const on = favorites.has(btn.dataset.tool);
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("on", on);
    btn.textContent = on ? "★" : "☆";
  });
}

/* Runs once from theme.init() on every page except the hub: notes the visit in
   recents and adds the chrome star beside the theme button. */
function initToolChrome() {
  const id = toolId();
  if (!id || id === "index") return;
  recents.record(id);
  const anchor = document.querySelector("#themeBtn, .theme-btn");
  if (!anchor || document.querySelector(".fav-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fav-btn";
  btn.dataset.tool = id;
  btn.title = "Favorite this tool";
  btn.setAttribute("aria-label", "Favorite this tool — favorites appear first on the suite hub");
  btn.addEventListener("click", () => { favorites.toggle(id); paintFavButtons(); });
  anchor.insertAdjacentElement("afterend", btn);
  paintFavButtons();
  window.addEventListener("storage", e => { if (e.key === FAV_KEY) paintFavButtons(); });
}

/* ---- optional power-user relay (API-AND-RELAY.md §6) ----
   Unset for everyone by default: tools use their link-out/embedded paths. */
function relay(url) {
  const base = store.get("suite.relay.url");
  if (typeof base !== "string" || !base.trim()) return null;
  const b = base.trim().replace(/\/$/, "");
  return b + (b.includes("?") ? "&" : "?") + "url=" + encodeURIComponent(url);
}

window.Suite = { theme, fetchJSON, store, esc, liveRegion, location: loc, locations,
  favorites, recents, key, relay };

/* ---- PWA registration (PWA.md §1) — inert from file://, forever ----
   The .catch keeps a failed registration from ever costing console noise on a
   page that works perfectly well without the service worker. */
if (location.protocol.startsWith("http") && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
})();
