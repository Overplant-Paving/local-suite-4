/* Comprehensive National Parks Explorer verification.
   Every documented NPS API v1 resource is route-fulfilled with deterministic data. */
export const selectors=["body",".topbar",".back",".theme-btn","header h1","header .tag",".card-msg","button.primary","footer"];
export const screenshotAfterInteract=true;
const FAKE_KEY="TEST-NPS-KEY-NOT-REAL-0000000000000000";
const svg="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='500'%3E%3Crect width='1200' height='500' fill='%23245d3c'/%3E%3Cpath d='M0 430L260 170l160 160 180-240 260 300 150-170 190 210v70H0z' fill='%2381c99a'/%3E%3C/svg%3E";
const PARKS=[
 {id:"P1",url:"https://www.nps.gov/yell/",fullName:"Yellowstone National Park",parkCode:"yell",name:"Yellowstone",states:"ID,MT,WY",designation:"National Park",description:"The world's first national park protects geysers, wildlife, lakes, and mountain landscapes.",latitude:"44.59824417",longitude:"-110.5471695",activities:[{id:"A1",name:"Hiking"},{id:"A2",name:"Wildlife Watching"}],topics:[{id:"T1",name:"Geology"}],contacts:{phoneNumbers:[{phoneNumber:"307-344-7381"}],emailAddresses:[{emailAddress:"yell_information@nps.gov"}]},operatingHours:[{description:"The park is open every day, though roads and services vary by season."}],addresses:[{line1:"2 Officers Row",city:"Yellowstone National Park",stateCode:"WY",postalCode:"82190"}],images:[{url:svg,altText:"Stylized mountain landscape"}],weatherInfo:"Conditions change quickly at high elevation.",directionsInfo:"Five entrances connect the park to surrounding communities.",directionsUrl:"https://www.nps.gov/yell/planyourvisit/directions.htm"},
 {id:"P2",url:"https://www.nps.gov/yose/",fullName:"Yosemite National Park",parkCode:"yose",name:"Yosemite",states:"CA",designation:"National Park",description:"Granite cliffs, waterfalls, giant sequoias, and high-country wilderness.",activities:[{id:"A1",name:"Hiking"}],topics:[{id:"T2",name:"Forests"}],contacts:{},operatingHours:[],addresses:[],images:[]}
];
const D={
 "/activities":[{id:"A1",name:"Hiking"},{id:"A2",name:"Wildlife Watching"}],
 "/activities/parks":[{id:"A1",name:"Hiking",parks:[{parkCode:"yell",fullName:"Yellowstone National Park",states:"ID,MT,WY"}]}],
 "/alerts":[{id:"AL1",url:"https://www.nps.gov/yell/planyourvisit/conditions.htm",title:"Thermal area boardwalk closure",parkCode:"yell",description:"A section of boardwalk is closed for repairs.",category:"Park Closure"}],
 "/amenities":[{id:"AM1",name:"Restrooms",categories:["Convenience"]}],
 "/articles":[{id:"AR1",url:"https://www.nps.gov/articles/yellowstone-geology.htm",title:"A landscape shaped by fire and ice",listingDescription:"Learn how geology formed the Yellowstone landscape."},{id:"AR2",url:"javascript:alert(1)",title:"Unsafe URL fixture",listingDescription:"This deterministic record verifies protocol filtering.",listingImage:{url:"javascript:alert(2)"}}],
 "/campgrounds":[{id:"C1",url:"https://www.nps.gov/yell/planyourvisit/campgrounds.htm",name:"Madison Campground",parkCode:"yell",description:"A centrally located seasonal campground.",reservationUrl:"https://www.recreation.gov/",totalSites:"278",numberOfSitesReservable:"250",numberOfSitesFirstComeFirstServe:"28",reservationInfo:"Reserve up to six months ahead.",accessibility:{additionalInfo:"Accessible sites and restrooms are available."}}],
 "/events":[{id:"E1",url:"https://www.nps.gov/planyourvisit/event-details.htm",title:"Ranger-led geyser walk",description:"Explore the Upper Geyser Basin with a ranger.",dateStart:"2026-07-20T09:00:00-06:00",dateEnd:"2026-07-20T10:30:00-06:00",location:"Old Faithful Inn porch",recurrenceDescription:"Repeats daily through August.",tags:["Ranger program","Geysers"]}],
 "/lessonplans":[{id:"L1",url:"https://www.nps.gov/teachers/classrooms/yellowstone.htm",title:"Yellowstone ecosystems",questionObjective:"Students examine relationships in a protected ecosystem.",gradeLevel:"Upper Elementary",subject:"Science",duration:"60 minutes"}],
 "/multimedia/audio":[{id:"AU1",permalinkUrl:"https://www.nps.gov/media/audio.htm",title:"Sounds of Yellowstone",description:"Listen to wildlife and geothermal soundscapes.",durationMs:90000}],
 "/multimedia/galleries":[{id:"G1",url:"https://www.nps.gov/media/photo/gallery.htm",title:"Yellowstone seasons",description:"Scenes from winter through fall.",assetCount:12},{id:"G2",url:"https://www.nps.gov/media/photo/gallery.htm",title:"Wildlife gallery",description:"Bison, elk, bears, and wolves.",assetCount:8}],
 "/multimedia/galleries/assets":[{id:"GA1",permalinkUrl:"https://www.nps.gov/media/photo/view.htm",title:"Bison in winter",description:"A bison crosses a snowy basin.",altText:"Bison walking through snow",downloadUrl:"https://www.nps.gov/common/uploads/bison.jpg"}],
 "/multimedia/videos":[{id:"V1",permalinkUrl:"https://www.nps.gov/media/video/view.htm",title:"Inside Yellowstone",description:"An introduction to visiting responsibly.",durationMs:180000,hasOpenCaptions:true,streamUrl:"https://www.nps.gov/media/video/stream.mp4"}],
 "/newsreleases":[{id:"N1",url:"https://www.nps.gov/yell/learn/news/example.htm",title:"Summer visitor services update",abstract:"Seasonal services are opening across the park.",releaseDate:"2026-07-15"}],
 "/parkinglots":[{id:"PK1",name:"Old Faithful parking",description:"Large paved visitor parking area.",liveStatus:{isActive:true,estimatedWaitTimeInMinutes:5},accessibility:"Eight signed accessible spaces.",latitude:"44.4599",longitude:"-110.8312"}],
 "/passportstamplocations":[{id:"PS1",label:"Old Faithful Visitor Education Center",parks:[{parkCode:"yell",fullName:"Yellowstone National Park"}],type:"Visitor Center",latitude:"44.4605",longitude:"-110.8281"}],
 "/people":[{id:"PE1",url:"https://www.nps.gov/people/example.htm",title:"Horace Albright",listingDescription:"A leader in the early National Park Service."}],
 "/places":[{id:"PL1",url:"https://www.nps.gov/places/old-faithful.htm",title:"Old Faithful Geyser",listingDescription:"One of the park's best-known geysers.",isOpenToPublic:true}],
 "/thingstodo":[{id:"TD1",url:"https://www.nps.gov/thingstodo/geyser-basin.htm",title:"Walk a geyser basin",shortDescription:"Stay on boardwalks while exploring thermal features.",isReservationRequired:false,activities:[{name:"Hiking"}],durationDescription:"1–2 hours",locationDescription:"Upper Geyser Basin",accessibilityInformation:"Boardwalk route has accessible segments."}],
 "/topics":[{id:"T1",name:"Geology"},{id:"T2",name:"Forests"}],
 "/topics/parks":[{id:"T1",name:"Geology",parks:[{parkCode:"yell",fullName:"Yellowstone National Park"}]}],
 "/tours":[{id:"TO1",title:"Fort Yellowstone walking tour",description:"A self-guided tour of historic buildings.",type:"Self-guided",durationMin:45,durationMax:60,durationUnit:"minutes",stops:[{title:"Historic guardhouse"},{title:"Parade ground"}],geometry:{type:"LineString",coordinates:[[-110.42,44.97],[-110.41,44.98]]}}],
 "/visitorcenters":[{id:"VC1",url:"https://www.nps.gov/yell/planyourvisit/visitorcenters.htm",name:"Old Faithful Visitor Education Center",parkCode:"yell",description:"Exhibits, trip planning, and ranger information.",contacts:{phoneNumbers:[{phoneNumber:"307-344-2751"}],emailAddresses:[{emailAddress:"visitor@example.test"}]},operatingHours:[{description:"Open daily 9 a.m.–5 p.m."}],directionsInfo:"Beside the Old Faithful parking area.",accessibility:{additionalInfo:"Ramps, tactile exhibits, and accessible restrooms."}}],
 "/webcams":[{id:"W1",url:"https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm",title:"Old Faithful live webcam",description:"Live view of the Upper Geyser Basin.",status:"Active",isStreaming:true}]
};
const FEES={parkCode:"yell",isFeeFreePark:false,isInteragencyPassAccepted:true,cashless:false,entranceFeeDescription:"Entrance passes cover private and commercial vehicles.",fees:[{title:"Private vehicle",description:"Seven-day entrance",cost:"35.00"}],passes:[{title:"Yellowstone annual pass",description:"Valid for one year",cost:"70.00"}]};
const AMENITY_PLACES=[[{id:"AM1",name:"Restrooms",parks:[{parkCode:"yell",fullName:"Yellowstone National Park",places:[{id:"APL1",title:"Old Faithful",description:"Restrooms near the visitor center."}]}]}]];
const AMENITY_CENTERS=[[{id:"AM1",name:"Restrooms",parks:[{parkCode:"yell",fullName:"Yellowstone National Park",visitorcenters:[{id:"AVC1",name:"Old Faithful Visitor Education Center",description:"Accessible restrooms."}]}]}]];
/* Deliberately exceed one practical page for both pagination dialects. */
D["/articles"]=D["/articles"].concat(Array.from({length:27},(_,i)=>({id:"AR"+(i+3),url:"https://www.nps.gov/articles/page-"+(i+2)+".htm",title:"Article page marker "+(i+2),listingDescription:"Paginated learning record "+(i+2)+"."})));
D["/events"]=D["/events"].concat(Array.from({length:22},(_,i)=>({id:"E"+(i+2),title:"Event page marker "+(i+2),description:"Paginated event record.",dateStart:"2026-08-01T09:00:00-06:00",location:"Test location"})));
function env(data,total=data.length,start=0,limit=100){return{total:String(total),limit:String(limit),start:String(start),data}}
function bodyFor(path,u){
 if(path==="/parks"){const code=u&&u.searchParams.get("parkCode");const rows=code?PARKS.filter(p=>p.parkCode===code):PARKS;return env(rows,rows.length,0,Number(u&&u.searchParams.get("limit"))||700)}
 if(path==="/feespasses")return env([FEES]);
 if(path==="/amenities/parksplaces")return{total:"1",limit:"100",start:"0",data:AMENITY_PLACES};
 if(path==="/amenities/parksvisitorcenters")return{total:"1",limit:"100",start:"0",data:AMENITY_CENTERS};
 /* real WZDx nests useful fields under core_details — the page must unwrap it */
 if(path==="/roadevents")return{type:"FeatureCollection",features:[{type:"Feature",properties:{core_details:{event_type:"work-zone",data_source_id:"nps",road_names:["Grand Loop Road"],description:"Expect short delays near Canyon Junction."},start_date:"2026-07-01T00:00:00Z"},geometry:{type:"LineString",coordinates:[[-110.50,44.70],[-110.45,44.74],[-110.40,44.76]]}}]};
 if(path.startsWith("/mapdata/parkboundaries/"))return{type:"FeatureCollection",features:[
  {type:"Feature",properties:{sitecode:"yell"},geometry:{type:"Polygon",coordinates:[[[-111.1,44.1],[-109.8,44.1],[-109.8,45.1],[-111.1,45.1],[-111.1,44.1]]]}},
  {type:"Feature",properties:{kind:"district"},geometry:{type:"MultiPolygon",coordinates:[[[[-110.9,44.2],[-110.7,44.2],[-110.7,44.4],[-110.9,44.4],[-110.9,44.2]]]]}},
  {type:"Feature",properties:{kind:"route"},geometry:{type:"LineString",coordinates:[[-110.8,44.3],[-110.4,44.8]]}},
  {type:"Feature",properties:{kind:"marker"},geometry:{type:"Point",coordinates:[-110.6,44.6]}}
 ]};
 const rows=D[path]||[];
 if(path==="/events"){const size=Number(u.searchParams.get("pageSize"))||20,page=Math.max(1,Number(u.searchParams.get("pageNumber"))||1),start=(page-1)*size;return env(rows.slice(start,start+size),rows.length,start,size)}
 const limit=Number(u&&u.searchParams.get("limit"))||100,start=Number(u&&u.searchParams.get("start"))||0;
 return env(rows.slice(start,start+limit),rows.length,start,limit);
}
function canonical(path){return path.startsWith("/mapdata/parkboundaries/")?"/mapdata/parkboundaries/{sitecode}":path}
function fulfill(route,body,status=200,extraHeaders={}){return route.fulfill({status,contentType:"application/json",headers:Object.assign({"access-control-allow-origin":"*","access-control-allow-headers":"X-Api-Key, Content-Type","access-control-allow-methods":"GET, OPTIONS","access-control-expose-headers":"X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After"},extraHeaders),body:JSON.stringify(body)})}
export async function routeNps(page,track){
 await page.context().route("https://developer.nps.gov/**",route=>{
  const req=route.request();if(req.method()==="OPTIONS")return fulfill(route,{});
  const u=new URL(req.url()),path=u.pathname.replace("/api/v1","");
  track.requests++;track.paths.add(canonical(path));track.headers.push(req.headers()["x-api-key"]||"");if(u.searchParams.has("api_key"))track.queryLeak=true;
  if(path==="/multimedia/galleries/assets")track.galleryAssetQuery={galleryId:u.searchParams.get("galleryId"),parkCode:u.searchParams.get("parkCode")};
  if(track.queries)track.queries.push({path,params:Object.fromEntries(u.searchParams)});
  const failure=typeof track.fail==="function"?track.fail(path,u,track.requests):null;
  if(failure)return fulfill(route,failure.body||{error:{code:"TEST_PROVIDER_FAILURE"}},failure.status||500,failure.headers||{});
  return fulfill(route,bodyFor(path,u));
 });
}
async function waitTab(page){
 try{await page.waitForFunction(()=>{const xs=[...document.querySelectorAll(".resource-status")];return xs.length>0&&xs.every(x=>!x.classList.contains("loading-dot"))},{timeout:20000})}
 catch(e){const debug=await page.evaluate(()=>({url:location.href,app:document.querySelector('#app')?.innerText,content:document.querySelector('#content')?.innerText,statuses:[...document.querySelectorAll('.resource-status')].map(x=>({text:x.textContent,classes:x.className})),key:!!localStorage.getItem('suite.key.nps'),active:localStorage.getItem('suite.parks.active')}));throw new Error('tab did not settle: '+JSON.stringify(debug))}
}
export async function interact({page,log,evidenceDir}){
 await page.waitForSelector("#app .card-msg");
 log(`no-key state: ${(await page.textContent("#app h2")).trim()}`);
 log(`key input masked: ${await page.getAttribute('#app input[aria-label="NPS API key"]','type')}`);
 await page.screenshot({path:evidenceDir+"/nokey-designed-state.png",fullPage:true});
 const track={requests:0,paths:new Set(),headers:[],queryLeak:false,galleryAssetQuery:null,galleryPickerOptions:0,unsafeFiltered:false,queries:[]};await routeNps(page,track);
 await page.fill('#app input[aria-label="NPS API key"]',FAKE_KEY);await page.click("#app button.primary");await page.waitForSelector(".nps-picker");
 log(`park directory authenticated by X-Api-Key header: ${track.headers[0]===FAKE_KEY}; URL key leakage: ${track.queryLeak}`);
 await page.fill('.nps-picker input[type="search"]',"yellowstone");await page.focus('.options .opt:has-text("Yellowstone")');await page.keyboard.press("Enter");await page.waitForSelector(".park-hero h2");
 const nativePicker=await page.locator('.options .opt').first().evaluate(x=>x.tagName==="BUTTON"&&x.getAttribute("aria-pressed")!==null&&x.parentElement.getAttribute("role")!=="listbox");
 log(`native park-option button semantics: ${nativePicker}`);if(!nativePicker)throw new Error('park picker uses incomplete listbox semantics');
 log(`selected park: ${(await page.textContent('.park-hero h2')).trim()}; active storage: ${await page.evaluate(()=>localStorage.getItem('suite.parks.active'))}`);
 log(`overview cards: ${await page.locator('.item-card').count()}; hero image visible: ${await page.locator('.hero-image').isVisible()}`);
 await page.click('.park-hero button:has-text("watch alerts")');
 const expectations={alerts:"Thermal area",visit:"Madison Campground",explore:"Walk a geyser basin",learn:"landscape shaped",media:"Sounds of Yellowstone",reference:"NPS activity catalog"};
 for(const tab of ["alerts","visit","explore","learn","media","reference"]){
  await page.click(`.tab[data-tab="${tab}"]`);await waitTab(page);
  if(await page.getAttribute(`.tab[data-tab="${tab}"]`,'aria-pressed')!=="true")throw new Error(`section button ${tab} lacks aria-pressed state`);
  if(tab==="visit"){const manual=page.locator('button[data-load-resource]');const n=await manual.count();for(let i=n-1;i>=0;i--)await manual.nth(i).click();await waitTab(page);
   const boundarySvg=await page.locator('.resource[data-resource="boundary"] svg path').count();
   const boundaryNote=(await page.textContent('.resource[data-resource="boundary"]')).replace(/\s+/g,' ');
   log(`boundary GeoJSON drawn as outline: paths=${boundarySvg}, note has area=${/sq mi/.test(boundaryNote)}`);
   if(boundarySvg<3||!/Polygon, MultiPolygon, LineString, Point GeoJSON/.test(boundaryNote)||!/bounds/.test(boundaryNote)||!/sq mi/.test(boundaryNote))throw new Error('boundary geometry was not rendered visibly and textually: '+boundaryNote);
   const roadTitle=(await page.textContent('.resource[data-resource="roads"]')).replace(/\s+/g,' ');
   if(!/Grand Loop Road/.test(roadTitle)||!/GeoJSON LineString/.test(roadTitle)||!/3 coordinates/.test(roadTitle)||/object Object/.test(roadTitle))throw new Error('WZDx road event/geometry not decoded: '+roadTitle);
   const camp=(await page.textContent('.resource[data-resource="campgrounds"]')).replace(/\s+/g,' ');
   const parking=(await page.textContent('.resource[data-resource="parking"]')).replace(/\s+/g,' ');
   const event=(await page.textContent('.resource[data-resource="events"]')).replace(/\s+/g,' ');
   if(!/278 total/.test(camp)||!/250 reservable/.test(camp)||!/Accessible sites/.test(camp))throw new Error('campground-specific facts missing: '+camp);
   if(!/5 minute estimated wait/.test(parking)||!/Eight signed accessible/.test(parking))throw new Error('parking-specific facts missing: '+parking);
   if(!/Old Faithful Inn porch/.test(event)||!/Repeats daily/.test(event)||!/Ranger program/.test(event))throw new Error('event-specific facts missing: '+event);
   const eventNext=page.locator('.resource[data-resource="events"] .pager button:has-text("Next")');
   if(await eventNext.isDisabled())throw new Error('events next-page control unexpectedly disabled');
   await eventNext.click();await waitTab(page);
   const eventQ=track.queries.filter(x=>x.path==="/events").at(-1)?.params;
   if(eventQ?.pageNumber!=="2"||"start" in eventQ)throw new Error('events pagination dialect wrong: '+JSON.stringify(eventQ));
   if(!/21–23 of 23/.test(await page.textContent('.resource[data-resource="events"] .page-label')))throw new Error('events page status not visible');
   await page.click('.resource[data-resource="events"] .pager button:has-text("Previous")');await waitTab(page);
   log(`resource-specific visit output + pagination: campground sites/accessibility, parking wait, event recurrence; pageNumber ${eventQ.pageNumber}, no start`);
   log(`WZDx core_details decoded with visible LineString geometry: ${/work-zone · Grand Loop Road/.test(roadTitle)}`);}
  if(tab==="explore"){const txt=(await page.textContent("#content")).replace(/\s+/g," ");if(!/1–2 hours/.test(txt)||!/Boardwalk route/.test(txt)||!/Historic guardhouse/.test(txt)||!/GeoJSON LineString/.test(txt))throw new Error("explore resource-specific facts missing: "+txt)}
  if(tab==="learn"){const next=page.locator('.resource[data-resource="articles"] .pager button:has-text("Next")');if(await next.isDisabled())throw new Error('articles next-page control unexpectedly disabled');await next.click();await waitTab(page);const q=track.queries.filter(x=>x.path==="/articles").at(-1)?.params;if(q?.start!=="24"||q?.limit!=="24")throw new Error('standard pagination wrong: '+JSON.stringify(q));if(!/25–29 of 29/.test(await page.textContent('.resource[data-resource="articles"] .page-label')))throw new Error('article page status not visible');await page.click('.resource[data-resource="articles"] .pager button:has-text("Previous")');await waitTab(page);log(`standard pagination: articles next used start=${q.start}, limit=${q.limit}; previous restored page 1`)}
  if(tab==="learn")track.unsafeFiltered=(await page.locator('a[href^="javascript:"], img[src^="javascript:"]').count())===0;
  if(tab==="media"){track.galleryPickerOptions=await page.locator('select[aria-label="Choose a gallery for assets"] option').count();const txt=(await page.textContent("#content")).replace(/\s+/g," ");if(!/Open captions available/.test(txt)||!/Image description: Bison walking through snow/.test(txt)||!/Media file: https:\/\/www\.nps\.gov/.test(txt))throw new Error("media-specific facts missing: "+txt)}
  const txt=(await page.textContent('#content')).replace(/\s+/g,' ');log(`${tab}: resources=${await page.locator('#content .resource').count()}, expected content=${txt.includes(expectations[tab])}`);
 }
 const health=await page.locator('.health-row').count();const healthOk=await page.locator('.health-state.ok').count();
 log(`endpoint coverage: requested ${track.paths.size}/29 unique resources; health rows ${health}, ok ${healthOk}`);
 log(`all API calls used header auth: ${track.headers.every(v=>v===FAKE_KEY)}; no api_key query params: ${!track.queryLeak}`);
 log(`gallery assets scoped by galleryId: ${track.galleryAssetQuery?.galleryId==="G1"&&track.galleryAssetQuery?.parkCode===null}`);
 log(`gallery asset picker options: ${track.galleryPickerOptions}`);
 log(`remote URL protocol filtering: ${track.unsafeFiltered}`);
 if(track.paths.size!==29)throw new Error(`expected 29 endpoint resources, saw ${track.paths.size}: ${[...track.paths].join(', ')}`);
 if(track.galleryAssetQuery?.galleryId!=="G1"||track.galleryAssetQuery?.parkCode!==null)throw new Error(`gallery assets were not scoped to a gallery: ${JSON.stringify(track.galleryAssetQuery)}`);
 if(track.galleryPickerOptions!==2)throw new Error(`gallery asset picker was not populated: ${track.galleryPickerOptions}`);
 if(!track.unsafeFiltered)throw new Error('unsafe remote URL protocol reached the DOM');
 if(health!==29||healthOk!==29)throw new Error(`endpoint health incomplete: rows=${health} ok=${healthOk}`);
 const before=track.requests;await page.reload();await waitTab(page);await page.click('.tab[data-tab="visit"]');await waitTab(page);log(`fresh cache reload made no NPS requests: ${track.requests===before}`);
 // Invalid key in a sibling page avoids counting the intentionally induced 403 as a main-page console issue.
 await page.context().unroute("https://developer.nps.gov/**");await page.context().route("https://developer.nps.gov/**",r=>r.request().method()==="OPTIONS"?fulfill(r,{}):fulfill(r,{error:{code:"API_KEY_INVALID"}},403));
 const p2=await page.context().newPage();await p2.goto(page.url());await p2.evaluate(k=>{localStorage.setItem('suite.key.nps',k);localStorage.removeItem('suite.cache.parks.parklist.v3')},FAKE_KEY);await p2.reload();await p2.waitForSelector('#app h2:has-text("That NPS key did not work")');log(`invalid-key state shown: true`);await p2.screenshot({path:evidenceDir+"/invalid-key-state.png",fullPage:true});await p2.close();
 await page.context().unroute("https://developer.nps.gov/**");await routeNps(page,track);
 // The sibling invalid-key check deliberately removed the shared park-directory cache; rebuild it online.
 await page.reload();await waitTab(page);
 // Back-date every cache beyond its TTL, block network, and prove stale visit resources survive.
 await page.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('suite.cache.parks.')){const e=JSON.parse(localStorage.getItem(k));e.t=Date.now()-40*24*3600000;localStorage.setItem(k,JSON.stringify(e))}});
 await page.context().unroute("https://developer.nps.gov/**");await page.context().route(/^https?:/,r=>r.abort());await page.reload();await waitTab(page);{const manual=page.locator('button[data-load-resource]');const n=await manual.count();for(let i=n-1;i>=0;i--)await manual.nth(i).click()}await waitTab(page);const stale=await page.locator('.resource-status.stale').count();log(`offline stale visit resources: ${stale}`);if(stale<7)throw new Error(`expected stale visit resources, got ${stale}`);
 const boundaryOffline=(await page.textContent('.resource[data-resource="boundary"]')).replace(/\s+/g,' ');
 if(!/Network unavailable and no cached copy exists/.test(boundaryOffline))throw new Error('boundary offline state not designed: '+boundaryOffline);
 log(`boundary (uncached by design) shows its explicit offline state: true`);await page.screenshot({path:evidenceDir+"/offline-stale.png",fullPage:true});await page.context().unroute(/^https?:/);
 await page.setViewportSize({width:390,height:844});await page.click('.tab[data-tab="overview"]');await page.screenshot({path:evidenceDir+"/mobile-390.png",fullPage:true});log(`mobile viewport horizontal overflow: ${await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)}`);
}
