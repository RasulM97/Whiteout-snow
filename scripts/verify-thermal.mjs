import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".mp3": "audio/mpeg" };
const server = createServer(async (req, res) => {
  try {
    const raw = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const file = resolve(DIST, "." + decodeURIComponent(raw));
    if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file); res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" }); res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}/`;
const executablePath = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find((path) => existsSync(path));
if (!executablePath) throw new Error("No Chrome or Edge executable found");
const browser = await chromium.launch({ headless: true, executablePath });
const errors = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log("PASS:", message); };

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    if (!sessionStorage.getItem("thermal-ready")) { localStorage.removeItem("whiteout.career-v2"); sessionStorage.setItem("thermal-ready", "1"); }
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug, null, { timeout: 30000 });

  const edge = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.giveCredits(5000); d.teleport(0, 10);
    const hauler = d.build("hauler", 8, 18);
    let minTemp = 100; let frozen = false; let sawReturn = false;
    for (let i = 0; i < 30; i++) {
      d.teleport(0, 10); d.step(0.5);
      const r = d.robotStates().find((robot) => robot.buildingId === hauler);
      minTemp = Math.min(minTemp, r.temperature);
      if (r.frozen) frozen = true;
      if (r.mode === "warm-return" || r.mode === "patrol") sawReturn = true;
    }
    const r = d.robotStates().find((robot) => robot.buildingId === hauler);
    return { minTemp, frozen, mode: r.mode, temp: r.temperature, dist: Math.hypot(r.x, r.z - 10), sawReturn };
  });
  assert(!edge.frozen && edge.dist < 8 && edge.temp > 40, `edge dock returns into base heat (${JSON.stringify(edge)})`);

  const critical = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.giveCredits(5000); d.teleport(0, 10);
    const hauler = d.build("hauler", 16, 10);
    d.setRobotTemperature(hauler, 0, 6, false);
    let sawReturn = false; let frozen = false; let minTemp = 6;
    for (let i = 0; i < 24; i++) {
      d.teleport(0, 10); d.step(0.5);
      const r = d.robotStates().find((robot) => robot.buildingId === hauler);
      minTemp = Math.min(minTemp, r.temperature);
      if (r.mode === "warm-return") sawReturn = true;
      if (r.frozen) frozen = true;
    }
    const r = d.robotStates().find((robot) => robot.buildingId === hauler);
    return { sawReturn, frozen, minTemp, temp: r.temperature, dist: Math.hypot(r.x, r.z - 10), mode: r.mode };
  });
  assert(critical.sawReturn && !critical.frozen && critical.minTemp > 0 && critical.dist < 8 && critical.temp > 30, `critical temperature retreat reaches warmth (${JSON.stringify(critical)})`);

  const inside = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.giveCredits(500); d.teleport(0, 10);
    const hauler = d.build("hauler", 1, 10);
    d.setRobotTemperature(hauler, 0, 0, true);
    const start = d.robotStates().find((robot) => robot.buildingId === hauler);
    d.step(12);
    const end = d.robotStates().find((robot) => robot.buildingId === hauler);
    return { startFrozen: start.frozen, moved: Math.hypot(end.x - start.x, end.z - start.z), frozen: end.frozen, temp: end.temperature };
  });
  assert(inside.startFrozen && inside.moved < 1.5 && !inside.frozen && inside.temp >= 65, `frozen drone thaws in place inside heat (${JSON.stringify(inside)})`);

  const power = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.giveCredits(5000); d.teleport(0, 10);
    const hauler = d.build("hauler", 16, 10);
    const heater = d.build("heater", 16, 14);
    d.setRepairAllowed(hauler, 0, false);
    d.step(2);
    d.damageBuilding(heater);
    d.setRobotTemperature(hauler, 0, 5, false);
    let sawReturn = false; let frozen = false;
    for (let i = 0; i < 30; i++) {
      d.teleport(0, 10); d.step(0.5);
      const r = d.robotStates().find((robot) => robot.buildingId === hauler);
      if (r.mode === "warm-return") sawReturn = true;
      if (r.frozen) frozen = true;
    }
    const r = d.robotStates().find((robot) => robot.buildingId === hauler);
    const heaterState = d.snapshot().buildings.find((b) => b.id === heater);
    return { sawReturn, frozen, dist: Math.hypot(r.x, r.z - 10), temp: r.temperature, heaterDamaged: heaterState.damaged, heaterPowered: d.powerState().find((b) => b.id === heater).powered };
  });
  assert(power.sawReturn && !power.frozen && power.dist < 8 && power.temp > 20 && power.heaterDamaged && !power.heaterPowered, `dead heater is abandoned for base heat (${JSON.stringify(power)})`);

  const repair = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.giveCredits(8000); d.teleport(0, 10);
    const hauler = d.build("hauler", 4, 16);
    const purifier = d.build("purifier", 14, 16);
    d.damageBuilding(purifier);
    const cost = d.snapshot().buildings.find((b) => b.id === purifier).repairCost;
    const credits = d.snapshot().credits;
    let progress = 0; let caught = null;
    for (let i = 0; i < 80 && !caught; i++) {
      d.step(0.2);
      const r = d.robotStates().find((robot) => robot.buildingId === hauler);
      progress = r.rescueProgress;
      if (progress > 0.7 && d.snapshot().buildings.find((b) => b.id === purifier).damaged) caught = { progress, destinationId: r.destinationId };
    }
    if (!caught) return { caught: null };
    d.setRobotTemperature(hauler, 0, 4, false);
    d.step(0.6);
    const mid = d.robotStates().find((robot) => robot.buildingId === hauler);
    let repaired = false;
    for (let i = 0; i < 50 && !repaired; i++) { d.teleport(0, 10); d.step(1); repaired = !d.snapshot().buildings.find((b) => b.id === purifier).damaged; }
    return { caught, mid: { progress: mid.rescueProgress, destinationId: mid.destinationId, mode: mid.mode, frozen: mid.frozen }, repaired, spent: credits - d.snapshot().credits, cost };
  });
  assert(repair.caught && repair.mid.progress >= repair.caught.progress - 0.05 && repair.mid.destinationId === repair.caught.destinationId && repair.mid.destinationId === repair.caught.destinationId && !repair.mid.frozen && (repair.mid.mode === "warm-return" || repair.mid.mode === "recharge"), `retreat keeps the weld and the claim (${JSON.stringify(repair)})`);
  assert(repair.repaired && repair.spent === repair.cost, `interrupted repair finishes once and charges once (${JSON.stringify(repair)})`);

  const pair = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.giveCredits(8000); d.teleport(0, 10);
    const a = d.build("hauler", 16, 14);
    const b = d.build("hauler", -16, 14);
    const east = d.build("purifier", 14, 16);
    const west = d.build("generator", -14, 16);
    d.damageBuilding(east); d.damageBuilding(west);
    const costs = d.snapshot().buildings.filter((building) => building.id === east || building.id === west).reduce((sum, building) => sum + building.repairCost, 0);
    const credits = d.snapshot().credits;
    let claimed = null;
    for (let i = 0; i < 20 && !claimed; i++) {
      d.step(0.25);
      const robots = d.robotStates().filter((robot) => robot.kind === "hauler");
      const da = robots.find((robot) => robot.buildingId === a).destinationId;
      const db = robots.find((robot) => robot.buildingId === b).destinationId;
      if (da > 0 && db > 0 && da !== db) claimed = { da, db };
    }
    if (!claimed) return { claimed: null, robots: d.robotStates().filter((robot) => robot.kind === "hauler") };
    d.setRobotTemperature(a, 0, 3, false);
    d.step(0.4);
    const midA = d.robotStates().find((robot) => robot.buildingId === a);
    const midB = d.robotStates().find((robot) => robot.buildingId === b);
    let both = false;
    for (let i = 0; i < 60 && !both; i++) { d.teleport(0, 10); d.step(1); both = d.snapshot().buildings.filter((building) => (building.id === east || building.id === west) && building.damaged).length === 0; }
    return { claimed, midA: { destinationId: midA.destinationId, mode: midA.mode, frozen: midA.frozen }, midB: { destinationId: midB.destinationId, mode: midB.mode }, both, spent: credits - d.snapshot().credits, costs };
  });
  assert(pair.claimed && pair.midA.destinationId === pair.claimed.da && pair.midB.destinationId === pair.claimed.db && !pair.midA.frozen && (pair.midA.mode === "warm-return" || pair.midA.mode === "recharge"), `retreating drone keeps its own target (${JSON.stringify(pair)})`);
  assert(pair.both && pair.spent === pair.costs, `both reserved repairs finish without a second charge (${JSON.stringify(pair)})`);

  const beforeSave = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.giveCredits(5000); d.teleport(0, 10);
    const hauler = d.build("hauler", 16, 10);
    const purifier = d.build("purifier", 14, 18);
    d.damageBuilding(purifier);
    d.step(1.2);
    d.setRobotTemperature(hauler, 0, 5, false);
    d.step(0.4);
    const robot = d.robotStates().find((unit) => unit.buildingId === hauler);
    d.save();
    return { hauler, purifier, x: robot.x, z: robot.z, temp: robot.temperature, mode: robot.mode, destinationId: robot.destinationId, progress: robot.rescueProgress, frozen: robot.frozen };
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug, null, { timeout: 30000 });
  await page.click("#continue-btn");
  await page.waitForFunction(() => document.querySelector("#title-screen").classList.contains("hidden"), null, { timeout: 10000 });
  const reloaded = await page.evaluate((saved) => {
    const d = window.__whiteoutDebug;
    const robot = d.robotStates().find((unit) => unit.buildingId === saved.hauler);
    const jumped = Math.hypot(robot.x - saved.x, robot.z - saved.z);
    let frozen = robot.frozen; let arrived = false;
    for (let i = 0; i < 30; i++) {
      d.teleport(0, 10); d.step(0.5);
      const next = d.robotStates().find((unit) => unit.buildingId === saved.hauler);
      if (next.frozen) frozen = true;
      if (Math.hypot(next.x, next.z - 10) < 8 && next.temperature > saved.temp) arrived = true;
    }
    const end = d.robotStates().find((unit) => unit.buildingId === saved.hauler);
    const repaired = !d.snapshot().buildings.find((b) => b.id === saved.purifier).damaged;
    return { jumped, mode: robot.mode, temp: robot.temp ?? robot.temperature, destinationId: robot.destinationId, progress: robot.rescueProgress, frozen: robot.frozen, laterFrozen: frozen, arrived, endTemp: end.temperature, repaired };
  }, beforeSave);
  assert(beforeSave.mode === "warm-return" && !beforeSave.frozen && reloaded.jumped < 8 && !reloaded.frozen && reloaded.destinationId === beforeSave.destinationId && reloaded.progress + 0.05 >= beforeSave.progress, `save restores an in-progress thermal retreat (${JSON.stringify({ beforeSave, reloaded })})`);
  assert(!reloaded.laterFrozen && reloaded.arrived && reloaded.endTemp > beforeSave.temp, `reloaded retreat finishes warming (${JSON.stringify(reloaded)})`);

  const manual = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.giveCredits(400); d.teleport(0, 10);
    const hauler = d.build("hauler", 4, 16);
    d.freezeRobot(hauler);
    const start = d.robotStates().find((robot) => robot.buildingId === hauler);
    const credits = d.snapshot().credits;
    d.teleport(start.x, start.z);
    const first = d.rescueAt(start.x, start.z);
    d.step(0.3);
    const mid = d.robotStates().find((robot) => robot.buildingId === hauler);
    for (let i = 0; i < 8; i++) { d.teleport(start.x, start.z); d.step(0.5); }
    const end = d.robotStates().find((robot) => robot.buildingId === hauler);
    return { first, spent: credits - d.snapshot().credits, held: Math.hypot(mid.x - start.x, mid.z - start.z), midFrozen: mid.frozen, frozen: end.frozen, temp: end.temperature };
  });
  assert(manual.first === "started" && manual.spent === 150 && manual.midFrozen && manual.held < 1.2 && !manual.frozen, `player thaw still recovers a frozen drone outside heat (${JSON.stringify(manual)})`);

  const sustained = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.giveCredits(30000); d.teleport(0, 10);
    const sweeper = d.build("sweeper", 14, 10);
    const purifier = d.build("purifier", 8, 16);
    const hauler = d.build("hauler", 4, 16);
    d.build("heater", 8, 10); d.build("heater", 14, 16); d.build("heater", 18, 12);
    d.rail(sweeper, purifier); d.rail(purifier);
    d.teleport(14, 10); d.upgradeNearest(); d.upgradeNearest(); d.buyExtraRobot(sweeper); d.buyExtraRobot(sweeper);
    d.teleport(0, 10);
    const fields = ["gather", "travel", "unload", "inefficient", "idle", "blocked", "useful", "waste"];
    const stat = Object.fromEntries(fields.map((key) => [key, 0]));
    const prev = {}; const hist = {};
    let retreats = 0; let lastMode = ""; let minTemp = 100; let maxTemp = 0; let frozenWhileHealthy = 0; let frozenSamples = 0;
    let maxDamage = 0; let damageFor = 0; let duplicate = 0; let haulerRepairs = 0; const repaired = new Set();
    for (let i = 0; i < 1440; i++) {
      if (i % 20 === 0) d.teleport(0, 10);
      d.step(0.5);
      const snap = d.snapshot();
      if (snap.state !== "playing") return { failed: snap.state, second: i / 2 };
      const stock = d.logistics();
      const home = stock.buildings.find((b) => b.id === hauler);
      const robot = d.robotStates().find((r) => r.buildingId === hauler);
      minTemp = Math.min(minTemp, robot.temperature); maxTemp = Math.max(maxTemp, robot.temperature);
      if (robot.frozen) { frozenSamples++; if (!home.damaged) frozenWhileHealthy++; }
      if ((robot.mode === "warm-return") && lastMode !== "warm-return") retreats++;
      lastMode = robot.mode;
      if (robot.mode === "repair" || robot.mode === "repair-return") haulerRepairs++;
      for (const building of stock.buildings) if (!building.damaged && building.type !== "heater") repaired.add(building.id);
      damageFor = stock.buildings.some((b) => b.damaged) ? damageFor + 0.5 : 0;
      maxDamage = Math.max(maxDamage, damageFor);
      const dock = stock.buildings.find((b) => b.id === sweeper);
      const full = dock.output >= dock.outputCapacity - 0.05;
      const sweepers = d.robotStates().filter((r) => r.buildingId === sweeper);
      const seen = {};
      for (const r of sweepers) {
        if (r.activeChunk >= 0) seen[r.activeChunk] = (seen[r.activeChunk] || 0) + 1;
        const was = prev[r.slot];
        const moved = was ? Math.hypot(r.x - was.x, r.z - was.z) : 1;
        const delta = was ? r.carry - was.carry : 0;
        const goal = r.carry > 0.3 ? { x: 16.25, z: 10 } : (r.targetX == null ? null : { x: r.targetX, z: r.targetZ });
        const goalChanged = !goal || !was?.goal || Math.hypot(goal.x - was.goal.x, goal.z - was.goal.z) >= 1.5;
        if (!hist[r.slot] || goalChanged) hist[r.slot] = [];
        const distNow = goal ? Math.hypot(r.x - goal.x, r.z - goal.z) : null;
        if (distNow != null) hist[r.slot].push(distNow);
        if (hist[r.slot].length > 4) hist[r.slot].shift();
        const older = hist[r.slot][0];
        const netClosing = distNow != null && older != null && hist[r.slot].length >= 4 && distNow < older - 0.25;
        let closing = goalChanged && moved > 0.15;
        if (!goalChanged && was?.goal && distNow != null) closing = distNow < Math.hypot(was.x - was.goal.x, was.z - was.goal.z) - 0.04 || netClosing;
        let bucket = "idle";
        if (r.frozen || r.mode === "warm-return" || r.mode === "recharge" || r.mode === "funding" || r.mode === "damaged" || (full && r.carry > 0.3 && (r.mode === "unload" || r.mode === "return"))) bucket = "blocked";
        else if (r.mode === "gather" || delta > 0.05) bucket = "gather";
        else if (delta < -0.05) bucket = "unload";
        else if ((r.mode === "seek" || r.mode === "return") && closing) bucket = "travel";
        else if ((r.mode === "seek" || r.mode === "return" || r.mode === "expand") && moved > 0.35 && goal && !closing && !netClosing && hist[r.slot].length >= 4) bucket = "inefficient";
        else if (moved <= 0.08) bucket = "idle";
        else if (!closing && hist[r.slot].length >= 4) bucket = "inefficient";
        else bucket = "travel";
        stat[bucket] += 0.5;
        const calm = snap.stormPhase !== "storm" && bucket !== "blocked";
        if (calm && (bucket === "gather" || bucket === "travel" || bucket === "unload")) stat.useful += 0.5;
        if (calm && (bucket === "inefficient" || bucket === "idle")) stat.waste += 0.5;
        prev[r.slot] = { x: r.x, z: r.z, carry: r.carry, goal };
      }
      if (Object.values(seen).some((count) => count > 1)) duplicate += 0.5;
    }
    const end = d.robotStates().find((r) => r.buildingId === hauler);
    const damaged = d.logistics().buildings.filter((b) => b.damaged).map((b) => b.type);
    return { retreats, minTemp, maxTemp, frozenWhileHealthy, frozenSamples, maxDamage, duplicate, haulerRepairs, end, damaged, efficiency: stat.useful / Math.max(0.1, stat.useful + stat.waste), useful: stat.useful, waste: stat.waste, produced: d.snapshot().produced, state: d.snapshot().state };
  });
  console.log("SUSTAINED", JSON.stringify(sustained));
  assert(!sustained.failed && sustained.frozenWhileHealthy === 0 && sustained.end && !sustained.end.frozen && sustained.minTemp > 0, `12-minute patrol no longer freezes a healthy drone (${JSON.stringify({ min: sustained.minTemp, frozen: sustained.frozenWhileHealthy, end: sustained.end, damaged: sustained.damaged })})`);
  assert(sustained.maxDamage < 30 && sustained.haulerRepairs > 0, `storm damage is repaired instead of waiting on a frozen drone (${JSON.stringify({ maxDamage: sustained.maxDamage, repairs: sustained.haulerRepairs, retreats: sustained.retreats })})`);
  assert(sustained.efficiency >= 0.85 && sustained.duplicate === 0, `sweeper efficiency holds under the same yard (${JSON.stringify({ efficiency: sustained.efficiency, useful: sustained.useful, waste: sustained.waste, duplicate: sustained.duplicate })})`);
  assert(errors.length === 0, `no page errors ${errors.join(" | ")}`);
  console.log("THERMAL VERIFY OK");
} finally {
  await browser.close();
  server.close();
}
