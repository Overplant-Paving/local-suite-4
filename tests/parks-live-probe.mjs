/* Conservative live NPS contract probe (v4 release evidence).
   Reads the development key from ~/.config/local-suite/nps-api-key (mode 0600) and
   sends it ONLY as the X-Api-Key request header. The key is never printed, never
   written to evidence, never placed in a URL or argv. One request per documented
   resource (tiny limits), sequential with a polite delay; stops immediately on 429.
   Run from tests/:  node parks-live-probe.mjs                                    */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const KEY = readFileSync(join(homedir(), ".config", "local-suite", "nps-api-key"), "utf-8").trim();
if (!KEY) { console.error("no key available; probe skipped"); process.exit(2); }
const API = "https://developer.nps.gov/api/v1";
const PARK = "yell";
let activityId = "", topicId = "", galleryId = "";

/* one probe per documented resource — mirrors tools/parks.html ENDPOINTS */
const PROBES = [
  ["/activities", "?limit=1"],
  ["/activities/parks", () => activityId ? `?id=${encodeURIComponent(activityId)}&limit=1` : "?limit=1"],
  ["/alerts", `?parkCode=${PARK}&limit=1`],
  ["/amenities", "?limit=1"],
  ["/amenities/parksplaces", `?parkCode=${PARK}&limit=1`],
  ["/amenities/parksvisitorcenters", `?parkCode=${PARK}&limit=1`],
  ["/articles", `?parkCode=${PARK}&limit=1`],
  ["/campgrounds", `?parkCode=${PARK}&limit=1`],
  ["/events", `?parkCode=${PARK}&pageSize=1&pageNumber=1`],
  ["/feespasses", `?parkCode=${PARK}&limit=1`],
  ["/lessonplans", `?parkCode=${PARK}&limit=1`],
  ["/mapdata/parkboundaries/{sitecode}", "", `/mapdata/parkboundaries/${PARK}`],
  ["/multimedia/audio", `?parkCode=${PARK}&limit=1`],
  ["/multimedia/galleries", `?parkCode=${PARK}&limit=1`],
  ["/multimedia/galleries/assets", () => galleryId ? `?galleryId=${encodeURIComponent(galleryId)}&limit=1` : "?limit=1"],
  ["/multimedia/videos", `?parkCode=${PARK}&limit=1`],
  ["/newsreleases", `?parkCode=${PARK}&limit=1`],
  ["/parkinglots", `?parkCode=${PARK}&limit=1`],
  ["/parks", `?parkCode=${PARK}&limit=1`],
  ["/passportstamplocations", `?parkCode=${PARK}&limit=1`],
  ["/people", `?parkCode=${PARK}&limit=1`],
  ["/places", `?parkCode=${PARK}&limit=1`],
  ["/roadevents", `?parkCode=${PARK}`],
  ["/thingstodo", `?parkCode=${PARK}&limit=1`],
  ["/topics", "?limit=1"],
  ["/topics/parks", () => topicId ? `?id=${encodeURIComponent(topicId)}&limit=1` : "?limit=1"],
  ["/tours", `?parkCode=${PARK}&limit=1`],
  ["/visitorcenters", `?parkCode=${PARK}&limit=1`],
  ["/webcams", `?parkCode=${PARK}&limit=1`],
];

const lines = [];
const say = s => { lines.push(s); console.log(s); };
say("NPS live contract probe — " + new Date().toISOString());
say(`park=${PARK}, one request per resource, X-Api-Key header auth (key never printed)`);
say("");

let ok = 0, bad = 0;
for (const [doc, query, override] of PROBES) {
  const qs = typeof query === "function" ? query() : query;
  const path = override || doc;
  const url = API + path + qs;
  let line;
  try {
    const r = await fetch(url, { headers: { "X-Api-Key": KEY, "Accept": "application/json" } });
    if (r.status === 429) { say(`${doc}  HTTP 429 — stopping the probe immediately (rate limit)`); bad++; break; }
    let shape = "";
    if (r.ok) {
      const body = await r.json();
      const first = Array.isArray(body.data) ? body.data[0] : null;
      if (doc === "/activities") activityId = first && first.id || "";
      if (doc === "/topics") topicId = first && first.id || "";
      if (doc === "/multimedia/galleries") galleryId = first && first.id || "";
      if (Array.isArray(body.data)) shape = `envelope total=${body.total ?? "?"} data[${body.data.length}]`;
      else if (body.type === "FeatureCollection" || Array.isArray(body.features)) shape = `feature collection features[${(body.features || []).length}]`;
      else if (body.type === "Feature" || (body.geometry && body.properties !== undefined)) shape = `GeoJSON ${body.geometry?.type || "Feature"}`;
      else shape = "keys: " + Object.keys(body).slice(0, 5).join(",");
      ok++;
    } else bad++;
    const limit = r.headers.get("x-ratelimit-limit");
    const remaining = r.headers.get("x-ratelimit-remaining");
    const rate = limit || remaining ? `  rate=${remaining ?? "?"}/${limit ?? "?"}` : "";
    const dependency = doc === "/activities/parks" ? `  activityId=${activityId ? "present" : "absent"}`
      : doc === "/topics/parks" ? `  topicId=${topicId ? "present" : "absent"}`
      : doc === "/multimedia/galleries/assets" ? `  galleryId=${galleryId ? "present" : "absent"}`
      : "";
    line = `${doc}  HTTP ${r.status}${shape ? "  " + shape : ""}${dependency}${rate}`;
  } catch (e) {
    line = `${doc}  FETCH ERROR ${String(e && e.message || e).slice(0, 80)}`;
    bad++;
  }
  if (line.includes(KEY)) { console.error("redaction failure — aborting"); process.exit(3); }
  say(line);
  await new Promise(r => setTimeout(r, 350));
}
say("");
say(`probe summary: ${ok} healthy, ${bad} unhealthy of ${PROBES.length} documented resources`);
const out = resolve(import.meta.dirname, "evidence", "v4-release");
mkdirSync(out, { recursive: true });
const text = lines.join("\n") + "\n";
if (text.includes(KEY)) { console.error("redaction failure — evidence not written"); process.exit(3); }
writeFileSync(join(out, "nps-live-probe.txt"), text);
console.log("evidence: tests/evidence/v4-release/nps-live-probe.txt");
