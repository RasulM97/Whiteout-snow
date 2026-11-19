import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".mp3": "audio/mpeg" };
const server = createServer(async (req, res) => {
  try {
    const raw = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const file = resolve(DIST, "." + decodeURIComponent(raw));
    if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const origin = `http://127.0.0.1:${server.address().port}/`;
const executablePath = [process.env.CHROMIUM_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((path) => path && existsSync(path));
if (!executablePath) throw new Error("No Chrome executable found");
const browser = await chromium.launch({ headless: true, executablePath });
const errors = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log("PASS:", message); };

async function openGame() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000);
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
    if (!sessionStorage.getItem("batch2-keep")) { localStorage.removeItem("whiteout.career-v2"); sessionStorage.setItem("batch2-keep", "1"); }
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug, null, { timeout: 30000 });
  const debug = (expression, ...args) => page.evaluate(({ expression, args }) => {
    let target = window.__whiteoutDebug;
    for (const part of expression.split(".")) target = target[part];
    return typeof target === "function" ? target(...args) : target;
  }, { expression, args });
  return { page, debug };
}

try {
  const { page, debug } = await openGame();
  const snap = () => debug("snapshot");
  await debug("start"); await debug("setQuest", 8); await debug("giveCredits", 20000);

  const identity = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const ids = ["hands", "shovel", "brush", "blower", "vacuum"];
    const tiers = Object.fromEntries(ids.map((id) => [id, d.toolStats(id, 4)]));
    const sample = async () => null;
    void sample;
    const clear = (id) => {
      d.start(); d.setQuest(8); d.giveCredits(8000); d.teleport(32, 28);
      if (id !== "hands") d.buyTool(id);
      d.selectTool(id);
      const before = { mass: d.snowMass(), raw: d.snapshot().raw, heat: d.snapshot().heat, health: d.snapshot().toolHealth[id] };
      d.holdClear(true); d.step(0.8); d.holdClear(false);
      const after = d.snapshot();
      return { id, removed: before.mass - d.snowMass(), gained: after.raw - before.raw, heat: before.heat - after.heat, wear: before.health - after.toolHealth[id], yield: d.toolStats(id, 1).yield };
    };
    return { tiers, hands: clear("hands"), brush: clear("brush"), vacuum: clear("vacuum"), blower: clear("blower"), shovel: clear("shovel") };
  });
  for (const sample of [identity.hands, identity.brush, identity.vacuum, identity.blower, identity.shovel]) {
    assert(sample.removed > 0.2 && sample.gained > 0 && sample.gained <= sample.removed + 0.05, `${sample.id} converts removed snow into cargo without creating any (${JSON.stringify(sample)})`);
  }
  assert(identity.hands.gained / identity.hands.removed > identity.vacuum.gained / identity.vacuum.removed && identity.vacuum.gained / identity.vacuum.removed > identity.brush.gained / identity.brush.removed, `recovery order is hands, then vacuum, then brush (${JSON.stringify({ hands: identity.hands, vacuum: identity.vacuum, brush: identity.brush })})`);
  assert(identity.vacuum.wear > identity.hands.wear && identity.blower.heat + 0.12 < identity.vacuum.heat, `vacuum wears faster and the blower keeps more heat (${JSON.stringify({ hands: identity.hands, vacuum: identity.vacuum, blower: identity.blower })})`);
  assert(identity.tiers.brush.radius > identity.tiers.vacuum.radius && identity.tiers.vacuum.capacity > identity.tiers.brush.capacity && identity.tiers.blower.distance > identity.tiers.vacuum.distance && identity.tiers.shovel.wade === 1 && identity.tiers.hands.yield > identity.tiers.vacuum.yield, "tier 4 still separates reach, haul, film, crust and salvage");

  const travel = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const walk = (id) => {
      d.start(); d.setQuest(8); d.giveCredits(4000); d.teleport(32, 28);
      if (id !== "hands") d.buyTool(id);
      d.selectTool(id);
      const start = window.__gameProbe();
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }));
      d.step(1.5);
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD", bubbles: true }));
      const end = window.__gameProbe();
      return Math.hypot(end.x - start.x, end.z - start.z);
    };
    return { hands: walk("hands"), shovel: walk("shovel") };
  });
  assert(travel.shovel > travel.hands * 1.12, `the shovel crosses deep snow faster than hands (${JSON.stringify(travel)})`);

  const orders = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.setQuest(8); d.giveCredits(20000); d.teleport(0, 10);
    const heater = d.build("heater", 0, 16);
    const supply = d.build("sweeper", -8, 8);
    const roaming = d.build("sweeper", 8, 6);
    d.setRobotZoneMode(supply, 0, "supply");
    d.setRobotZoneMode(roaming, 0, "auto");
    for (let x = -34; x <= 34; x += 7) for (let z = -16; z <= 34; z += 7) d.clearAt(x, z, 8);
    d.step(8);
    const robots = d.robotStates();
    const shelterDock = d.build("sweeper", 0, 12);
    d.setRobotZoneMode(shelterDock, 0, "shelter");
    d.step(6);
    const sheltered = d.robotStates().find((robot) => robot.buildingId === shelterDock);
    const center = sheltered.activeChunk >= 0 ? d.snapshot().chunks.find((chunk) => chunk.id === sheltered.activeChunk) : null;
    return {
      heater, supply: robots.find((robot) => robot.buildingId === supply),
      roaming: robots.find((robot) => robot.buildingId === roaming),
      sheltered, center,
    };
  });
  assert(orders.supply.zoneMode === "supply" && orders.supply.searchRange <= 28 && orders.roaming.searchRange > orders.supply.searchRange, `supply stays on short runs while auto expands (${JSON.stringify({ supply: orders.supply.searchRange, auto: orders.roaming.searchRange })})`);
  const shelterDistance = orders.center ? Math.hypot(orders.center.x, orders.center.z - 10) : 0;
  assert(orders.sheltered.zoneMode === "shelter" && (!orders.center || shelterDistance < 16), `shelter keeps the sweeper on heated ground (${JSON.stringify({ mode: orders.sheltered.zoneMode, center: orders.center, shelterDistance })})`);

  const warning = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.setQuest(8); d.giveCredits(20000);
    const outerGen = d.build("generator", 24, 10);
    const outer = d.build("sweeper", 30, 10);
    d.teleport(24, 10); d.upgradeNearest(); d.upgradeNearest(); d.teleport(0, 10);
    let guard = 0;
    while (d.snapshot().stormPhase === "calm" && guard < 14) { d.step(20); guard++; }
    const state = d.snapshot();
    return { outerGen, outer, phase: state.stormPhase, time: state.runTime, eta: state.stormEta, toast: document.getElementById("toast")?.textContent ?? "", robots: d.robotStates().map((robot) => ({ x: robot.x, z: robot.z, mode: robot.zoneMode, buildingId: robot.buildingId })) };
  });
  assert(warning.outerGen && warning.outer && warning.toast.includes("Shelter"), `a storm warning names the shelter choice when sweepers are outside heat (${JSON.stringify(warning)})`);

  await debug("buyTool", "vacuum"); await debug("setRobotZoneMode", warning.outer, 0, "supply"); await debug("save");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  await page.click("#continue-btn");
  const kept = await page.evaluate(() => {
    const saved = window.__whiteoutDebug.snapshot();
    const robot = window.__whiteoutDebug.robotStates().find((unit) => unit.kind === "sweeper" && unit.zoneMode === "supply");
    const stored = JSON.parse(localStorage.getItem("whiteout.career-v2") ?? "{}");
    return { version: stored.version, vacuum: saved.tools.vacuum, quest: saved.quest.index, mode: robot?.zoneMode ?? "missing" };
  });
  assert(kept.version === 11 && kept.vacuum === 1 && kept.quest === 8 && kept.mode === "supply", `schema 11 keeps the purchased vacuum and the supply order (${JSON.stringify(kept)})`);

  const fleet = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.setQuest(9); d.giveCredits(250000); d.teleport(0, 10);
    const place = (type, x, z) => d.build(type, x, z);
    const ids = {
      purifierA: place("purifier", 4, 16), purifierB: place("purifier", 22, 2), press: place("press", -4, 16),
      heaterBase: place("heater", 0, 18), hauler: place("hauler", 8, 14),
      sweeperA: place("sweeper", -8, 8), sweeperB: place("sweeper", 8, 4),
      genEast: place("generator", 22, 10), genWest: place("generator", -22, 10),
      sweeperC: place("sweeper", 22, 20), sweeperD: place("sweeper", 34, 10), heaterEast: place("heater", 16, 8),
      sweeperE: place("sweeper", -22, 20), sweeperF: place("sweeper", -34, 10), heaterWest: place("heater", -16, 8),
      genFoundry: place("generator", -40, 12), genServo: place("generator", 36, 24), genGale: place("generator", -34, -28),
    };
    const buildings = Object.entries(ids);
    for (const [, id] of buildings) {
      const building = d.snapshot().buildings.find((item) => item.id === id); if (!building) continue;
      d.teleport(building.x, building.z); d.upgradeNearest(); d.upgradeNearest();
    }
    for (const id of [ids.sweeperA, ids.sweeperB, ids.sweeperC, ids.sweeperD, ids.sweeperE, ids.sweeperF]) { d.buyExtraRobot(id); d.buyExtraRobot(id); }
    for (const id of [ids.sweeperA, ids.sweeperB, ids.sweeperC]) d.rail(id, ids.purifierA);
    for (const id of [ids.sweeperD, ids.sweeperE, ids.sweeperF]) d.rail(id, ids.purifierB);
    d.rail(ids.purifierA, 0); d.rail(ids.purifierB, 0); d.rail(ids.press, 0);
    const relays = { gale: d.repairRelay("gale"), servo: d.repairRelay("servo"), foundry: d.repairRelay("foundry") };
    d.teleport(0, 10); d.step(1);
    const state = d.snapshot(); const power = d.powerState();
    return {
      ids, relays, robots: d.robotStates().filter((robot) => robot.kind === "sweeper").length,
      poweredSweepers: state.buildings.filter((building) => building.type === "sweeper" && building.powered).length,
      unpowered: power.filter((item) => !item.powered).map((item) => item.id),
      credits: state.credits, sold: state.sold,
    };
  });
  assert(fleet.robots === 18 && fleet.poweredSweepers === 6 && fleet.relays.gale && fleet.relays.servo && fleet.relays.foundry, `18 sweepers, six docks and three relays are powered (${JSON.stringify({ robots: fleet.robots, docks: fleet.poweredSweepers, relays: fleet.relays, unpowered: fleet.unpowered })})`);

  await page.waitForTimeout(1500);
  const perf = await debug("frameStats");
  const ledger = { credits: fleet.credits, sold: fleet.sold };
  const samples = [];
  let certified = false;
  for (let slice = 0; slice < 24 && !certified; slice++) {
    await debug("step", 150);
    const state = await snap();
    for (const building of state.buildings) if (building.damaged) await debug("repairBuilding", building.id);
    await debug("teleport", 0, 10);
    certified = state.cleanupCertified || state.cleanupPercent >= 95;
    const fresh = state.chunks.filter((chunk) => chunk.remaining >= 0.55 && chunk.progress < 0.45);
    const dust = state.chunks.filter((chunk) => chunk.remaining >= 0.55 && chunk.progress >= 0.45);
    const mass = (list) => Math.round(list.reduce((sum, chunk) => sum + chunk.remaining, 0));
    const far = (list) => list.filter((chunk) => Math.hypot(chunk.x, chunk.z - 10) > 40).length;
    const robots = await debug("robotStates");
    const sweepers = robots.filter((robot) => robot.kind === "sweeper");
    samples.push({ minute: Number((state.runTime / 60).toFixed(1)), cleanup: Number(state.cleanupPercent.toFixed(2)), certified: state.cleanupCertified, state: state.state, frozen: state.buildings.reduce((sum, building) => sum + (building.robots?.filter((robot) => robot.frozen).length ?? 0), 0) });
    const idle = sweepers.find((robot) => robot.mode === "wait") ?? sweepers[0];
    const richest = [...state.chunks].filter((chunk) => chunk.remaining >= 0.55).sort((a, b) => b.remaining - a.remaining).slice(0, 3).map((chunk) => ({ id: chunk.id, mass: Math.round(chunk.remaining), progress: Number(chunk.progress.toFixed(2)), x: Math.round(chunk.x), z: Math.round(chunk.z) }));
    console.log("CLEARANCE", JSON.stringify({ ...samples.at(-1), fresh: fresh.length, freshFar: far(fresh), freshMass: mass(fresh), dust: dust.length, dustMass: mass(dust), out: sweepers.filter((robot) => Math.hypot(robot.x, robot.z - 10) > 40).length, range: Math.round(Math.max(0, ...sweepers.map((robot) => robot.searchRange))), modes: sweepers.reduce((counts, robot) => { counts[robot.mode] = (counts[robot.mode] ?? 0) + 1; return counts; }, {}), idle: idle ? { mode: idle.mode, chunk: idle.activeChunk, ids: idle.chunkIds, progress: Number(idle.chunkProgress.toFixed(2)), x: Math.round(idle.x), z: Math.round(idle.z) } : null, richest }));
    if (state.state !== "playing") break;
  }
  const reached = samples.at(-1);
  assert(reached.certified && reached.state === "playing" && samples.some((sample) => sample.cleanup >= 92), `95% is reached under live storms (${JSON.stringify(samples)})`);
  const beforeStorm = await snap();
  await debug("storm"); await debug("step", 30); await debug("storm", true); await debug("step", 40);
  for (const building of (await snap()).buildings) if (building.damaged) await debug("repairBuilding", building.id);
  const afterStorm = await snap();
  const poweredAfter = (await debug("powerState")).filter((item) => item.powered && afterStorm.buildings.find((building) => building.id === item.id && building.type === "sweeper")).length;
  assert(afterStorm.cleanupCertified && afterStorm.state === "playing" && poweredAfter === 6, `certification survives the following storms and the docks stay powered (${JSON.stringify({ before: beforeStorm.cleanupPercent, after: afterStorm.cleanupPercent, certified: afterStorm.cleanupCertified, poweredAfter, minute: Number((afterStorm.runTime / 60).toFixed(1)) })})`);
  assert(afterStorm.credits <= ledger.credits + (afterStorm.sold - ledger.sold) + 1, `credits only move through recorded sales and repairs (${JSON.stringify({ before: ledger, after: { credits: afterStorm.credits, sold: afterStorm.sold } })})`);
  assert(perf.calls > 0 && perf.fps > 15, `full base stays renderable (${JSON.stringify(perf)})`);
  assert(errors.length === 0, `no page errors ${errors.join(" | ")}`);
  console.log("BATCH2 VERIFY OK");
} finally {
  await browser.close();
  server.close();
}
