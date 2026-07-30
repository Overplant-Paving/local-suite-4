/* Built National Parks Explorer integration: file://, generated CSP, deep links, and 29 endpoints. */
import {chromium} from "playwright";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {routeNps} from "./interactions/parks.mjs";
const ROOT=resolve(import.meta.dirname,"..");
const KEY="TEST-NPS-KEY-NOT-REAL-0000000000000000";
let browser;try{browser=await chromium.launch({channel:"chrome"})}catch(e){if(!String(e).includes("distribution 'chrome' is not found"))throw e;browser=await chromium.launch()}
const context=await browser.newContext({viewport:{width:1100,height:850}}),page=await context.newPage();
const issues=[];page.on("console",m=>{if(m.type()==="error")issues.push(m.text())});page.on("pageerror",e=>issues.push(String(e)));
const track={requests:0,paths:new Set(),headers:[],queryLeak:false,galleryAssetQuery:null,unsafeFiltered:false};await routeNps(page,track);
await page.addInitScript(k=>{localStorage.setItem("suite.key.nps",k);localStorage.setItem("suite.parks.active","yell")},KEY);
await page.goto(pathToFileURL(resolve(ROOT,"dist","parks.html")).href+"?park=yell&tab=reference");
await page.waitForSelector('.park-hero h2:has-text("Yellowstone")');
async function settled(){await page.waitForFunction(()=>{const xs=[...document.querySelectorAll('.resource-status')];return xs.length&&xs.every(x=>!x.classList.contains('loading-dot'))},{timeout:30000})}
await settled();let galleryPickerOptions=0;
for(const tab of ["alerts","visit","explore","learn","media","reference"]){await page.click(`.tab[data-tab="${tab}"]`);await settled();if(tab==="visit"){const buttons=page.locator('button[data-load-resource]');for(let i=(await buttons.count())-1;i>=0;i--)await buttons.nth(i).click();await settled()}if(tab==="media")galleryPickerOptions=await page.locator('select[aria-label="Choose a gallery for assets"] option').count()}
await page.click('.tab[data-tab="reference"]');await settled();
const result=await page.evaluate(key=>({title:document.title,park:document.querySelector('.park-hero h2')?.textContent,healthRows:document.querySelectorAll('.health-row').length,healthOk:document.querySelectorAll('.health-state.ok').length,nativeSectionButtons:document.querySelector('.tab[data-tab="reference"]')?.getAttribute('aria-pressed')==='true'&&!document.querySelector('#tabs')?.hasAttribute('role'),nativeParkButtons:document.querySelector('.options .opt')?.tagName==='BUTTON'&&!document.querySelector('.options')?.hasAttribute('role'),cspAllowsApi:document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content.includes('https://developer.nps.gov'),cspAllowsImages:document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content.includes('https://www.nps.gov'),keyVisible:document.body.innerText.includes(key),horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}),KEY);
Object.assign(result,{galleryPickerOptions,endpointCount:track.paths.size,allHeaderAuth:track.headers.every(v=>v===KEY),queryLeak:track.queryLeak,galleryScoped:track.galleryAssetQuery?.galleryId==="G1"&&track.galleryAssetQuery?.parkCode===null,consoleIssues:issues});

/* A failed request must stop the sequential tab queue. Otherwise one invalid key
   or exhausted hourly allowance can fan out across every unopened resource. */
async function failureScenario(kind){
 const c=await browser.newContext({viewport:{width:1000,height:760}}),p=await c.newPage();
 const t={requests:0,paths:new Set(),headers:[],queryLeak:false,fail:path=>path==="/campgrounds"?(kind==="auth"?{status:403}:{status:429,headers:{"retry-after":"120","x-ratelimit-limit":"1000","x-ratelimit-remaining":"87"}}):null};
 await routeNps(p,t);await p.addInitScript(k=>{localStorage.setItem("suite.key.nps",k);localStorage.setItem("suite.parks.active","yell")},KEY);
 await p.goto(pathToFileURL(resolve(ROOT,"dist","parks.html")).href+"?park=yell&tab=visit");
 if(kind==="auth")await p.waitForSelector('#app h2:has-text("That NPS key did not work")');
 else{
  await p.waitForFunction(()=>[...document.querySelectorAll(".resource-status")].filter(x=>x.textContent.includes("rate limit")).length>=7);
  const before=t.requests;await p.click('.tab[data-tab="explore"]');await p.waitForFunction(()=>document.querySelector('.resource[data-resource="things"] .resource-status')?.textContent.includes("rate limit"));
  if(t.requests!==before)throw new Error("rate cooldown allowed a new request after tab switch");
  await p.click('.tab[data-tab="reference"]');await p.waitForFunction(()=>document.querySelector(".quota-note"));
  const note=await p.locator(".endpoint-health").innerText();
  if(!note.includes("87 remaining of 1000")||!note.includes("cooldown is active"))throw new Error("rate headers/cooldown not visible: "+note);
 }
 const out={requests:t.requests,paths:[...t.paths].sort(),keyVisible:(await p.locator("body").innerText()).includes(KEY)};
 await c.close();return out
}
result.authSuppression=await failureScenario("auth");
result.rateSuppression=await failureScenario("rate");
console.log(JSON.stringify(result,null,2));
await browser.close();
if(result.park!=="Yellowstone National Park"||result.healthRows!==29||result.healthOk!==29||!result.nativeSectionButtons||!result.nativeParkButtons||result.galleryPickerOptions!==2||result.endpointCount!==29||!result.allHeaderAuth||result.queryLeak||!result.galleryScoped||!result.cspAllowsApi||!result.cspAllowsImages||result.keyVisible||result.horizontalOverflow||issues.length||result.authSuppression.requests!==3||result.rateSuppression.requests!==3||result.authSuppression.keyVisible||result.rateSuppression.keyVisible||result.authSuppression.paths.join(",")!=="/campgrounds,/parks"||result.rateSuppression.paths.join(",")!=="/campgrounds,/parks")process.exit(1);
