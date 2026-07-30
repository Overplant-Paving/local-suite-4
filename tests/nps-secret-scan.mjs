/* Byte-for-byte NPS development-key absence gate.
   The protected key is read into memory only: never printed, passed in argv,
   written to evidence, or placed in browser storage. */
import {readFileSync, readdirSync, statSync, writeFileSync, mkdirSync} from "node:fs";
import {homedir} from "node:os";
import {join, resolve, relative} from "node:path";

const ROOT=resolve(import.meta.dirname,"..");
const keyPath=join(homedir(),".config","local-suite","nps-api-key");
const mode=statSync(keyPath).mode&0o777;
if(mode!==0o600)throw new Error("NPS key file mode must be 0600; found "+mode.toString(8));
const key=Buffer.from(readFileSync(keyPath,"utf8").trim());
if(!key.length)throw new Error("NPS key file is empty");
const skip=new Set([".git","node_modules"]);
const hits=[];
let files=0,bytes=0;
function walk(dir){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(skip.has(entry.name))continue;
  const path=join(dir,entry.name);
  if(entry.isSymbolicLink())continue;
  if(entry.isDirectory())walk(path);
  else if(entry.isFile()){
   const body=readFileSync(path);files++;bytes+=body.length;
   if(body.indexOf(key)!==-1)hits.push(relative(ROOT,path));
  }
 }
}
walk(ROOT);
const report=[
 "NPS exact-secret byte scan — "+new Date().toISOString(),
 "protected key file mode: 0600",
 "repository files scanned: "+files,
 "repository bytes scanned: "+bytes,
 "exact key occurrences: "+hits.length,
 "result: "+(hits.length?"FAIL (paths intentionally withheld)":"PASS — protected key bytes absent")
].join("\n")+"\n";
const out=join(ROOT,"tests","evidence","v4-release");
mkdirSync(out,{recursive:true});
writeFileSync(join(out,"nps-secret-scan.txt"),report);
console.log(report);
if(hits.length)process.exit(1);
