/* Headed release visual pass: deterministic desktop/mobile evidence for the
   v4 hub, Flight weather map, all-category Parks surface, Arcade, Typing, and
   Budget. Also gates console/page/CSP errors and horizontal overflow. */
import {chromium} from "playwright";
import {pathToFileURL} from "node:url";
import {resolve,join} from "node:path";
import {mkdirSync,writeFileSync} from "node:fs";
import {fixture,routeWeather} from "./interactions/flight.mjs";
import {routeNps} from "./interactions/parks.mjs";

const ROOT=resolve(import.meta.dirname,"..");
const OUT=join(ROOT,"tests","evidence","v4-release","visual");
mkdirSync(OUT,{recursive:true});
const url=file=>pathToFileURL(join(ROOT,"dist",file)).href;
const lines=[],failures=[];
const check=(name,ok,detail="")=>{const line=(ok?"PASS ":"FAIL ")+name+(detail?" — "+detail:"");lines.push(line);console.log(line);if(!ok)failures.push(name)};
const browser=await chromium.launch({headless:false});

async function makePage(viewport={width:1280,height:900}){
 const context=await browser.newContext({viewport});
 await context.addInitScript(()=>{
  localStorage.setItem("suite.location.autoDenied",JSON.stringify("denied"));
  window.__visualCsp=[];
  document.addEventListener("securitypolicyviolation",e=>window.__visualCsp.push(e.violatedDirective+" "+e.blockedURI));
 });
 const page=await context.newPage(),issues=[];
 page.on("pageerror",e=>issues.push("pageerror: "+e.message));
 page.on("console",m=>{if(m.type()==="error")issues.push("console: "+m.text())});
 return{context,page,issues}
}
async function audit(page,issues,name){
 const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,csp:window.__visualCsp||[]}));
 check(name+" no horizontal overflow",!state.overflow);
 check(name+" no console/page errors",issues.length===0,issues.join(" | "));
 check(name+" no CSP violations",state.csp.length===0,state.csp.join(" | "))
}

/* Hub favorites + recents, both viewports. */
{
 const {context,page,issues}=await makePage();
 await page.addInitScript(()=>{
  localStorage.setItem("suite.theme","light");
  localStorage.setItem("suite.hub.favorites",JSON.stringify(["weather","parks","typing","arcade"]));
  localStorage.setItem("suite.hub.recents",JSON.stringify(["typing","flight","budget","arcade"].map((id,i)=>({id,t:Date.now()-i*60000}))));
 });
 await page.goto(url("index.html"));await page.waitForSelector("#favGrid .card");
 check("hub favorite cards visible",await page.locator("#favGrid .card").count()===4);
 check("hub recent chips visible",await page.locator("#recRow a").count()===4);
 await page.screenshot({path:join(OUT,"hub-desktop.png")});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(OUT,"hub-mobile.png")});
 await audit(page,issues,"hub desktop/mobile");await context.close()
}

/* Flight: position + precipitation + aviation panels. */
{
 const {context,page,issues}=await makePage();
 const date=new Date().toISOString().slice(0,10);
 await page.addInitScript(()=>localStorage.setItem("suite.key.aviationstack","visual-test-key"));
 await page.route(/api\.aviationstack\.com\/v1\/flights/,route=>{const body=fixture(date);body.data[0].live=null;return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)})});
 await page.route(/api\.airplanes\.live\/v2\/hex\//,route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ac:[{hex:"abc123",lat:39.125,lon:-103.55,alt_baro:35000,track:252,gs:465,seen:1}]})}));
 await routeWeather(page);
 await page.goto(url("flight.html")+"?flight=AA100&date="+date);
 await page.waitForFunction(()=>/Weather layer/.test(document.getElementById("wxStamp")?.textContent||""));
 check("flight weather map visible",await page.locator("#mapCard").isVisible()&&await page.locator("#map rect").count()>0);
 check("flight METAR panels visible",await page.locator("#wxPanels").isVisible()&&/Light Rain/.test(await page.locator("#depWx").innerText()));
 await page.screenshot({path:join(OUT,"flight-desktop.png")});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(OUT,"flight-mobile.png")});
 await audit(page,issues,"flight desktop/mobile");await context.close()
}

/* Parks: resource-specific visit data + requested GeoJSON map. */
{
 const {context,page,issues}=await makePage();
 const key="VISUAL-NPS-KEY-NOT-REAL-000000000000000";
 const track={requests:0,paths:new Set(),headers:[],queryLeak:false,queries:[]};
 await routeNps(page,track);
 await page.addInitScript(k=>{localStorage.setItem("suite.key.nps",k);localStorage.setItem("suite.parks.active","yell")},key);
 await page.goto(url("parks.html")+"?park=yell&tab=visit");
 await page.waitForFunction(()=>{const x=[...document.querySelectorAll(".resource-status")];return x.length&&x.every(e=>!e.classList.contains("loading-dot"))});
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:join(OUT,"parks-desktop.png")});
 await page.click('button[data-load-resource="boundary"]');
 await page.waitForSelector('.resource[data-resource="boundary"] svg');
 const text=(await page.locator("#content").innerText()).replace(/\s+/g," ");
 check("parks resource-specific facts visible",/250 reservable/.test(text)&&/5 minute estimated wait/.test(text)&&/Repeats daily/.test(text));
 check("parks GeoJSON visible and textual",/Polygon, MultiPolygon, LineString, Point GeoJSON/.test(text)&&/bounds/.test(text));
 await page.locator('.resource[data-resource="boundary"]').scrollIntoViewIfNeeded();
 await page.screenshot({path:join(OUT,"parks-geojson-desktop.png")});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(OUT,"parks-mobile.png")});
 await page.locator('.resource[data-resource="boundary"]').scrollIntoViewIfNeeded();
 await page.screenshot({path:join(OUT,"parks-geojson-mobile.png")});
 await audit(page,issues,"parks desktop/mobile");await context.close()
}

/* Arcade: decoded local art and responsive cards. */
{
 const {context,page,issues}=await makePage();
 await page.goto(url("arcade.html"));await page.waitForSelector(".game");
 const decoded=await page.evaluate(()=>[...document.querySelectorAll(".art img")].every(i=>i.complete&&i.naturalWidth>0));
 check("arcade seven cards and decoded art",await page.locator(".game").count()===7&&decoded);
 await page.screenshot({path:join(OUT,"arcade-desktop.png")});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(OUT,"arcade-mobile.png")});
 await audit(page,issues,"arcade desktop/mobile");await context.close()
}

/* Representative offline tools: active typing state and populated budget. */
{
 const {context,page,issues}=await makePage();
 await page.goto(url("typing.html"));
 const passage=await page.evaluate(()=>window.__typing.passage);
 await page.evaluate(()=>{window.__typing.elapsedOverride=1000});
 await page.fill("#typingInput","X"+passage.slice(1,46));
 await page.evaluate(()=>window.__typing.setElapsed(11000));
 check("typing active feedback visible",await page.locator("#prompt .wrong").count()===1&&Number(await page.locator("#wpm").innerText())>0);
 await page.screenshot({path:join(OUT,"typing-desktop.png")});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(OUT,"typing-mobile.png")});
 await audit(page,issues,"typing desktop/mobile");await context.close()
}
{
 const {context,page,issues}=await makePage();
 await page.goto(url("budget.html"));await page.fill("#inc1","4000");await page.fill("#inc2","1000");
 const amounts=[1600,900,350,150,100,250,300,250,400,350,100];
 for(let i=0;i<amounts.length;i++)await page.locator(".catrow").nth(i).locator(".c-amt").fill(String(amounts[i]));
 check("budget populated summary visible",(await page.locator("#statIncome").innerText())==="$5,000"&&(await page.locator("#verdict").innerText()).length>20);
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:join(OUT,"budget-desktop.png")});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(OUT,"budget-mobile.png")});
 await audit(page,issues,"budget desktop/mobile");await context.close()
}

await browser.close();
const report=[
 "Local Suite v4 headed visual verification — "+new Date().toISOString(),
 "Chromium was launched with headless:false.",
 ...lines,
 "",
 "screenshots: "+OUT,
 "result: "+(failures.length?failures.length+" failure(s)":"PASS")
].join("\n")+"\n";
writeFileSync(join(ROOT,"tests","evidence","v4-release","headed-visual-checks.txt"),report);
if(failures.length)process.exit(1);
