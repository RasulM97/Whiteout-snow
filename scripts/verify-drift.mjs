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
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(0);
  await page.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
    localStorage.removeItem("whiteout.career-v2");
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  const result = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start();
    for (let z = -60; z <= 60 && d.snapshot().cleanupPercent < 60; z += 8) {
      for (let x = -60; x <= 60 && d.snapshot().cleanupPercent < 60; x += 8) d.clearAt(x, z, 6);
    }
    const opened = d.snapshot().cleanupPercent;
    d.storm(); d.step(0.05);
    const afterBurst = d.snapshot().cleanupPercent;
    d.giveCredits(250000);
    const place = (type, x, z) => d.build(type, x, z);
    const ids = {
      purifierA: place("purifier", 4, 16), purifierB: place("purifier", 22, 2), press: place("press", -4, 16),
      heaterBase: place("heater", 0, 18), hauler: place("hauler", 8, 14),
      sweeperA: place("sweeper", -8, 8), sweeperB: place("sweeper", 8, 4),
      genEast: place("generator", 22, 10), genWest: place("generator", -22, 10),
      sweeperC: place("sweeper", 22, 20), sweeperD: place("sweeper", 34, 10), heaterEast: place("heater", 16, 8),
      sweeperE: place("sweeper", -22, 20), sweeperF: place("sweeper", -34, 10), heaterWest: place("heater", -16, 8),
    };
    for (const id of Object.values(ids)) {
      const building = d.snapshot().buildings.find((item) => item.id === id);
      if (!building) continue;
      d.teleport(building.x, building.z); d.upgradeNearest(); d.upgradeNearest();
    }
    for (const id of [ids.sweeperA, ids.sweeperB, ids.sweeperC, ids.sweeperD, ids.sweeperE, ids.sweeperF]) { d.buyExtraRobot(id); d.buyExtraRobot(id); }
    d.teleport(0, 10);
    const started = d.snapshot().cleanupPercent;
    const curve = [];
    for (let i = 0; i < 14; i++) {
      d.step(60); const s = d.snapshot();
      curve.push({ t: Number((s.runTime / 60).toFixed(1)), cleanup: Number(s.cleanupPercent.toFixed(2)), certified: s.cleanupCertified, frozen: s.frozenRobots });
    }
    const finished = d.snapshot();
    return {
      opened: Number(opened.toFixed(2)), afterBurst: Number(afterBurst.toFixed(2)), started: Number(started.toFixed(2)),
      finished: Number(finished.cleanupPercent.toFixed(2)), certified: finished.cleanupCertified,
      robots: d.robotStates().filter((robot) => robot.kind === "sweeper").length,
      alive: d.robotStates().filter((robot) => robot.kind === "sweeper" && !robot.frozen).length,
      reach: Number(Math.max(...d.robotStates().filter((robot) => robot.kind === "sweeper").map((robot) => robot.searchRange)).toFixed(1)),
      heavy: d.snapshot().chunks.filter((chunk) => chunk.remaining >= 0.55).sort((a, b) => b.remaining - a.remaining).slice(0, 6).map((chunk) => ({ x: Math.round(chunk.x), z: Math.round(chunk.z), snow: Number(chunk.remaining.toFixed(1)), progress: Number(chunk.progress.toFixed(2)) })),
      where: d.robotStates().filter((robot) => robot.kind === "sweeper").slice(0, 6).map((robot) => ({ x: Math.round(robot.x), z: Math.round(robot.z), mode: robot.mode, chunk: robot.activeChunk })),
      curve,
    };
  });
  console.log("DRIFT", JSON.stringify(result));
  if (!(result.afterBurst < result.opened)) throw new Error("a storm on a half-cleared map did not return snow");
  if (!(result.finished >= 85 || result.certified)) throw new Error("a powered fleet could not advance a 60% map");
  console.log("DRIFT VERIFY OK");
} finally {
  await browser.close();
  server.close();
}
