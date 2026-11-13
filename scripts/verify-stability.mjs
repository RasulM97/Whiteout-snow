import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".mp3": "audio/mpeg" };
const baseUrl = process.env.BASE_URL;
let server;
if (!baseUrl) {
  server = createServer(async (req, res) => {
    try {
      const raw = req.url === "/" ? "/index.html" : req.url.split("?")[0];
      const file = resolve(DIST, "." + decodeURIComponent(raw));
      if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
      const data = await readFile(file); res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" }); res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
}
const origin = baseUrl || `http://127.0.0.1:${server.address().port}/`;
const executablePath = [process.env.CHROMIUM_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find((path) => path && existsSync(path));
if (!executablePath) throw new Error("No Chrome or Edge executable found");
const browser = await chromium.launch({ headless: true, executablePath });
const errors = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log("PASS:", message); };

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "auto", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    if (!sessionStorage.getItem("stability-ready")) { localStorage.removeItem("whiteout.career-v2"); sessionStorage.setItem("stability-ready", "1"); }
  });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug, null, { timeout: 30000 });

  await page.click("#start-btn");
  await page.waitForFunction(() => document.querySelector("#ui-overlay").classList.contains("cinematic-active"), null, { timeout: 10000 });
  const cinematic = await page.evaluate(() => {
    document.querySelector("#reward-layer").append(Object.assign(document.createElement("div"), { className: "reward-pop" }));
    document.querySelector("#event-banner").classList.remove("hidden");
    const style = (selector) => getComputedStyle(document.querySelector(selector)).visibility;
    return { toast: style("#toast"), reward: style("#reward-layer"), banner: style("#event-banner"), hud: style("#hud"), toastShown: document.querySelector("#toast").classList.contains("show") };
  });
  assert(cinematic.toastShown && cinematic.toast === "hidden" && cinematic.reward === "hidden" && cinematic.banner === "hidden" && cinematic.hud === "hidden", "opening cinematic hides the HUD, toast, reward and event banner");
  await page.click("#skip-cinematic");

  const economy = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const sell = (amount, times) => {
      d.start(); d.teleport(7, 8); let credits = 0;
      for (let i = 0; i < times; i++) { d.setRaw(amount); const before = d.snapshot().credits; d.interact(); credits += d.snapshot().credits - before; }
      return { credits, rawSold: d.snapshot().rawSold, remainder: d.logistics().saleRemainder, rate: d.snapshot().salesPerMinute };
    };
    const split = sell(0.2, 10); const lump = sell(2, 1); const hundred = sell(1, 100);
    d.start(); d.teleport(7, 8); d.setRaw(0.2); d.interact(); d.save();
    const saved = JSON.parse(localStorage.getItem("whiteout.career-v2"));
    return { split, lump, hundred, savedRemainder: saved.saleCreditRemainder, quest: (() => { d.start(); d.teleport(7, 8); d.setRaw(5); d.interact(); const s = d.snapshot(); return { index: s.quest.index, rawSold: s.rawSold, credits: s.credits }; })() };
  });
  assert(economy.split.credits === 3 && economy.lump.credits === 3 && Math.abs(economy.split.rawSold - 2) < 1e-6 && economy.lump.rawSold === 2, `split raw sales keep the same 3 credits as one sale (${JSON.stringify({ split: economy.split, lump: economy.lump })})`);
  assert(economy.hundred.rate === 150 && economy.hundred.rawSold === 100, `one hundred single-unit sales pay 150 credits, not 200 (${JSON.stringify(economy.hundred)})`);
  assert(Math.abs(economy.savedRemainder - 0.3) < 1e-6, "a fractional sale keeps its unpaid remainder in the save");
  assert(economy.quest.index === 1 && economy.quest.rawSold === 5 && economy.quest.credits === 87, `selling five raw completes the first contract at the fair credit total (${JSON.stringify(economy.quest)})`);

  const persisted = await page.evaluate(() => {
    const d = window.__whiteoutDebug; d.start(); d.teleport(7, 8); d.setRaw(0.2); d.interact();
    const source = d.build("sweeper", 14, 10); const dest = d.build("purifier", 8, 16);
    d.rail(source, dest); d.damageBuilding(dest); d.setOutput(source, 20); d.step(2); d.demolishBuilding(source); d.save();
    return d.logistics();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug, null, { timeout: 30000 });
  await page.click("#continue-btn");
  await page.waitForFunction(() => document.querySelector("#title-screen").classList.contains("hidden"), null, { timeout: 10000 });
  const restored = await page.evaluate(() => window.__whiteoutDebug.logistics());
  assert(persisted.retained.raw > 5 && Math.abs(restored.saleRemainder - persisted.saleRemainder) < 1e-6 && Math.abs(restored.retained.raw - persisted.retained.raw) < 0.05, `reload keeps the sale remainder and stranded rail cargo (${JSON.stringify({ before: { remainder: persisted.saleRemainder, raw: persisted.retained.raw }, after: { remainder: restored.saleRemainder, raw: restored.retained.raw } })})`);

  const rails = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const caps = () => d.logistics().buildings.every((b) => b.output <= b.outputCapacity + 1e-4 && b.input <= b.inputCapacity + 1e-4);
    const cargo = () => d.railState().reduce((sum, rail) => sum + rail.cargo, 0);
    d.start();
    const source = d.build("sweeper", 14, 10); const dest = d.build("purifier", 8, 16);
    if (!d.rail(source, dest)) throw new Error("rail was not created");
    d.damageBuilding(dest); d.setOutput(source, 36); d.step(2.6);
    const abandonedCargo = cargo();
    d.demolishBuilding(source);
    const afterSource = d.logistics();
    const sourceCase = { before: abandonedCargo, recovered: afterSource.retained.raw + cargo() + (afterSource.buildings.find((b) => b.id === dest)?.input || 0), caps: caps() };

    d.start();
    const sweeper = d.build("sweeper", 14, 10); const purifier = d.build("purifier", 8, 16);
    d.rail(sweeper, purifier); d.damageBuilding(purifier);
    const room = d.logistics().buildings.find((b) => b.id === sweeper);
    d.setOutput(sweeper, room.outputCapacity - 1); d.step(2.6);
    d.setOutput(sweeper, room.outputCapacity - 1);
    const beforeOutput = d.logistics().buildings.find((b) => b.id === sweeper).output;
    const waiting = cargo();
    d.demolishBuilding(purifier);
    const kept = d.logistics().buildings.find((b) => b.id === sweeper);
    const destCase = { before: waiting, outputGain: kept.output - beforeOutput, retained: d.logistics().retained.raw, rail: cargo(), output: kept.output, capacity: kept.outputCapacity, caps: caps() };

    d.start();
    const loader = d.build("sweeper", 14, 10); const hopper = d.build("purifier", 8, 16);
    d.rail(loader, hopper); d.damageBuilding(hopper); d.setOutput(loader, 30);
    let sawVisible = false; let parked = null;
    for (let i = 0; i < 48 && !(sawVisible && parked); i++) {
      d.step(0.25);
      for (const rail of d.railState()) for (const capsule of rail.capsules) {
        if (capsule.active && capsule.cargo > 0 && capsule.visible && capsule.distance < rail.total - 0.65) sawVisible = true;
        if (capsule.active && capsule.cargo > 0 && !capsule.visible && capsule.distance >= rail.total - 0.65) parked = { cargo: capsule.cargo, distance: capsule.distance, total: rail.total };
      }
    }
    d.freezeRobot(loader); d.setOutput(loader, 0);
    const hopperStock = () => { const building = d.logistics().buildings.find((b) => b.id === hopper); return building.input + building.output / 0.85; };
    const railBefore = cargo(); const stockBefore = hopperStock();
    d.giveCredits(500); if (!d.repairBuilding(hopper)) throw new Error("hopper repair failed"); d.setInput(hopper, 0); d.step(4);
    const railAfter = cargo(); const stockAfter = hopperStock();
    return { sourceCase, destCase, sawVisible, parked, railBefore, railAfter, stockGain: stockAfter - stockBefore, caps: caps() };
  });
  assert(rails.sourceCase.before > 5 && Math.abs(rails.sourceCase.recovered - rails.sourceCase.before) < 0.05 && rails.sourceCase.caps, `demolishing a rail source keeps in-transit cargo (${JSON.stringify(rails.sourceCase)})`);
  assert(rails.destCase.before > 5 && rails.destCase.output <= rails.destCase.capacity + 1e-4 && rails.destCase.outputGain <= 1.001 && Math.abs(rails.destCase.outputGain + rails.destCase.retained + rails.destCase.rail - rails.destCase.before) < 0.05 && rails.destCase.caps, `demolishing a full destination does not overflow or lose cargo (${JSON.stringify(rails.destCase)})`);
  assert(rails.sawVisible && rails.parked && rails.parked.cargo > 0 && rails.railBefore > rails.railAfter && Math.abs(rails.stockGain - (rails.railBefore - rails.railAfter)) < 0.25 && rails.caps, `a capsule hidden at a full destination still delivers exactly once (${JSON.stringify({ sawVisible: rails.sawVisible, parked: rails.parked, railBefore: rails.railBefore, railAfter: rails.railAfter, stockGain: rails.stockGain })})`);

  const robots = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const productive = new Set(["seek", "gather", "return"]);
    const watch = (setup, seconds) => {
      d.start(); setup();
      const modes = {}; let samples = 0, productiveTicks = 0, justified = 0, waste = 0, stuck = 0, duplicates = 0;
      const still = new Map(); const seen = new Map();
      for (let i = 0; i < seconds * 2; i++) {
        d.step(0.5);
        const stock = new Map(d.logistics().buildings.map((b) => [b.id, b]));
        const chunks = [];
        for (const robot of d.robotStates().filter((unit) => unit.kind === "sweeper")) {
          samples++; modes[robot.mode] = (modes[robot.mode] || 0) + 1;
          if (robot.activeChunk >= 0) chunks.push(robot.activeChunk);
          const key = `${robot.buildingId}:${robot.slot}`; const prev = seen.get(key);
          const moved = !prev || Math.hypot(robot.x - prev.x, robot.z - prev.z) > 0.08;
          if (!robot.frozen && (robot.mode === "seek" || robot.mode === "return") && !moved) still.set(key, (still.get(key) || 0) + 0.5); else still.set(key, 0);
          if ((still.get(key) || 0) > 8) stuck++;
          seen.set(key, { x: robot.x, z: robot.z });
          const dock = stock.get(robot.buildingId); const full = !!dock && dock.output >= dock.outputCapacity - 0.05;
          if (productive.has(robot.mode) || (robot.mode === "unload" && !full)) productiveTicks++;
          else if (robot.mode === "unload" && full) justified++;
          else if (robot.frozen || ["recharge", "warm-return", "funding", "damaged"].includes(robot.mode)) justified++;
          else if ((robot.mode === "wait" || robot.mode === "expand") && d.snowAt(robot.x, robot.z) < 0.08) justified++;
          else waste++;
        }
        if (new Set(chunks).size !== chunks.length) duplicates++;
      }
      return { samples, productiveTicks, justified, waste, stuck, duplicates, modes, efficiency: samples ? (productiveTicks + justified) / samples : 0, robots: d.robotStates().filter((r) => r.kind === "sweeper").length };
    };
    const one = watch(() => { const id = d.build("sweeper", 14, 10); const hopper = d.build("purifier", 8, 16); d.rail(id, hopper); }, 20);
    const three = watch(() => {
      d.giveCredits(20000); const id = d.build("sweeper", 14, 10); const hopper = d.build("purifier", 8, 16); d.rail(id, hopper);
      d.teleport(14, 10); d.upgradeNearest(); d.upgradeNearest(); d.buyExtraRobot(id); d.buyExtraRobot(id);
    }, 20);
    d.start(); const zoned = d.build("sweeper", 14, 10); d.step(0.8);
    const chunk = d.robotStates()[0].activeChunk;
    d.setRobotZoneMode(zoned, 0, "custom", chunk); d.step(0.8);
    const custom = d.robotStates()[0];
    d.setRobotZoneMode(zoned, 0, "follow"); d.teleport(22, -8); d.step(0.4);
    const follow = d.robotStates()[0];
    d.start(); d.giveCredits(20000); const fleet = d.build("sweeper", 14, 10);
    d.teleport(14, 10); d.upgradeNearest(); d.upgradeNearest(); d.buyExtraRobot(fleet); d.buyExtraRobot(fleet);
    d.setRobotZoneMode(fleet, 0, "custom", 70); d.setRobotZoneMode(fleet, 1, "custom", 90); d.setRobotZoneMode(fleet, 2, "follow");
    d.teleport(24, 18); d.step(1);
    const independent = d.robotStates().filter((r) => r.kind === "sweeper").map((r) => ({ slot: r.slot, mode: r.zoneMode, chunk: r.activeChunk, zoneX: r.zoneX, zoneZ: r.zoneZ }));

    d.start(); d.giveCredits(5000); const carrier = d.build("sweeper", 14, 10);
    d.setRobotCarry(carrier, 0, 11); d.freezeRobot(carrier, 0); const frozenCarry = d.robotStates()[0].carry;
    d.damageBuilding(carrier); d.repairBuilding(carrier); const repairedCarry = d.robotStates()[0].carry; const stillFrozen = d.robotStates()[0].frozen;
    d.setRobotHealth(carrier, 0); d.repairBuilding(carrier); const servicedCarry = d.robotStates()[0].carry;
    d.start(); const blocked = d.build("sweeper", 14, 10); const capacity = d.logistics().buildings[0].outputCapacity;
    d.setOutput(blocked, capacity); d.setRobotCarry(blocked, 0, 6); d.step(2);
    const unload = { output: d.logistics().buildings[0].output, capacity, carry: d.robotStates()[0].carry };

    d.start(); d.giveCredits(500); const haulerA = d.build("hauler", 4, 16); const haulerB = d.build("hauler", -4, 16);
    const damaged = d.build("purifier", 10, 16); const frozenSweeper = d.build("sweeper", 14, 10);
    d.damageBuilding(damaged); d.freezeRobot(frozenSweeper); d.step(0.6);
    const haulers = d.robotStates().filter((r) => r.kind === "hauler");
    const priorities = { repair: haulers.filter((r) => r.mode === "repair" || r.mode === "repair-return").length, rescue: haulers.filter((r) => r.mode === "rescue" || r.mode === "rescue-return").length, ids: [haulerA, haulerB] };

    d.start(); d.giveCredits(75); const cold = d.build("sweeper", 14, 10); d.build("hauler", 5, 14); d.freezeRobot(cold);
    const rescueCredits = d.snapshot().credits; d.step(18);
    const thawed = d.robotStates().find((r) => r.id === cold && r.kind === "sweeper");
    const drone = { frozen: thawed.frozen, spent: rescueCredits - d.snapshot().credits, carry: thawed.carry };

    d.start(); d.giveCredits(400); const manual = d.build("sweeper", 14, 10); d.freezeRobot(manual); d.teleport(30, 30);
    const manualBefore = d.snapshot().credits; const first = d.rescueAt(30, 30); d.step(0.4); d.teleport(0, 10); d.step(1.2);
    const away = d.snapshot().credits; d.teleport(30, 30); const second = d.rescueAt(30, 30); d.step(3.4);
    const manualRescue = { first, second, spent: manualBefore - away, endSpent: manualBefore - d.snapshot().credits, frozen: d.robotStates().find((r) => r.id === manual).frozen };

    d.start(); d.giveCredits(2000); d.build("hauler", 8, 16); const weldTarget = d.build("purifier", 10, 16); d.damageBuilding(weldTarget);
    let progress = 0;
    for (let i = 0; i < 50 && progress < 1; i++) { d.step(0.2); progress = d.robotStates().find((r) => r.kind === "hauler").rescueProgress; }
    let moved = false; for (const [x, z] of [[22, 16], [24, 12], [18, 20], [-12, 18]]) if (d.moveBuilding(weldTarget, x, z)) { moved = true; break; }
    d.step(0.3); const keptProgress = d.robotStates().find((r) => r.kind === "hauler").rescueProgress;

    d.start(); const plant = d.build("purifier", 8, 16); d.setInput(plant, 24); const producedBefore = d.snapshot().produced; d.step(4);
    const processed = { output: d.logistics().buildings.find((b) => b.id === plant).output, produced: d.snapshot().produced - producedBefore };
    d.start();
    for (let i = 0; i < 7; i++) d.build("heater", 6, 4 + i * 3);
    const power = d.powerState(); d.step(1);
    d.start(); d.build("sweeper", 14, 10); d.storm(false); d.step(1.5); const storm = { phase: d.snapshot().stormPhase, intensity: d.visualState().stormIntensity }; d.step(6);
    const stormFinite = d.robotStates().every((r) => Number.isFinite(r.x) && Number.isFinite(r.z) && Number.isFinite(r.temperature));
    d.start(); const coldDock = d.build("sweeper", 14, 10); d.step(8); const coldTemp = d.robotStates()[0].temperature;
    d.start(); const warmDock = d.build("sweeper", 14, 10); d.build("heater", 14, 13); d.step(8); const warmTemp = d.robotStates()[0].temperature;
    return { one, three, custom: { mode: custom.zoneMode, chunk: custom.activeChunk, expected: chunk }, follow: { mode: follow.zoneMode, zoneX: follow.zoneX, zoneZ: follow.zoneZ }, independent, frozenCarry, repairedCarry, stillFrozen, servicedCarry, unload, priorities, drone, manualRescue, weld: { progress, moved, keptProgress }, processed, power: { unpowered: power.filter((b) => !b.powered).length, finite: power.every((b) => Number.isFinite(b.efficiency)) }, storm, stormFinite, coldTemp, warmTemp };
  });
  assert(robots.one.robots === 1 && robots.one.efficiency >= 0.85 && robots.one.stuck === 0 && robots.one.duplicates === 0 && robots.one.waste === 0, `one sweeper stays productive (${JSON.stringify(robots.one)})`);
  assert(robots.three.robots === 3 && robots.three.efficiency >= 0.85 && robots.three.stuck === 0 && robots.three.duplicates === 0 && robots.three.waste === 0, `three sweepers stay independent and productive (${JSON.stringify(robots.three)})`);
  assert(robots.custom.mode === "custom" && robots.custom.chunk === robots.custom.expected, `custom sector sticks to the selected chunk (${JSON.stringify(robots.custom)})`);
  assert(robots.follow.mode === "follow" && Math.hypot(robots.follow.zoneX - 22, robots.follow.zoneZ + 8) < 1.5, `follow mode tracks the player (${JSON.stringify(robots.follow)})`);
  assert(new Set(robots.independent.filter((r) => r.mode === "custom").map((r) => r.chunk)).size === 2 && robots.independent.some((r) => r.mode === "follow" && Math.hypot(r.zoneX - 24, r.zoneZ - 18) < 1.5), `every robot keeps its own zone (${JSON.stringify(robots.independent)})`);
  assert(robots.frozenCarry === 11 && robots.repairedCarry === 11 && robots.stillFrozen && robots.servicedCarry === 11, "cargo survives freezing, structural repair and servicing");
  assert(robots.unload.output <= robots.unload.capacity + 1e-3 && robots.unload.carry > 5, `a full dock refuses extra cargo without deleting the load (${JSON.stringify(robots.unload)})`);
  assert(robots.priorities.repair === 1 && robots.priorities.rescue === 1, `one drone repairs while the other thaws, without sharing a target (${JSON.stringify(robots.priorities)})`);
  assert(!robots.drone.frozen && robots.drone.spent === 75, `autonomous thaw charges 75 credits once (${JSON.stringify(robots.drone)})`);
  assert(robots.manualRescue.first === "started" && robots.manualRescue.second === "active" && robots.manualRescue.spent === 150 && robots.manualRescue.endSpent === 150 && !robots.manualRescue.frozen, `an interrupted paid thaw resumes without a second charge (${JSON.stringify(robots.manualRescue)})`);
  assert(robots.weld.progress >= 1 && robots.weld.moved && robots.weld.keptProgress >= robots.weld.progress - 0.05, `leaving weld range keeps unpaid repair progress (${JSON.stringify(robots.weld)})`);
  assert(robots.processed.output > 0 && robots.processed.produced > 0, `the purifier keeps converting raw snow (${JSON.stringify(robots.processed)})`);
  assert(robots.power.unpowered >= 1 && robots.power.finite, `power beyond the base connection limit leaves a finite unpowered building (${JSON.stringify(robots.power)})`);
  assert(robots.storm.phase === "storm" && robots.storm.intensity > 0.3 && robots.stormFinite, `a storm interrupts cleanly without corrupting robots (${JSON.stringify(robots.storm)})`);
  assert(robots.warmTemp + 1 >= robots.coldTemp && robots.warmTemp > 20 && robots.coldTemp > 20, `heating does not freeze a working robot (${JSON.stringify({ cold: robots.coldTemp, warm: robots.warmTemp })})`);
  console.log("ROBOTS:", JSON.stringify({ one: robots.one, three: robots.three, coldTemp: robots.coldTemp, warmTemp: robots.warmTemp }));

  const screens = await page.evaluate(() => {
    const d = window.__whiteoutDebug; const view = () => ({ end: document.querySelector("#end-screen").classList.contains("hidden"), toast: document.querySelector("#toast").classList.contains("show"), rewards: document.querySelectorAll("#reward-layer .reward-pop").length, hud: document.querySelector("#hud").classList.contains("hidden"), checkpoint: document.querySelector("#checkpoint-end-btn").classList.contains("hidden"), toastVisibility: getComputedStyle(document.querySelector("#toast")).visibility });
    d.start(); d.teleport(7, 8); d.setRaw(1); d.interact(); d.win(); const victory = view();
    d.start(); d.teleport(7, 8); d.setRaw(1); d.interact(); d.lose(); const defeat = view();
    return { victory, defeat };
  });
  assert(!screens.victory.end && !screens.victory.toast && screens.victory.rewards === 0 && screens.victory.hud && screens.victory.checkpoint && screens.victory.toastVisibility === "hidden", "victory clears the HUD, toast and reward layer");
  assert(!screens.defeat.end && !screens.defeat.toast && screens.defeat.rewards === 0 && screens.defeat.hud && !screens.defeat.checkpoint && screens.defeat.toastVisibility === "hidden", "defeat clears the HUD, toast and reward layer");

  const quality = await page.evaluate(() => {
    const d = window.__whiteoutDebug; const step = (state, fps, hidden = false, locked = false) => d.qualityDecision(state, { fps, hidden, locked });
    let hiddenOnly = { low: false, lowStreak: 0, highStreak: 0, hold: 0 };
    for (let i = 0; i < 8; i++) hiddenOnly = step(hiddenOnly, 4, true);
    let live = { low: false, lowStreak: 0, highStreak: 0, hold: 0 };
    live = step(live, 10); live = step(live, 10); const beforeThird = live.low; live = step(live, 10);
    let recovery = live;
    for (let i = 0; i < 3; i++) recovery = step(recovery, 90);
    const duringHold = recovery.low;
    let guard = 0; while (recovery.low && guard++ < 12) recovery = step(recovery, 90);
    let rebound = recovery; for (let i = 0; i < 3; i++) rebound = step(rebound, 12);
    const appliedHidden = d.applyFpsSample(6, true);
    d.applyFpsSample(6, false); d.applyFpsSample(6, false); const appliedThird = d.applyFpsSample(6, false);
    return { renderer: d.stats().renderer, hiddenStayedHigh: !hiddenOnly.low, beforeThird, dropped: live.low, duringHold, restored: !recovery.low, reboundStayedHigh: !rebound.low, appliedHidden: appliedHidden.lowQuality, appliedThird: appliedThird.lowQuality };
  });
  assert(quality.hiddenStayedHigh && !quality.beforeThird && quality.dropped && quality.duringHold && quality.restored && quality.reboundStayedHigh, `quality drops after repeated stalls and restores without flickering (${JSON.stringify(quality)})`);
  assert(!quality.appliedHidden && quality.appliedThird, `a hidden-tab sample does not latch low quality on this renderer (${quality.renderer})`);

  assert(errors.length === 0, `browser runtime stayed free of page errors (${errors.join(" | ")})`);
  console.log("STABILITY OK");
} finally {
  await browser.close();
  server?.close();
}
