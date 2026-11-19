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
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
    if (!sessionStorage.getItem("systems-keep")) { localStorage.removeItem("whiteout.career-v2"); sessionStorage.setItem("systems-keep", "1"); }
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

const { page, debug } = await openGame();
try {
  await debug("start");
  const dock = await debug("build", "sweeper", 8, -6);
  const chunk = await debug("snowAt", 8, -6).then(() => page.evaluate(() => {
    const snow = window.__whiteoutDebug;
    const robot = snow.robotStates()[0];
    return robot;
  }));
  await debug("setRobotZoneMode", dock, 0, "custom", chunk.activeChunk >= 0 ? chunk.activeChunk : 40);
  const samples = [];
  for (let i = 0; i < 16; i++) {
    await debug("step", 0.45);
    const robot = (await debug("robotStates")).find((unit) => unit.id === dock);
    samples.push({ x: robot.targetX, z: robot.targetZ, lane: robot.lane, sweep: robot.sweep, mode: robot.mode, chunk: robot.activeChunk });
  }
  const lanes = samples.filter((sample) => sample.x !== null);
  let monotonic = 0; let bestRun = 0;
  for (let i = 1; i < lanes.length; i++) {
    if (lanes[i].lane === lanes[i - 1].lane && Math.abs(lanes[i].z - lanes[i - 1].z) < 1.2 && Math.abs(lanes[i].sweep - lanes[i - 1].sweep) > 0.2) {
      const direction = Math.sign(lanes[i].sweep - lanes[i - 1].sweep);
      const previous = i > 1 ? Math.sign(lanes[i - 1].sweep - lanes[i - 2].sweep) : direction;
      monotonic = direction !== 0 && direction === previous ? monotonic + 1 : 1;
      bestRun = Math.max(bestRun, monotonic);
    }
  }
  const jumped = lanes.some((sample, index) => index > 0 && sample.lane === lanes[index - 1].lane && Math.hypot((sample.x ?? 0) - (lanes[index - 1].x ?? 0), (sample.z ?? 0) - (lanes[index - 1].z ?? 0)) > 6);
  const turn = lanes.findIndex((sample, index) => index > 0 && sample.lane !== lanes[index - 1].lane);
  const turned = turn > 0 && Math.abs(lanes[turn].z - lanes[turn - 1].z) > 1 && Math.abs(lanes[turn].z - lanes[turn - 1].z) < 4 && Math.abs(lanes[turn].sweep - lanes[turn - 1].sweep) < 6;
  assert(bestRun >= 2 && !jumped && turned, `one sweeper follows a lane and turns into the next (${JSON.stringify({ bestRun, jumped, turned, tail: lanes.slice(-4) })})`);

  await debug("start");
  const docks = [];
  for (const [x, z] of [[8, -6], [-14, 8], [16, 18]]) docks.push(await debug("build", "sweeper", x, z));
  await debug("step", 2);
  const assigned = new Set((await debug("robotStates")).map((robot) => robot.activeChunk).filter((id) => id >= 0));
  assert(docks.every((id) => id) && assigned.size >= 2, `three sweepers take different chunks (${JSON.stringify([...assigned])})`);

  await debug("start");
  for (const [x, z] of [[8, 4], [-8, 4], [8, 16], [-8, 16]]) assert(await debug("build", "generator", x, z), `generator pad ${x},${z} links`);
  let placed = 0;
  for (let i = 0; i < 18; i++) {
    const angle = i / 18 * Math.PI * 2;
    const id = await debug("build", "sweeper", Math.round(Math.cos(angle) * 11), Math.round(10 + Math.sin(angle) * 11));
    if (id) placed++;
  }
  await debug("step", 1);
  const yard = await debug("snapshot");
  const liveIds = new Set((await debug("powerState")).filter((building) => building.powered).map((building) => building.id));
  const powered = yard.buildings.filter((building) => building.type === "sweeper" && liveIds.has(building.id)).length;
  await page.waitForTimeout(2500);
  const stats = await debug("frameStats");
  assert(placed >= 12 && stats.calls > 0 && stats.fps > 15, `18-robot yard stays runnable (${JSON.stringify({ placed, powered, ...stats })})`);

  await debug("start");
  const rock = (await debug("obstacles")).find((obstacle) => obstacle.r < 1.3 && Math.hypot(obstacle.x, obstacle.z - 10) > 24);
  await debug("teleport", rock.x - rock.r - 0.85, rock.z);
  await page.keyboard.down("KeyD");
  let closest = Infinity;
  for (let i = 0; i < 8; i++) {
    await debug("step", 0.16);
    const probe = await page.evaluate(() => window.__gameProbe());
    closest = Math.min(closest, Math.hypot(probe.x - rock.x, probe.z - rock.z));
  }
  await page.keyboard.up("KeyD");
  assert(closest > rock.r * 0.55, `player slides around solid ground instead of passing through (${JSON.stringify({ closest, rock })})`);
  assert(await debug("build", "generator", Math.round(rock.x - 4), Math.round(rock.z - 2)), "a generator beside the rock links");
  const rover = await debug("build", "sweeper", Math.round(rock.x - 8), Math.round(rock.z));
  let clipped = false; let moved = 0; let last = null;
  for (let i = 0; i < 10; i++) {
    await debug("step", 0.4);
    const robot = (await debug("robotStates")).find((unit) => unit.id === rover);
    if (last) moved += Math.hypot(robot.x - last.x, robot.z - last.z);
    last = robot;
    if (Math.hypot(robot.x - rock.x, robot.z - rock.z) < rock.r * 0.45) clipped = true;
  }
  assert(rover && !clipped && moved > 1, `sweeper routes around the rock (${JSON.stringify({ clipped, moved })})`);

  const mountain = (await debug("vista"))[0];
  const rim = Math.hypot(mountain.x, mountain.z);
  await debug("teleport", mountain.x / rim * 60, mountain.z / rim * 60);
  await debug("setAzimuth", Math.atan2(mountain.x, mountain.z));
  await page.waitForTimeout(400);
  const camera = await debug("cameraPose");
  const inside = (await debug("vista")).some((peak) => Math.hypot(camera.x - peak.x, camera.z - peak.z) < peak.r);
  assert(!inside && camera.y > 18, `camera stays outside backdrop mountains (${JSON.stringify(camera)})`);

  await debug("start");
  assert(await debug("build", "generator", 30, 10), "near generator links to the base");
  const far = await debug("build", "generator", 30, 62);
  const farState = (await debug("powerState")).find((building) => building.id === far);
  assert(far && farState.powered && farState.cable, `a generator beyond 68 m links through the first (${JSON.stringify(farState)})`);
  assert(!(await debug("build", "generator", 60, -60)), "a generator with no cable path is refused");
  const remoteHeater = await debug("build", "heater", 30, 58);
  const remoteSweeper = await debug("build", "sweeper", 34, 58);
  await debug("step", 0.3);
  const remotePower = await debug("powerState");
  assert(remotePower.find((building) => building.id === remoteHeater)?.powered && remotePower.find((building) => building.id === remoteSweeper)?.powered, "remote heater and sweeper run from the outpost");
  await debug("setRobotZoneMode", remoteSweeper, 0, "custom");
  const before = (await debug("snapshot")).cleanupPercent;
  await debug("step", 20);
  const cleared = (await debug("snapshot")).cleanupPercent;
  await debug("giveCredits", 2000);
  await debug("storm"); await debug("step", 30);
  for (const building of (await debug("snapshot")).buildings) if (building.damaged) await debug("repairBuilding", building.id);
  const bottom = (await debug("snapshot")).cleanupPercent;
  await debug("step", 20);
  const after = (await debug("snapshot")).cleanupPercent;
  assert(cleared > before + 0.4 && after + 0.02 >= bottom && after > before, `a heated outpost keeps its clearance through a storm (${JSON.stringify({ before, cleared, bottom, after })})`);

  await debug("start");
  await debug("setQuest", 2); await debug("giveCredits", 4000);
  for (const id of ["gale", "servo", "foundry"]) assert(await debug("repairRelay", id), `${id} restoration stays a paid repair`);
  await debug("step", 0.2);
  let relays = (await debug("snapshot")).relays;
  assert(relays.every((relay) => relay.repaired && !relay.powered) && !(await debug("snapshot")).galeLive, "restored relays stay dark until a generator reaches them");
  const purifier = await debug("build", "purifier", 3, -2);
  await debug("step", 0.2);
  const bareRate = (await debug("snapshot")).buildings.find((building) => building.id === purifier).productionRate;
  assert(await debug("build", "generator", -40, 12), "foundry outpost links");
  await debug("step", 0.4);
  const foundryRate = (await debug("snapshot")).buildings.find((building) => building.id === purifier).productionRate;
  const foundry = (await debug("snapshot")).relays.find((relay) => relay.id === "foundry");
  assert(foundry.powered && foundryRate > bareRate * 1.2, `foundry raises throughput only while powered (${JSON.stringify({ bareRate, foundryRate })})`);
  assert(await debug("build", "generator", -28, -24) && await debug("build", "generator", -32, -34), "gale outpost chains into the weather array");
  assert(await debug("build", "generator", 40, 28), "servo outpost links");
  await debug("step", 0.4);
  relays = (await debug("snapshot")).relays;
  assert(relays.every((relay) => relay.powered) && (await debug("snapshot")).galeLive, "all three relays come online with electricity");
  const forecast = await page.locator("#storm-eta").innerText();
  assert(forecast.includes("Gale forecast"), `gale shows an exact forecast (${forecast})`);
  await page.click("#relay-top-btn");
  assert(await page.locator("#relay-list .relay-card.live").count() === 3, "the recovery guide marks every powered relay");

  await debug("setQuest", 9); await debug("save");
  const quest = (await debug("snapshot")).quest.index;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  await page.click("#continue-btn");
  await page.waitForFunction(() => window.__whiteoutDebug.snapshot().state === "playing");
  assert((await page.evaluate(() => window.__whiteoutDebug.snapshot())).quest.index === quest, "an existing career keeps its mission index");

  await debug("start");
  await debug("clearAt", 0, 0, 200); await debug("step", 0.1);
  const beforeDrift = (await debug("snapshot")).cleanupPercent;
  const certified = (await debug("snapshot")).cleanupCertified;
  await debug("storm"); await debug("step", 0.35);
  const drifted = (await debug("snapshot")).cleanupPercent;
  assert(certified && drifted < beforeDrift && drifted > 90, `a storm still returns snow without erasing a finished clearance (${beforeDrift} -> ${drifted})`);

  assert(errors.length === 0, `no page errors ${errors.join(" | ")}`);
  console.log("SYSTEMS UPGRADE: PASS");
} finally {
  await browser.close();
  server.close();
}
