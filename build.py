#!/usr/bin/env python3
"""build.py — the entire Local Suite v4 toolchain. Python stdlib only (ADR D1).

Commands:
  python3 build.py            inline core into tools/*.html -> dist/; hub injection; CSP
  python3 build.py --check    validation gates + negative fixture tests; non-zero on failure
  python3 build.py --serve    build + http.server on 8000 (PWA mode)
  python3 build.py --new ID   scaffold tools/ID.html + manifest entry
  python3 build.py --refresh-data   fetch BLS numbers, embed into jobs/inflation (Batch C)
"""

import argparse
import base64
import hashlib
import json
import re
import sys
from pathlib import Path

# Windows consoles default to cp1252; gate output quotes tool source (arrows,
# em-dashes), which must never crash the check itself.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent
TOOLS_DIR = ROOT / "tools"
DIST_DIR = ROOT / "dist"
CORE_DIR = ROOT / "core"
MANIFEST = ROOT / "manifest" / "tools.json"
CATALOG = ROOT / "CATALOG.md"
FIXTURES = ROOT / "tests" / "fixtures"
ESC_ALLOWLIST = ROOT / "tests" / "escape-allowlist.json"

HUB = "index.html"

LINK_RE = re.compile(r'<link[^>]*data-suite-inline[^>]*>')
SCRIPT_TAG_RE = re.compile(r'<script[^>]*data-suite-inline[^>]*>\s*</script>')
VENDOR_SCRIPT_RE = re.compile(
    r'<script[^>]*src="\.\./assets/([^"]+)"[^>]*data-suite-vendor[^>]*>\s*</script>'
)
OPTICAL_WORKER_MARKER_RE = re.compile(
    r'/\* @suite:optical-worker \*/""/\* /@suite:optical-worker \*/'
)
ACOUSTIC_WORKER_MARKER_RE = re.compile(
    r'/\* @suite:acoustic-worker \*/""/\* /@suite:acoustic-worker \*/'
)
ACOUSTIC_WORKLET_DATA_MARKER_RE = re.compile(
    r'/\* @suite:acoustic-worklet-data-url \*/""/\* /@suite:acoustic-worklet-data-url \*/'
)
HUB_MARKER_RE = re.compile(r'/\* @suite:tools \*/.*?/\* /@suite:tools \*/', re.S)
SCRIPT_BODY_RE = re.compile(r'<script(?:\s[^>]*)?>(.*?)</script>', re.S)
VIEWPORT_RE = re.compile(r'<meta name="viewport"[^>]*>')
CSP_META_RE = re.compile(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)">')

NETWORK_CLASSES = ("offline", "cors-open", "keyed", "blocked")
RELEASE_TOOL_COUNT = 104  # v4.3.3: v4.3.2's 103 tools + the ChromaLink beta

# Per-tool CSP additions are deliberately limited to non-network browser schemes
# needed by self-contained local tools. Network hosts must remain visible in the
# manifest's endpoints/scriptEndpoints fields and the catalog cross-check.
CSP_EXTRA_ALLOW = {
    "scriptSrc": {"'wasm-unsafe-eval'", "data:"},
    "connectSrc": {"data:", "blob:"},
    "imgSrc": {"blob:"},
    "mediaSrc": {"blob:", "mediastream:"},
    "workerSrc": {"blob:"},
}

def read(p):
    return p.read_text(encoding="utf-8")

def write(p, text):
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)

def load_manifest():
    data = json.loads(read(MANIFEST))
    if data.get("schemaVersion") != 2:
        sys.exit(f"manifest schemaVersion must be 2, got {data.get('schemaVersion')}")
    return data

def host_of(url):
    m = re.match(r'(https?://[^/]+)', url)
    return m.group(1) if m else url

# ---------------------------------------------------------------- rendering

def sha256_b64(text):
    return base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode()

def build_csp(html, endpoints, script_endpoints=(), csp_extra=None):
    """Per-file CSP meta tag: sha256 hashes of every inline script + manifest hosts (ADR D6).
    script_endpoints: rare per-tool script-src host additions for JSONP sources (currently
    geo.html and flood.html, both for the Census geocoder, which is JSONP-only by the
    provider's design — a host source is far narrower than the documented unsafe-inline
    fallback)."""
    extra = csp_extra or {}
    unknown = sorted(set(extra) - set(CSP_EXTRA_ALLOW))
    if unknown:
        raise SystemExit(f"cspExtra has unsupported directive groups: {unknown}")
    for group, sources in extra.items():
        if not isinstance(sources, list) or any(not isinstance(s, str) for s in sources):
            raise SystemExit(f"cspExtra.{group} must be a list of source strings")
        disallowed = sorted(set(sources) - CSP_EXTRA_ALLOW[group])
        if disallowed:
            raise SystemExit(
                f"cspExtra.{group} may only use {sorted(CSP_EXTRA_ALLOW[group])}; "
                f"got {disallowed}"
            )
    hashes = [f"'sha256-{sha256_b64(body)}'" for body in SCRIPT_BODY_RE.findall(html)]
    script_src = " ".join(hashes + [host_of(e) for e in script_endpoints]
                          + extra.get("scriptSrc", []))
    hosts = list(dict.fromkeys(host_of(e) for e in endpoints))  # dedupe, keep order
    connect_sources = list(dict.fromkeys(hosts + extra.get("connectSrc", [])))
    connect = " ".join(connect_sources) if connect_sources else "'none'"
    # 'self' is required for the hosted PWA's same-origin manifest icons. Without it,
    # Chromium parses the manifest but rejects every install icon under the page CSP.
    img = " ".join(dict.fromkeys(["'self'", "data:"] + hosts + extra.get("imgSrc", [])))
    media_sources = list(dict.fromkeys(connect_sources + extra.get("mediaSrc", [])))
    media = " ".join(media_sources) if media_sources else "'none'"
    worker = " ".join(dict.fromkeys(["'self'"] + extra.get("workerSrc", [])))
    # worker-src/manifest-src 'self': lets the served (PWA) mode register sw.js and
    # fetch the webmanifest; both directives are inert from file:// (PWA.md §1).
    return ('<meta http-equiv="Content-Security-Policy" content="'
            f"default-src 'none'; script-src {script_src}; style-src 'unsafe-inline'; "
            f'img-src {img}; media-src {media}; connect-src {connect}; '
            f"worker-src {worker}; manifest-src 'self'\">")

ASSET_IMG_RE = re.compile(r'<img[^>]*\bdata-suite-asset\b[^>]*>')
ASSET_SRC_RE = re.compile(r'src="\.\./assets/([^"]+)"')
ASSET_MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
              ".webp": "image/webp", ".svg": "image/svg+xml"}

def inline_assets(name, html):
    """<img … src="../assets/X" … data-suite-asset> -> data: URI (dist stays one file).
    Source pages keep working from file:// through the relative path."""
    def repl(m):
        tag = m.group(0)
        sm = ASSET_SRC_RE.search(tag)
        if not sm:
            raise SystemExit(f"{name}: data-suite-asset img must use a ../assets/ src")
        rel = sm.group(1)
        p = ROOT / "assets" / rel
        mime = ASSET_MIME.get("." + rel.rsplit(".", 1)[-1].lower())
        if not p.exists() or not mime:
            raise SystemExit(f"{name}: missing or unsupported asset assets/{rel}")
        b64 = base64.b64encode(p.read_bytes()).decode()
        return (tag.replace(sm.group(0), f'src="data:{mime};base64,{b64}"')
                   .replace(" data-suite-asset", "", 1))
    return ASSET_IMG_RE.sub(repl, html)

def inline_vendor_scripts(name, html):
    """Inline explicitly marked local browser bundles into one-file output."""
    def repl(m):
        rel = m.group(1)
        p = ROOT / "assets" / rel
        if not p.exists() or p.suffix != ".js":
            raise SystemExit(f"{name}: missing or unsupported vendor script assets/{rel}")
        return "<script>\n" + read(p) + "\n</script>"
    return VENDOR_SCRIPT_RE.sub(repl, html)

def inline_optical_worker(name, html):
    """Embed the pinned ZXing worker and WASM in optical.html."""
    if not OPTICAL_WORKER_MARKER_RE.search(html):
        return html
    if name != "optical.html":
        raise SystemExit(f"{name}: optical worker marker is only valid in optical.html")
    worker_path = ROOT / "assets" / "optical" / "zxing-worker.js"
    wasm_path = ROOT / "assets" / "optical" / "zxing_reader.wasm"
    worker = read(worker_path)
    wasm_url = "data:application/wasm;base64," + base64.b64encode(wasm_path.read_bytes()).decode()
    worker, count = re.subn(
        r'var Vr=""\+new URL\("zxing_reader-[^"]+\.wasm",self\.location\.href\)\.href;',
        "var Vr=" + json.dumps(wasm_url, separators=(",", ":")) + ";",
        worker,
        count=1,
    )
    if count != 1:
        raise SystemExit("optical.html: pinned ZXing worker WASM locator changed")
    literal = json.dumps(worker, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return OPTICAL_WORKER_MARKER_RE.sub(
        lambda _m: "/* @suite:optical-worker */" + literal + "/* /@suite:optical-worker */",
        html,
        count=1,
    )

def inline_acoustic_runtime(name, html):
    """Embed the production modem Worker and exact AudioWorklet data URL in audio.html."""
    has_worker = ACOUSTIC_WORKER_MARKER_RE.search(html)
    has_worklet = ACOUSTIC_WORKLET_DATA_MARKER_RE.search(html)
    if not has_worker and not has_worklet:
        return html
    if name != "audio.html" or not has_worker or not has_worklet:
        raise SystemExit("audio.html must contain both acoustic runtime markers")
    core = read(ROOT / "assets" / "acoustic" / "app" / "modem-core.js")
    worker = read(ROOT / "assets" / "acoustic" / "app" / "modem-worker.js")
    import_line = 'importScripts("./modem-core.js");'
    if worker.count(import_line) != 1:
        raise SystemExit("audio.html: modem Worker core import changed")
    worker = core + "\n" + worker.replace(import_line, "", 1)
    worker_literal = json.dumps(
        worker, ensure_ascii=False, separators=(",", ":")
    ).replace("</", "<\\/")
    worklet = (
        ROOT / "assets" / "acoustic" / "worklet" / "audio-io.js"
    ).read_bytes()
    worklet_url = (
        "data:text/javascript;base64," + base64.b64encode(worklet).decode()
    )
    html = ACOUSTIC_WORKER_MARKER_RE.sub(
        lambda _m: "/* @suite:acoustic-worker */" + worker_literal +
        "/* /@suite:acoustic-worker */",
        html,
        count=1,
    )
    return ACOUSTIC_WORKLET_DATA_MARKER_RE.sub(
        lambda _m: "/* @suite:acoustic-worklet-data-url */" +
        json.dumps(worklet_url) + "/* /@suite:acoustic-worklet-data-url */",
        html,
        count=1,
    )

def render_tool(name, source, core_css, core_js, manifest_tools):
    """Source tool -> self-contained dist file: inline core, header comment, hub data, CSP."""
    if not LINK_RE.search(source) or not SCRIPT_TAG_RE.search(source):
        raise SystemExit(f"{name}: missing data-suite-inline marker(s) — cannot build")
    html = LINK_RE.sub(lambda m: "<style>\n" + core_css + "</style>", source, count=1)
    html = SCRIPT_TAG_RE.sub(lambda m: "<script>\n" + core_js + "</script>", html, count=1)
    html = inline_assets(name, html)
    html = inline_vendor_scripts(name, html)
    html = inline_optical_worker(name, html)
    html = inline_acoustic_runtime(name, html)

    if name == HUB:
        if not HUB_MARKER_RE.search(html):
            raise SystemExit(f"{name}: hub is missing the @suite:tools marker")
        tools_json = json.dumps(manifest_tools, ensure_ascii=False).replace("</", "<\\/")
        html = HUB_MARKER_RE.sub(
            lambda m: "/* @suite:tools */" + tools_json + "/* /@suite:tools */", html, count=1)

    # header comment right after the doctype line
    lines = html.split("\n", 1)
    header = f"<!-- GENERATED by build.py — edit tools/{name} -->"
    html = lines[0] + "\n" + header + ("\n" + lines[1] if len(lines) > 1 else "")

    entry = next((t for t in manifest_tools if t["file"] == name), None)
    endpoints = entry["endpoints"] if entry else []
    script_endpoints = entry.get("scriptEndpoints", []) if entry else []
    csp = build_csp(html, endpoints, script_endpoints,
                    entry.get("cspExtra", {}) if entry else None)
    if not VIEWPORT_RE.search(html):
        raise SystemExit(f"{name}: no viewport meta to anchor the CSP tag on")
    # the manifest link is dead weight from file:// (browsers only fetch a webmanifest
    # during http(s) installability checks) but makes every tool page install-capable
    html = VIEWPORT_RE.sub(lambda m: m.group(0) + "\n" + csp +
                           '\n<link rel="manifest" href="manifest.webmanifest">' +
                           '\n<link rel="icon" href="icons/icon-192.png" sizes="192x192">', html, count=1)
    return html

def render_all(manifest):
    core_css = read(CORE_DIR / "suite.css")
    core_js = read(CORE_DIR / "suite.js")
    tools = manifest["tools"]
    out = {}
    for name in [t["file"] for t in tools] + [HUB]:
        src_path = TOOLS_DIR / name
        if not src_path.exists():
            raise SystemExit(f"tools/{name} is in the manifest but does not exist")
        out[name] = render_tool(name, read(src_path), core_css, core_js, tools)
    return out

ICON_FILES = ("icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png")

WEBMANIFEST_NAME = "manifest.webmanifest"

SW_TEMPLATE = """/* GENERATED by build.py — Local Suite service worker (PWA.md).
   App shell cache-first; API calls are a network-only pass-through — the tools'
   own localStorage caching (visible "cached from <time>" stamps) is the single
   caching brain, never a second invisible layer. */
const CACHE = %(cache)s;
const PRECACHE = %(precache)s;

self.addEventListener("install", (e) => {
  // Sequential, revalidating precache. cache: "no-cache" keeps a host's max-age
  // (GitHub Pages: 600s) from precaching stale bytes on update; one-at-a-time is
  // gentler than addAll's 76-way burst, whose install was observed to fail against
  // a single-threaded host during Phase 3 verification.
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    for (const u of PRECACHE) {
      const r = await fetch(new Request(u, { cache: "no-cache" }));
      if (!r.ok) throw new Error(u + " -> HTTP " + r.status);
      await c.put(u, r);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys
      // CacheStorage is origin-wide, while GitHub Pages hosts supported Local
      // Suite releases at separate paths/scopes on that origin. Only clean up
      // this release's obsolete caches; v3 owns its suite-v3-* namespace.
      .filter((k) => /^suite-v4-/.test(k) && k !== CACHE)
      .map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  // a navigation to the scope root is the hub
  const req = url.pathname.endsWith("/") ? "index.html" : e.request;
  e.respondWith(caches.match(req, { ignoreSearch: true })
    .then((hit) => hit || fetch(e.request)));
});
"""

def render_pwa(rendered):
    """manifest.webmanifest + sw.js, both derived from the build (PWA.md §2).
    Returns (webmanifest_text, sw_text, precache_list, cache_name)."""
    webmanifest = json.dumps({
        "name": "Local Suite",
        "short_name": "Local Suite",
        "description": "Small, calm, self-contained tools. No accounts, no tracking.",
        "start_url": "index.html",
        "display": "standalone",
        "background_color": "#f5f3ee",
        "theme_color": "#2f6f6a",
        "icons": [
            {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "icons/icon-maskable-512.png", "sizes": "512x512",
             "type": "image/png", "purpose": "maskable"},
        ],
    }, ensure_ascii=False, indent=2) + "\n"
    precache = sorted(rendered) + [WEBMANIFEST_NAME] + list(ICON_FILES)
    h = hashlib.sha256()
    for name in precache:
        if name == WEBMANIFEST_NAME:
            h.update(webmanifest.encode("utf-8"))
        elif name in ICON_FILES:
            h.update((CORE_DIR / "icons" / name.split("/")[1]).read_bytes())
        else:
            h.update(rendered[name].encode("utf-8"))
    cache_name = f"suite-v4-{h.hexdigest()[:12]}"
    sw = SW_TEMPLATE % {"cache": json.dumps(cache_name),
                        "precache": json.dumps(precache, indent=2)}
    return webmanifest, sw, precache, cache_name

def cmd_build(_args):
    manifest = load_manifest()
    rendered = render_all(manifest)
    for name, html in sorted(rendered.items()):
        write(DIST_DIR / name, html)
        print(f"built dist/{name} ({len(html.encode('utf-8'))} bytes)")
    webmanifest, sw, precache, cache_name = render_pwa(rendered)
    write(DIST_DIR / WEBMANIFEST_NAME, webmanifest)
    write(DIST_DIR / "sw.js", sw)
    for rel in ICON_FILES:
        (DIST_DIR / rel).parent.mkdir(parents=True, exist_ok=True)
        (DIST_DIR / rel).write_bytes((CORE_DIR / "icons" / rel.split("/")[1]).read_bytes())
    print(f"pwa: sw.js ({cache_name}, {len(precache)} precached) + "
          f"{WEBMANIFEST_NAME} + {len(ICON_FILES)} icons")
    print(f"{len(rendered)} file(s) built.")

# ---------------------------------------------------------------- gates
# Pure functions over explicit inputs so the negative fixture tests can feed
# them broken trees. Each returns a list of problem strings; empty = pass.

def gate_manifest_files_sync(tools, tool_file_names):
    problems = []
    seen_files = set()
    seen_ids = set()
    for t in tools:
        f = t.get("file", "")
        tool_id = t.get("id", "")
        if f in seen_files:
            problems.append(f"duplicate manifest entry for {f}")
        seen_files.add(f)
        if tool_id in seen_ids:
            problems.append(f"duplicate manifest id {tool_id!r}")
        seen_ids.add(tool_id)
        if tool_id != Path(f).stem:
            problems.append(f"{f}: manifest id {tool_id!r} must match file stem {Path(f).stem!r}")
        if f not in tool_file_names:
            problems.append(f"manifest lists {f} but tools/{f} does not exist")
        if t.get("network") not in NETWORK_CLASSES:
            problems.append(f"{f}: network must be one of {NETWORK_CLASSES}")
    for f in sorted(tool_file_names):
        if f != HUB and f not in seen_files:
            problems.append(f"tools/{f} exists but has no manifest entry")
    return problems

def gate_release_tool_count(tools):
    """The current release contract is exactly RELEASE_TOOL_COUNT distinct tool identities."""
    count = len(tools)
    ids = [t.get("id") for t in tools]
    distinct = len(set(ids))
    problems = []
    if count != RELEASE_TOOL_COUNT:
        problems.append(
            f"manifest must contain exactly {RELEASE_TOOL_COUNT} tools for this release; "
            f"found {count}"
        )
    if distinct != RELEASE_TOOL_COUNT:
        problems.append(
            f"manifest must contain exactly {RELEASE_TOOL_COUNT} distinct tool ids for this "
            f"release; found {distinct}"
        )
    return problems

def gate_source_text_integrity(sources):
    """HTML parsing replaces NUL/control bytes before CSP hashing.
    Reject them in source so the build hash and browser-parsed script cannot diverge."""
    problems = []
    for name, text in sorted(sources.items()):
        for i, char in enumerate(text):
            if ord(char) < 32 and char not in "\t\n\r":
                problems.append(
                    f"{name}: disallowed control byte U+{ord(char):04X} at character {i}"
                )
                break
    return problems

def gate_markers(sources):
    problems = []
    for name, text in sorted(sources.items()):
        if not LINK_RE.search(text):
            problems.append(f"{name}: missing the data-suite-inline stylesheet link")
        if not SCRIPT_TAG_RE.search(text):
            problems.append(f"{name}: missing the data-suite-inline script tag")
        if name == HUB and not HUB_MARKER_RE.search(text):
            problems.append(f"{name}: missing the @suite:tools marker")
    return problems

def gate_dist_staleness(rendered, dist_dir):
    problems = []
    for name, html in sorted(rendered.items()):
        p = dist_dir / name
        if not p.exists():
            problems.append(f"dist/{name} missing — run: python build.py")
        elif p.read_bytes() != html.encode("utf-8"):
            problems.append(f"dist/{name} is stale (or was edited by hand) — run: python build.py")
    for p in sorted(dist_dir.glob("*.html")):
        if p.name not in rendered:
            problems.append(f"dist/{p.name} has no source in tools/ — remove it")
    return problems

def gate_no_inline_handlers(dist_texts):
    problems = []
    handler_re = re.compile(r'<[a-zA-Z][^>]*\son\w+\s*=')
    for name, text in sorted(dist_texts.items()):
        markup = SCRIPT_BODY_RE.sub("<script></script>", text)
        for m in handler_re.finditer(markup):
            snippet = m.group(0)[-60:].replace("\n", " ")
            problems.append(f"{name}: inline event handler in markup: …{snippet}")
    return problems

def gate_csp(dist_texts, manifest_tools):
    problems = []
    for name, text in sorted(dist_texts.items()):
        m = CSP_META_RE.search(text)
        if not m:
            problems.append(f"{name}: no Content-Security-Policy meta tag")
            continue
        declared = set(re.findall(r"'sha256-([^']+)'", m.group(1)))
        actual = {sha256_b64(body) for body in SCRIPT_BODY_RE.findall(text)}
        if declared != actual:
            problems.append(f"{name}: CSP script hashes do not match actual script contents")
    return problems

def _template_exprs(js, start):
    """From js[start] == '`', walk the template literal (nested templates included).
    Returns (list of ${...} expression strings, index after the closing backtick)."""
    exprs = []
    i = start + 1
    depth = 0        # ${ } nesting
    tmpl_depth = 1   # backtick nesting
    expr_start = None
    while i < len(js) and tmpl_depth > 0:
        c = js[i]
        if c == "\\":
            i += 2
            continue
        if depth == 0:
            if c == "`":
                tmpl_depth -= 1
                if tmpl_depth == 0:
                    break
            elif c == "$" and i + 1 < len(js) and js[i+1] == "{":
                depth = 1
                expr_start = i + 2
                i += 1
        else:
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0 and expr_start is not None:
                    exprs.append(js[expr_start:i].strip())
                    expr_start = None
            elif c == "`":
                # nested template inside the expression: recurse to collect its exprs
                inner, j = _template_exprs(js, i)
                exprs.extend(inner)
                i = j
        i += 1
    return exprs, i

def gate_escaping_heuristic(source_texts, allowlist):
    """Advisory: template-literal interpolation into innerHTML without Suite.esc()."""
    flags = {}
    for name, text in sorted(source_texts.items()):
        allowed = set(allowlist.get(name, {}).keys())
        for body in SCRIPT_BODY_RE.findall(text):
            for m in re.finditer(r'\.innerHTML\s*\+?=', body):
                rhs = body[m.end():].lstrip()
                if rhs[:1] in ('"', "'"):
                    continue  # plain string literal (e.g. innerHTML = "") — not a template
                tick = body.find("`", m.end())
                if tick == -1 or tick - m.end() > 200:
                    continue
                if ";" in body[m.end():tick]:
                    continue  # the backtick belongs to a later statement
                exprs, _ = _template_exprs(body, tick)
                for e in exprs:
                    if "esc(" in e:      # Suite.esc( or a local esc = Suite.esc alias
                        continue
                    if e in allowed:
                        continue
                    flags[f"{name}: unescaped interpolation into innerHTML: ${{{e}}}"] = True
    return list(flags)

def gate_catalog_crosscheck(tools, catalog_text):
    problems = []
    for t in tools:
        for e in t.get("endpoints", []):
            host = host_of(e).split("//", 1)[-1]
            if host not in catalog_text:
                problems.append(f"{t['file']}: endpoint host {host} not mentioned in CATALOG.md")
    return problems

SIGNUP_RE = re.compile(r'signup:\s*"([^"]+)"')

def gate_settings_signup_sync(sources, tools):
    """Advisory: settings.html is the single key-setup UI (API-AND-RELAY.md §3), so every
    signup URL the manifest declares must actually be offered there. Extra URLs in the tool
    are fine — the guided setup groups providers behind one gateway signup (api.data.gov)
    that no single tool owns."""
    text = sources.get("settings.html", "")
    if not text:
        return []
    offered = set(SIGNUP_RE.findall(text))
    problems = []
    for t in tools:
        k = t.get("key") or {}
        url = k.get("signup")
        if url and url not in offered:
            problems.append(f"settings.html: manifest signup for '{k['name']}' is not offered: {url}")
    return sorted(set(problems))

KEY_PATTERNS = [
    re.compile(r'(?i)api[_-]?key["\']?\s*[:=]\s*["\'][A-Za-z0-9_\-]{16,}["\']'),
    re.compile(r'(?i)(?:^|[^A-Za-z0-9])[sp]k-[A-Za-z0-9]{20,}'),
    re.compile(r'AIza[0-9A-Za-z_\-]{30,}'),
    re.compile(r'(?i)bearer\s+[A-Za-z0-9_\-.]{25,}'),
]
KEY_ALLOWLIST = ("DEMO_KEY", "MW9S-E7SL-26DU-VV8V")  # documented public demo keys

def gate_no_example_urls(dist_texts):
    """Phase 2 exit gate: the v1 placeholder pattern (your-worker.example.workers.dev
    and friends) must never reach dist — those tools get embedded data or link-outs."""
    problems = []
    for name, text in sorted(dist_texts.items()):
        for m in re.finditer(r'https?://[^\s"\'<>]*\.example\b[^\s"\'<>]*', text, re.I):
            problems.append(f"{name}: placeholder URL: {m.group(0)!r}")
    return problems

def gate_pwa_sync(dist_sw_text, dist_webmanifest_text,
                  expected_sw_text, expected_webmanifest_text):
    """dist/sw.js and dist/manifest.webmanifest must exactly match a fresh render —
    covers precache-list drift, cache-name hash drift, and hand-edited artifacts."""
    problems = []
    if dist_sw_text is None:
        problems.append("dist/sw.js is missing — rebuild")
    elif dist_sw_text != expected_sw_text:
        problems.append("dist/sw.js does not match a fresh render (precache/cache-name drift) — rebuild")
    if dist_webmanifest_text is None:
        problems.append(f"dist/{WEBMANIFEST_NAME} is missing — rebuild")
    elif dist_webmanifest_text != expected_webmanifest_text:
        problems.append(f"dist/{WEBMANIFEST_NAME} does not match a fresh render — rebuild")
    return problems

def gate_key_hygiene(source_texts):
    problems = []
    for name, text in sorted(source_texts.items()):
        for pat in KEY_PATTERNS:
            for m in pat.finditer(text):
                if any(a in m.group(0) for a in KEY_ALLOWLIST):
                    continue
                problems.append(f"{name}: possible committed key: {m.group(0)[:60]!r}")
    return problems

# ---------------------------------------------------------------- --check

def load_escape_allowlist():
    if ESC_ALLOWLIST.exists():
        return json.loads(read(ESC_ALLOWLIST))
    return {}

def negative_tests():
    """Every fatal gate must be seen to fail on a broken fixture (QUALITY.md §3).
    Returns a list of failure strings; empty = all negatives fired correctly."""
    failures = []
    def expect(gate_name, problems):
        if not problems:
            failures.append(f"negative test for {gate_name} did NOT fire — gate assumed broken")

    fx = {p.name: read(p) for p in FIXTURES.glob("*.html")}

    expect("manifest-files-sync", gate_manifest_files_sync(
        [{"file": "ghost.html", "network": "offline"}], set()))
    expect("release-tool-count-under", gate_release_tool_count(
        [{"id": f"tool-{i}", "file": f"tool-{i}.html"} for i in range(RELEASE_TOOL_COUNT - 1)]))
    expect("release-tool-count-over", gate_release_tool_count(
        [{"id": f"tool-{i}", "file": f"tool-{i}.html"} for i in range(RELEASE_TOOL_COUNT + 1)]))
    duplicate_ids = [
        {"id": f"tool-{i}", "file": f"tool-{i}.html"}
        for i in range(RELEASE_TOOL_COUNT)
    ]
    duplicate_ids[-1]["id"] = duplicate_ids[0]["id"]
    expect("release-tool-count-duplicate-id", gate_release_tool_count(duplicate_ids))
    expect("manifest-duplicate-id", gate_manifest_files_sync([
        {"id": "same", "file": "one.html", "network": "offline"},
        {"id": "same", "file": "two.html", "network": "offline"},
    ], {"one.html", "two.html"}))
    expect("manifest-id-file-mismatch", gate_manifest_files_sync([
        {"id": "wrong", "file": "right.html", "network": "offline"},
    ], {"right.html"}))
    expect("source-text-integrity-core-js", gate_source_text_integrity(
        {"core/suite.js": "const sentinel = '\x00';"}))
    expect("source-text-integrity-core-css", gate_source_text_integrity(
        {"core/suite.css": "body::before{content:'\x00'}"}))
    expect("markers", gate_markers({"missing-marker.html": fx["missing-marker.html"]}))
    expect("dist-staleness", gate_dist_staleness(
        {"stale.html": "freshly rendered content"}, FIXTURES / "stale-dist"))
    expect("no-inline-handlers", gate_no_inline_handlers(
        {"inline-handler.html": fx["inline-handler.html"]}))
    expect("csp", gate_csp({"csp-mismatch.html": fx["csp-mismatch.html"]}, []))
    try:
        build_csp("<script></script>", [], [], {"workerSrc": ["https://evil.example"]})
    except SystemExit:
        pass
    else:
        failures.append("negative test for cspExtra allowlist did NOT reject a network host")
    expect("escaping-heuristic", gate_escaping_heuristic(
        {"escape-miss.html": fx["escape-miss.html"]}, {}))
    expect("key-hygiene", gate_key_hygiene({"key-leak.html": fx["key-leak.html"]}))
    expect("no-example-urls", gate_no_example_urls(
        {"example-url.html": '<a href="https://my-relay.example/?url=x">broken</a>'}))
    expect("pwa-sync", gate_pwa_sync(
        'const CACHE = "suite-v2-stale0stale0";\nconst PRECACHE = ["ghost.html"];',
        '{"name": "Wrong"}',
        'const CACHE = "suite-v2-abc123abc123";\nconst PRECACHE = ["index.html"];',
        '{"name": "Local Suite"}'))
    return failures

def cmd_check(_args):
    manifest = load_manifest()
    tools = manifest["tools"]
    tool_files = {p.name for p in TOOLS_DIR.glob("*.html")}
    sources = {p.name: read(p) for p in TOOLS_DIR.glob("*.html")}
    integrity_sources = {
        **sources,
        "core/suite.js": read(CORE_DIR / "suite.js"),
        "core/suite.css": read(CORE_DIR / "suite.css"),
    }
    rendered = render_all(manifest)
    dist_texts = {p.name: read(p) for p in DIST_DIR.glob("*.html")}
    catalog_text = read(CATALOG) if CATALOG.exists() else ""
    core_texts = {("core/" + p.name): read(p) for p in CORE_DIR.glob("*.*")}
    expected_webmanifest, expected_sw, _, _ = render_pwa(rendered)

    gates = [
        ("release-tool-count",   True,  gate_release_tool_count(tools)),
        ("source-text-integrity", True, gate_source_text_integrity(integrity_sources)),
        ("manifest-files-sync", True,  gate_manifest_files_sync(tools, tool_files)),
        ("markers",             True,  gate_markers(sources)),
        ("dist-staleness",      True,  gate_dist_staleness(rendered, DIST_DIR)),
        ("no-inline-handlers",  True,  gate_no_inline_handlers(dist_texts)),
        ("csp",                 True,  gate_csp(dist_texts, tools)),
        ("escaping-heuristic",  False, gate_escaping_heuristic(sources, load_escape_allowlist())),
        ("catalog-crosscheck",  False, gate_catalog_crosscheck(tools, catalog_text)),
        ("settings-signup-sync", False, gate_settings_signup_sync(sources, tools)),
        ("key-hygiene",         True,  gate_key_hygiene({**sources, **core_texts})),
        ("no-example-urls",     True,  gate_no_example_urls(dist_texts)),
        ("pwa-sync",            True,  gate_pwa_sync(
            read(DIST_DIR / "sw.js") if (DIST_DIR / "sw.js").exists() else None,
            read(DIST_DIR / WEBMANIFEST_NAME) if (DIST_DIR / WEBMANIFEST_NAME).exists() else None,
            expected_sw, expected_webmanifest)),
    ]

    failed = warned = 0
    for name, fatal, problems in gates:
        if problems:
            tag = "FAIL" if fatal else "WARN"
            print(f"GATE {name:<20} {tag} ({len(problems)})")
            for p in problems:
                print(f"  - {p}")
            if fatal:
                failed += 1
            else:
                warned += 1
        else:
            print(f"GATE {name:<20} pass")

    neg = negative_tests()
    if neg:
        print(f"NEGATIVE TESTS          FAIL ({len(neg)})")
        for p in neg:
            print(f"  - {p}")
        failed += 1
    else:
        print("NEGATIVE TESTS          pass (all fatal gates seen to fail on fixtures)")

    # burn-down counts from the manifest (MIGRATION.md §6)
    by_net = {}
    for t in tools:
        by_net[t["network"]] = by_net.get(t["network"], 0) + 1
    flagged = sum(1 for t in tools if t.get("flags"))
    migrated = sum(1 for t in tools if t.get("since") == "v1")
    suite_native = len(tools) - migrated
    print(f"\nmanifest: {len(tools)} tools + hub  "
          f"({migrated} v1 migrations, {suite_native} suite-native)  "
          f"by network: {by_net or '{}'}  flagged: {flagged}")

    if failed:
        print(f"\n--check: {failed} fatal gate group(s) failing")
        sys.exit(1)
    print(f"\n--check: all fatal gates green" + (f" ({warned} advisory warning group(s))" if warned else ""))

# ---------------------------------------------------------------- --new / --serve

NEW_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{name} · Local Suite</title>
<link rel="stylesheet" href="../core/suite.css" data-suite-inline>
<style>
  body {{ padding: 1.6rem 1.25rem 4rem; }}
  .wrap {{ max-width: 720px; margin: 0 auto; }}
  header h1 {{ font-size: 1.7rem; letter-spacing: -.02em; margin-top: .5rem; }}
  header .tag {{ color: var(--muted); margin-top: .3rem; }}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <a class="back" href="index.html">← suite</a>
    <button class="theme-btn" id="themeBtn" title="Toggle light/dark">◐ theme</button>
    <h1>{name}</h1>
    <p class="tag">What this tool does, in one calm sentence.</p>
  </header>

  <footer>No network — everything happens on your machine.</footer>
</div>
<script src="../core/suite.js" data-suite-inline></script>
<script>
"use strict";
Suite.theme.init();
</script>
</body>
</html>
"""

def cmd_new(args):
    tool_id = args.new
    if not re.fullmatch(r"[a-z][a-z0-9-]*", tool_id):
        sys.exit("--new ID must be lowercase letters/digits/hyphens")
    path = TOOLS_DIR / f"{tool_id}.html"
    if path.exists():
        sys.exit(f"tools/{tool_id}.html already exists")
    manifest = load_manifest()
    if any(t["id"] == tool_id for t in manifest["tools"]):
        sys.exit(f"manifest already has an entry with id {tool_id}")
    name = tool_id.replace("-", " ").title()
    write(path, NEW_TEMPLATE.format(name=name))
    manifest["tools"].append({
        "id": tool_id, "file": f"{tool_id}.html", "name": name,
        "cat": "util", "cx": "S", "desc": "What this tool does, in one calm sentence.",
        "network": "offline", "key": None, "endpoints": [], "storage": ["suite.theme"],
        "cacheTtlMin": None, "since": "v3", "flags": [],
    })
    write(MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(f"scaffolded tools/{tool_id}.html and added the manifest entry — "
          "edit both, then: python build.py")

def cmd_serve(_args):
    cmd_build(_args)
    import functools
    from http.server import HTTPServer, SimpleHTTPRequestHandler
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(DIST_DIR))
    print("serving dist/ at http://localhost:8000 — Ctrl+C to stop")
    HTTPServer(("127.0.0.1", 8000), handler).serve_forever()

BLS_MARKER_RE = re.compile(r'/\* @suite:bls \*/(.*?)/\* /@suite:bls \*/', re.S)
BLS_API = "https://api.bls.gov/publicAPI/v1/timeseries/data/"

def _bls_num(s):
    # preserve the source's integer/decimal formatting so an unchanged month
    # round-trips byte-identical
    v = float(s)
    return int(v) if v.is_integer() and "." not in s else v

def _bls_series_slots(obj):
    """Yield (series_id, start, setter) for both marker shapes:
    jobs:      {"asOf","start","series":{"<ID>":[...]}}
    inflation: {"asOf","series":{"<name>":{"id","start","values":[...]}}}"""
    for key, val in obj["series"].items():
        if isinstance(val, list):
            yield key, obj["start"], (lambda vs, k=key, o=obj: o["series"].__setitem__(k, vs))
        else:
            yield val["id"], val["start"], (lambda vs, v=val: v.__setitem__("values", vs))

def cmd_refresh_data(_args):
    import datetime
    import urllib.request

    carriers = []          # (path, src, raw_json, obj)
    for path in sorted(TOOLS_DIR.glob("*.html")):
        src = read(path)
        m = BLS_MARKER_RE.search(src)
        if not m:
            continue
        try:
            obj = json.loads(m.group(1))
        except json.JSONDecodeError as e:
            sys.exit(f"{path.name}: @suite:bls marker is not valid JSON: {e}")
        carriers.append((path, src, m.group(1), obj))
    if not carriers:
        sys.exit("no @suite:bls markers found under tools/")

    all_ids, min_year = [], 9999
    for _, _, _, obj in carriers:
        for sid, start, _ in _bls_series_slots(obj):
            if sid not in all_ids:
                all_ids.append(sid)
            min_year = min(min_year, int(start[:4]))
    print(f"refreshing {len(all_ids)} BLS series for "
          f"{', '.join(p.name for p, _, _, _ in carriers)}")

    body = json.dumps({"seriesid": all_ids, "startyear": str(min_year),
                       "endyear": str(datetime.date.today().year)}).encode()
    req = urllib.request.Request(BLS_API, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read().decode("utf-8"))
    if resp.get("status") != "REQUEST_SUCCEEDED":
        sys.exit(f"BLS API refused: status={resp.get('status')} "
                 f"messages={resp.get('message')}")

    fetched = {}           # id -> {"YYYY-MM": number}
    for s in resp["Results"]["series"]:
        months = {}
        for d in s.get("data", []):
            if not d["period"].startswith("M") or d["period"] == "M13":
                continue   # skip annual averages
            if d["value"] in ("-", ""):
                continue
            months[f"{d['year']}-{d['period'][1:]}"] = _bls_num(d["value"])
        fetched[s["seriesID"]] = months
    missing = [i for i in all_ids if not fetched.get(i)]
    if missing:
        sys.exit(f"BLS returned no data for: {missing}")

    def month_range(start, end):
        y, mo = int(start[:4]), int(start[5:])
        while f"{y:04d}-{mo:02d}" <= end:
            yield f"{y:04d}-{mo:02d}"
            mo += 1
            if mo == 13:
                y, mo = y + 1, 1

    changed = 0
    for path, src, raw, obj in carriers:
        # asOf = latest month any of this tool's series actually reported
        as_of = max(max(fetched[sid]) for sid, _, _ in _bls_series_slots(obj))
        obj["asOf"] = as_of
        for sid, start, setter in _bls_series_slots(obj):
            setter([fetched[sid].get(mo) for mo in month_range(start, as_of)])
        new_raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
        if new_raw == raw:
            print(f"  {path.name}: unchanged (asOf {as_of})")
            continue
        write(path, src.replace(f"/* @suite:bls */{raw}/* /@suite:bls */",
                                f"/* @suite:bls */{new_raw}/* /@suite:bls */"))
        changed += 1
        print(f"  {path.name}: updated (asOf {as_of})")

    if changed:
        cmd_build(_args)
    else:
        print("all markers current — dist not rebuilt")

# ---------------------------------------------------------------- main

def main():
    p = argparse.ArgumentParser(description="Local Suite v4 toolchain")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--check", action="store_true", help="run validation gates")
    g.add_argument("--serve", action="store_true", help="build + serve on :8000")
    g.add_argument("--new", metavar="ID", help="scaffold a new tool")
    g.add_argument("--refresh-data", action="store_true",
                   help="fetch + embed monthly BLS data")
    args = p.parse_args()

    if args.check:
        cmd_check(args)
    elif args.serve:
        cmd_serve(args)
    elif args.new:
        cmd_new(args)
    elif args.refresh_data:
        cmd_refresh_data(args)
    else:
        cmd_build(args)

if __name__ == "__main__":
    main()
