import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT=fileURLToPath(new URL("../",import.meta.url)), DIST=join(ROOT,"dist");
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".wasm":"application/wasm",".glb":"model/gltf-binary",".mp3":"audio/mpeg"};
const server=createServer(async(req,res)=>{try{const raw=req.url==="/"?"/index.html":req.url.split("?")[0],file=resolve(DIST,"."+decodeURIComponent(raw));if(file!==DIST&&!file.startsWith(DIST+sep)){res.writeHead(403).end();return;}res.writeHead(200,{"content-type":MIME[extname(file)]||"application/octet-stream"});res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,r));const port=server.address().port;let browser;
for(const executablePath of [process.env.CHROMIUM_PATH,"/opt/ms-playwright/chromium-1234/chrome-linux64/chrome","/usr/bin/chromium","/opt/gchrome/opt/google/chrome/chrome"].filter(Boolean)){try{browser=await chromium.launch({headless:!process.env.DISPLAY,executablePath,args:["--no-sandbox","--disable-gpu-sandbox","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});break;}catch{}}
if(!browser){server.close();throw new Error("No Chromium");}
const errors=[],assert=(v,m)=>{if(!v)throw new Error(m);console.log("PASS:",m)};
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(30000);page.on("pageerror",e=>errors.push(String(e)));page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
 await page.addInitScript(()=>{localStorage.setItem("whiteout.settings-v2",JSON.stringify({language:"en",quality:"low",muted:true,volume:0,uiScale:1}));localStorage.setItem("whiteout.interface-tutorial.v1",JSON.stringify({version:1,complete:true}));});
 const d=(expression,...args)=>page.evaluate(({expression,args})=>{let t=window.__whiteoutDebug;for(const p of expression.split("."))t=t[p];return typeof t==="function"?t(...args):t},{expression,args});
 const fresh=async(credits=5000)=>{await d("start");await d("setQuest",8);const s=await d("snapshot");await d("giveCredits",credits-s.credits)};
 const reload=async()=>{await page.reload({waitUntil:"networkidle"});await page.waitForFunction(()=>window.__GAME_READY__&&window.__whiteoutDebug);await page.click("#continue-btn")};
 await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:"networkidle"});await page.waitForFunction(()=>window.__GAME_READY__&&window.__whiteoutDebug,null,{timeout:90000});
 await fresh();
 // Failed relocation is atomic and preserves routes and cargo.
 const source=await d("build","sweeper",12,12),purifier=await d("build","purifier",3,-2);await d("setOutput",source,20);await d("rail",source,purifier);await d("step",0.5);
 const before=await d("railState");assert(before[0].cargo>0,"route carries cargo before rejected relocation");
 assert(!(await d("moveBuilding",source,100,100)),"out-of-bounds relocation rejected");
 assert((await d("railState")).length===1&&(await d("railState"))[0].cargo===before[0].cargo,"rejected relocation preserves route and in-flight cargo");
 // Full input falls through to output collection.
 await d("setInput",purifier,1000);await d("setOutput",purifier,8);await d("setRaw",1);await d("teleport",3,-2);const purifiedBefore=(await d("snapshot")).purified;await d("interact");
 assert(Math.abs((await d("snapshot")).purified-purifiedBefore-4)<0.1,"full input still permits collecting produced output");
 // Route deletion returns in-flight cargo to source.
 const sourceOut=(await d("snapshot")).buildings.find(b=>b.id===source).output,cargo=(await d("railState"))[0].cargo;await d("moveBuilding",purifier,4,-3);
 assert(Math.abs((await d("snapshot")).buildings.find(b=>b.id===source).output-sourceOut-cargo)<0.01,"valid relocation returns route cargo instead of deleting it");
 // Capsule state survives save/load.
 await d("rail",source,purifier);await d("setOutput",source,25);await d("step",0.4);const transit=await d("railState");await d("save");await reload();
 const restored=await d("railState");assert(restored[0].capsules.some(c=>c.active&&c.cargo===transit[0].capsules.find(c=>c.active).cargo&&c.distance>=0),"schema 11 preserves active capsule cargo and travel state");
 // Paid rescue is not charged again after reload.
 const frozen=await d("build","sweeper",18,18);await d("freezeRobot",frozen);await d("teleport",30,30);const credits=(await d("snapshot")).credits;await d("interact");await d("save");await reload();
 const rescued=(await d("robotStates")).find(r=>r.id===frozen);assert((await d("snapshot")).credits===credits-150&&(rescued.rescueProgress>0||!rescued.frozen),"paid rescue survives reload without charging twice");
 // Scanner cooldown survives.
 await d("scan");const cooldown=(await d("snapshot")).scannerCooldown;await d("save");await reload();assert((await d("snapshot")).scannerCooldown>0&&(await d("snapshot")).scannerCooldown<=cooldown,"scanner cooldown persists");
 // Death cannot be bypassed by reloading.
 await d("lose");await page.reload({waitUntil:"networkidle"});await page.waitForFunction(()=>window.__GAME_READY__&&window.__whiteoutDebug);await page.click("#continue-btn");assert((await d("snapshot")).state==="gameover","reload restores the persisted defeat state");
 await page.click("#checkpoint-end-btn");assert((await d("snapshot")).state==="playing"&&(await d("snapshot")).heat>99,"explicit checkpoint recovery restores play");
 // Storm accounting remains within the physical 0..100 interval.
 await fresh();const clean0=(await d("snapshot")).cleanupPercent;await d("clearAt",0,10,12);const clean1=(await d("snapshot")).cleanupPercent;await d("storm");await d("step",0.2);const clean2=(await d("snapshot")).cleanupPercent;
 assert(clean1>clean0&&clean2<clean1&&clean2>=0&&clean2<=100,"storm regrowth changes cleanup by the actual added snow mass");
 // Damaged consumers release capacity.
 const generator=await d("build","generator",0,20),consumer=await d("build","heater",0,25);await d("step",0.1);const loads=(await d("powerState")).find(b=>b.id===generator).load;await d("damageBuilding",consumer);const after=(await d("powerState")).find(b=>b.id===generator).load;assert(after===Math.max(0,loads-1),"damaged building releases active power capacity");
 // First quest counts sold snow units, not rounded sale income.
 await d("start");await d("setRaw",4);await d("teleport",7,8);await d("interact");assert((await d("snapshot")).quest.index===0&&(await d("snapshot")).rawSold===4,"four raw units count as four quest units, not six credits");
 await d("setRaw",5);await d("interact");assert((await d("snapshot")).quest.index===1&&(await d("snapshot")).rawSold===9,"five more raw units complete the five-unit first quest");
 // Press reserves one batch and keeps progress through small deliveries.
 await fresh();const batchPress=await d("build","press",3,-2);await d("setInput",batchPress,5);await d("step",0.2);const batchProgress=(await d("snapshot")).buildings.find(b=>b.id===batchPress).progress;
 assert((await d("snapshot")).buildings.find(b=>b.id===batchPress).input===0&&batchProgress>0,"press reserves five purified units when a batch starts");
 await d("step",0.2);assert((await d("snapshot")).buildings.find(b=>b.id===batchPress).progress>batchProgress,"press progress survives an empty input buffer after reservation");await d("step",3);assert((await d("snapshot")).buildings.find(b=>b.id===batchPress).output>=1,"reserved ice batch completes without additional input");
 await d("setInput",batchPress,3);await d("step",0.1);assert((await d("buildingVisuals")).find(b=>b.id===batchPress).alertState==="","partial input does not raise a false missing-input alert");
 // Scanner triangulates evidence without the removed radar building.
 await fresh();await d("teleport",-20,-29.7);await d("scan");assert((await d("snapshot")).coreViews.find(c=>c.id==="comms").scanned,"handheld scan records the located evidence signal");
 // Robot wear disables only the robot and can be serviced independently.
 const wornDock=await d("build","sweeper",12,12);await d("setRobotHealth",wornDock,0);await d("step",0.1);assert(!(await d("snapshot")).buildings.find(b=>b.id===wornDock).damaged&&(await d("robotStates")).find(r=>r.id===wornDock).mode==="damaged",`robot wear does not structurally damage its dock (${JSON.stringify({building:(await d("snapshot")).buildings.find(b=>b.id===wornDock),robot:(await d("robotStates")).find(r=>r.id===wornDock)})})`);assert(await d("repairBuilding",wornDock),"worn robot accepts independent paid dock service");
 // Demolition refunds base, upgrades and additional units.
 const refundBuilding=await d("build","purifier",-3,-2);await d("teleport",-3,-2);await d("upgradeNearest");await d("upgradeNearest");const beforeRefund=(await d("snapshot")).credits;await d("demolishBuilding",refundBuilding);assert((await d("snapshot")).credits-beforeRefund===500,"demolition returns fifty percent of base and all upgrades");
 // Ice sales fund construction but do not fake mission uplink charge.
 await d("setPower",50);await d("setCarried",0,2);await d("teleport",7,8);await d("interact");assert((await d("snapshot")).power===50,"ice sale provides credits without filling mission uplink");
 // Cleanup certification is stable while actual snow can still return.
 await d("setQuest",9);await d("clearAt",0,0,200);await d("step",0.02);assert((await d("snapshot")).cleanupCertified,"98 percent cleanup is certified once reached");await d("storm");await d("step",0.2);assert((await d("snapshot")).cleanupPercent<98&&(await d("snapshot")).cleanupCertified,"storm regrowth remains physical without revoking cleanup certification");
 // Pause settings return to the pause menu, not directly to survival.
 await d("pause");await page.click("#pause-settings-btn");await page.click("#close-settings-btn");assert((await d("snapshot")).state==="paused"&&(await d("snapshot")).pausePanel==="menu","closing settings returns to the pause menu");await d("resume");
 // Defeat recovery uses the heated base and victory offers no checkpoint.
 await d("teleport",35,35);await d("lose");await page.click("#checkpoint-end-btn");const recovered=await d("snapshot");assert(recovered.state==="playing"&&Math.hypot((await page.evaluate(()=>window.__gameProbe())).x,(await page.evaluate(()=>window.__gameProbe())).z-2)<0.2&&recovered.heat>99,"checkpoint recovery returns to the heated base with full heat");
 await d("win");assert(await page.locator("#checkpoint-end-btn").isHidden(),"victory screen hides checkpoint recovery");await page.click("#restart-end-btn");await page.waitForTimeout(100);if(await page.locator("#skip-cinematic").isVisible())await page.click("#skip-cinematic");
 // Every legacy schema migrates and refunds removed tank tiers.
 await fresh();await d("save");const legacyBase=await page.evaluate(()=>JSON.parse(localStorage.getItem("whiteout.career-v2")));
 await Promise.all(Array.from({length:9},async(_,index)=>{
  const version=index+2,legacy=structuredClone(legacyBase);legacy.version=version;legacy.upgrades.tank=3;delete legacy.scannerCooldown;delete legacy.status;for(const r of legacy.rails)delete r.capsules;
  const migrationPage=await browser.newPage({viewport:{width:640,height:360}});migrationPage.setDefaultTimeout(90000);migrationPage.on("pageerror",e=>errors.push(String(e)));migrationPage.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
  await migrationPage.addInitScript(data=>{localStorage.setItem("whiteout.settings-v2",JSON.stringify({language:"en",quality:"low",muted:true,volume:0,uiScale:1}));localStorage.setItem("whiteout.interface-tutorial.v1",JSON.stringify({version:1,complete:true}));localStorage.setItem("whiteout.career-v2",JSON.stringify(data));},legacy);
  await migrationPage.goto(`http://127.0.0.1:${port}/`,{waitUntil:"networkidle"});await migrationPage.waitForFunction(()=>window.__GAME_READY__&&window.__whiteoutDebug,null,{timeout:180000});await migrationPage.click("#continue-btn");
  const migrated=await migrationPage.evaluate(()=>window.__whiteoutDebug.snapshot());assert(Math.abs(migrated.credits-(legacyBase.credits+(version<9?500:0)))<1,`schema ${version} migrates with correct legacy tank refund`);await migrationPage.close();
 }));
 assert(errors.length===0,`zero browser errors${errors.length?`: ${errors.join(" | ")}`:""}`);console.log("REPORT VERIFY OK");
}finally{await browser.close();server.close();}
