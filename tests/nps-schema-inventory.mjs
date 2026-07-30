/* Live, quota-free NPS documentation inventory gate.
   Compares every GET path in the official Swagger document with the page's
   ENDPOINTS registry. No API key is read or sent. */
import {readFileSync, writeFileSync, mkdirSync} from "node:fs";
import {resolve, join} from "node:path";

const ROOT=resolve(import.meta.dirname,"..");
const SOURCE=readFileSync(join(ROOT,"tools","parks.html"),"utf8");
const match=SOURCE.match(/const ENDPOINTS=(\[[^;]+\]);/);
if(!match)throw new Error("tools/parks.html ENDPOINTS registry not found");
const appPaths=JSON.parse(match[1]).sort();
const schemaUrl="https://www.nps.gov/subjects/developer/customcf/swagger.json?03142019";
const response=await fetch(schemaUrl,{headers:{"Accept":"application/json"}});
if(!response.ok)throw new Error("official NPS Swagger request failed: HTTP "+response.status);
const schema=await response.json();
const official=Object.entries(schema.paths||{})
  .filter(([,methods])=>methods&&typeof methods.get==="object")
  .map(([path])=>path)
  .sort();
const added=official.filter(x=>!appPaths.includes(x));
const removed=appPaths.filter(x=>!official.includes(x));
const report=[
  "NPS official Swagger inventory — "+new Date().toISOString(),
  "source: "+schemaUrl,
  "basePath: "+schema.basePath,
  "official GET paths: "+official.length,
  "application registry paths: "+appPaths.length,
  "added upstream: "+(added.join(", ")||"none"),
  "missing upstream / stale in app: "+(removed.join(", ")||"none"),
  "exact match: "+String(!added.length&&!removed.length),
  "",
  ...official
].join("\n")+"\n";
const ev=join(ROOT,"tests","evidence","v4-release");
mkdirSync(ev,{recursive:true});
writeFileSync(join(ev,"nps-schema-inventory.txt"),report);
console.log(report);
if(schema.basePath!=="/api/v1"||added.length||removed.length)process.exit(1);
