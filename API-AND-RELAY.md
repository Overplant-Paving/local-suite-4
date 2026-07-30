# API-AND-RELAY.md — data source strategy

Everything network. `CATALOG.md` remains the human-readable per-tool endpoint narrative with CORS
verification dates; this doc is **policy**. The manifest
(`manifest/tools.json`) is machine truth for endpoints per tool.

## 1. Source policy — keyless-first ranking

When choosing or replacing a data source, prefer in this order:

1. **Keyless + CORS-open** (works from `file://`) — the healthy majority: NWS, USGS, NOAA
   (CO-OPS/SWPC/NCEI), Treasury FiscalData, openFDA, CDC Socrata, Federal Register, Open-Meteo,
   Frankfurter, Wikipedia/Wiktionary, Open Library, restcountries, Zippopotam, OSM/Overpass,
   wheretheiss.at, JPL SSD, CelesTrak, NIFC ArcGIS, USDA AWDB, iNaturalist.
2. **Keyless but CORS-blocked** → bundled at build time via the embedded-data pipeline (§4):
   aviationweather.gov, BLS. (NDBC stays descoped — Open-Meteo covers marine.)
3. **Free personal key** (provider signup, stored in `suite.key.*`): Congress.gov, EIA, NPS, Finnhub, eBird,
   NASA (above demo tier), Aviationstack (flight tracker; small personal free tier).
4. **Demo tier** (works keyless with low limits): NASA `DEMO_KEY` (30/hr, 50/day), USDA FDC.

Never: paid APIs, APIs requiring OAuth, sources that demand tracking.

## 2. Good-citizen rules (carried from v1 CATALOG, now enforceable)

- **Cache everything** in `localStorage` with the `{t, v}` envelope via `Suite.fetchJSON`'s
  `cacheKey`/`ttl` options. Default TTLs by source class, declared per tool in the manifest
  (`cacheTtlMin`): weather 10 min · quakes 5 min · daily stats (CPI, treasury, APOD) 24 h ·
  reference data (factbook, zip) 7 d.
- **Identify yourself** where asked: `application=local-suite` (NOAA CO-OPS), `email=` params.
  Never set a custom `User-Agent` header from JS (CORS preflight forbids it).
- **Serve stale on failure**: `Suite.fetchJSON` falls back to cache with a visible
  "Offline — cached from <time>" card. Stale data must say *when* it's from, never pretend.
- **Back off on 429/403**: rate-limited tools double their TTL on throttle responses and surface
  a "source is rate-limiting, showing cached data" note.

### Rate-limit registry

| Source | Limit | Used by | Handling |
|---|---|---|---|
| Launch Library 2 (thespacedevs) | 15 req/hr | launches | long TTL (≥30 min) + backoff |
| CoinGecko free | ~30/min soft | markets | daily-snapshot TTL |
| NASA `DEMO_KEY` | 30/hr, 50/day | apod, (nutrition via USDA demo) | 24 h TTL + "add your free key" nudge |
| Overpass public | fair-use | nearby | long TTL + kumi.systems mirror fallback |
| Nominatim | 1 req/s | geo | client-side throttle |
| National Park Service | 1,000 req/rolling hr | parks | `X-Api-Key` header; 30 d lightweight directory + separate 2 h selected detail; tab-lazy sequential endpoint groups; standard and Events pagination; 401/403 queue suppression; 429 cooldown/header display; large boundary GeoJSON only loads on demand |
| ipapi.co | 1k/day | network | cache IP info per session |
| Aviationstack free | 100/month | flight | 1 min cache; automatic refresh defaults off, stops on rate limit, and has an 80-request local monthly safety threshold |
| Airplanes.live | 1 req/s documented | flight position fallback, overhead | flight: one Aviationstack-resolved ICAO24 per lookup; overhead: one point query per manual refresh, auto-refresh ≥30 s and paused on hidden tabs |
| NWS api.weather.gov (aviation surfaces) | fair-use | flight weather map, tropical, discussion | METARs 10 min TTL, SIGMETs 10 min, products 60 min; each panel shows its own stale stamp |
| Open-Meteo | fair-use free tier | flight weather grid, weatherhistory (+ existing marine/air/normals) | one multi-point request per refresh (32 points), 5 min TTL; history cached 24 h |
| USAspending.gov | fair-use, keyless | spending | 24 h TTL per agency/state view |
| Datamuse | 100k/day keyless | rhymes | 7 d per-query cache |
| Crossref | polite fair-use | cite | 7 d per-DOI cache; no user email is ever attached |
| Google/Cloudflare DoH | fair-use | dns | 10 min per-query cache; two resolvers queried only on explicit lookup |
| Internet Archive availability API | fair-use | wayback | 24 h per-URL cache |
| World Bank API | fair-use, keyless | worldbank | 7 d per-indicator cache |
| NASA Image Library | fair-use, keyless | nasaimages | 24 h per-search cache |

## 3. Key management

- One convention: `localStorage["suite.key.<name>"]` — names: `nasa`, `congress`, `eia`, `nps`,
  `finnhub`, `ebird`, `usda`, `bart`, `aviationstack`.
- `Suite.key(name)` returns `{value, isDemo}`; tools render a one-line "using the shared demo key —
  [get your free key]" note when on a demo tier, with the signup URL from the manifest.
- **settings.html is the current single entry UI** for keys. Individual tools link there for setup;
  any retained local key prompt is a deliberate tool-specific fallback, not the primary flow.

### Guided setup — what can and cannot be automated

Signup itself **cannot** be automated and no future change should try. Every provider gates its form
with a captcha (api.data.gov runs reCAPTCHA v2 *and* v3) and requires the user to accept its own
terms; the api.data.gov embed additionally pulls scripts from `api.data.gov` and `google.com`, which
the no-runtime-dependency contract and the generated CSP both forbid. The suite opens the form and
takes the key back — it never poses as the user. flight.html has said this in as many words since
v3: "Local Suite cannot create or accept a third-party account on your behalf."

Everything around the signup is automated instead:

- **One key, three providers.** NASA, Congress.gov and USDA FoodData sit behind the same
  api.data.gov gateway — all three answer `via: api-umbrella` and accept the universal `DEMO_KEY`
  (verified 2026-07-25), and api.data.gov's developer manual states a key "gives you access to all
  APIs from agencies participating in api.data.gov's service". So the wizard's first step is the
  gateway, not a tool, and one signup fills three `suite.key.*` rows. **EIA and the Park Service run
  their own API Umbrella instances** — same software, hence the same `DEMO_KEY` and the same
  `API_KEY_INVALID` body, but separate registration and separate keys. Do not fold them into the
  api.data.gov step.
- **Nothing is assumed.** A sibling row is filled only after that provider's own endpoint has
  accepted the key. If api.data.gov ever splits its key space, the feature degrades to filling one
  row and says so, rather than writing a key that does not work.
- **Paste routing.** Keys arrive in an email or on a dashboard, so a paste anywhere on the page is
  scanned: key shape narrows the field, provider wording in the surrounding text usually settles it,
  and when it does not the live check decides. A paste landing in a real input is left alone.
- **`suite.profile.email|first|last`** exists only to save retyping into signup forms. The page
  never transmits it. It is in backups like everything else, and the card says so.
- **Live key check.** One minimal request per click, `cache: "no-store"`, distinguishing accepted /
  rejected / rate-limited / unreachable. Verified 2026-07-25: every provider returns 401 or 403 with
  a machine-readable body for a bad key, so "rejected" is never inferred from a network failure.
  This is why settings.html is `"network": "keyed"` in the manifest with the nine provider hosts as
  its endpoints — the generated CSP has to allow the check. It makes no request until clicked.
- **Aviationstack spends real allowance** (100 requests/month), so its test arms on the first click
  and fires on a confirming second, counting into the same `suite.flight.usage` ledger the Flight
  Tracker keeps. BART is absent from the wizard: it ships a published public key and needs no signup.
- **Keys are never committed.** The `--check` gate greps source for key-shaped strings; the only
  allowed embedded key is BART's officially published public demo key, and v2 externalizes even
  that (v1 `transit.html:163` → `suite.key.bart` with the public value as the documented default).
- Prefer provider-supported authentication headers over URL query parameters. The NPS explorer
  sends `suite.key.nps` as `X-Api-Key`; NPS `file://` preflight permits that header. This avoids
  exposing the credential in request URLs while preserving direct-browser operation.

## 4. CORS-blocked sources — the embedded-data pipeline (no relay, no extra infrastructure)

Some excellent sources send no CORS headers, so a browser page cannot fetch them:
**aviationweather.gov** (METARs/TAFs), **api.bls.gov** (CPI, unemployment), **NDBC** buoy text
feeds, and many agency GTFS feeds. v1 shipped the affected tools with
`https://your-worker.example.workers.dev/` placeholders — they failed silently out of the box.

v2 policy — keep it simple:

- **Monthly data gets embedded at build time.** `build.py --refresh-data` fetches BLS from the
  terminal (CORS only restricts browsers) and injects the latest CPI and jobs numbers into those
  two tools, labeled with their reference month. Same philosophy as password.html's embedded EFF
  wordlist. Rebuild monthly — or let a one-line scheduled GitHub Action do it.
- **Minute-by-minute data gets a link-out.** airport.html shows a clean card explaining that
  aviationweather.gov blocks browser scripts, with a direct link to its METAR/TAF page for your
  airport — the *website* works fine, only the API is blocked. A custom transit feed likewise
  links to the agency's own departure board.
- That's it. No proxy, no snapshots, no data infrastructure.

## 5. Remediation list — the 4 broken v1 tools

| Tool | v1 state | v2 change (Batch C) |
|---|---|---|
| airport.html | fetches aviationweather.gov through a `.example` placeholder → silent failure | link-out card to aviationweather.gov's own METAR/TAF page — honest, useful, zero setup |
| jobs.html | BLS through `https://my-relay.example/?url=` placeholder | embedded monthly numbers via `--refresh-data` — works with zero network |
| inflation.html | same BLS placeholder | same mechanism (CPI headline + core); shares plumbing with jobs.html |
| transit.html | hardcoded BART demo key + `https://your-agency.example/departures.json` custom feed | BART key → `suite.key.bart` (BART's API is CORS-open — works out of the box); custom feed → link-out to the agency's departure board |

## 6. Optional personal relay (power users only — nothing depends on it)

`relay/worker.js` stays in the repo as a ~40-line Cloudflare Worker template (strict host
allowlist) for anyone who wants live in-page METARs or a custom transit feed. `Suite.relay(url)`
reads `localStorage["suite.relay.url"]`; unset — the default for everyone — the tools use their
link-out/embedded paths. No tool requires it.

## 7. Manifest ↔ CATALOG contract

- **Manifest** (machine truth): endpoint hosts, network class, key requirements, TTLs. Generates
  hub, CSP `connect-src`, SW rules.
- **CATALOG.md** (prose truth): full endpoint URLs with parameters, CORS verification dates, API
  gotchas (NCEI `units=standard`, AWDB station-filter bug, USGS legacy water API sunset ~Q1 2027…),
  alternatives considered.
- `build.py --check` warns when a manifest endpoint host doesn't appear anywhere in CATALOG.md —
  the nudge to keep the prose current. Touch the CATALOG verification date whenever an endpoint
  changes (release checklist, QUALITY.md §5).
