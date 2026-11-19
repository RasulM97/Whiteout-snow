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

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const sample = async (page) => page.evaluate(() => new Promise((resolve) => {
  const deltas = [];
  let last = 0;
  const tick = (now) => {
    if (last) deltas.push(now - last);
    last = now;
    if (deltas.length < 240) requestAnimationFrame(tick);
    else {
      const stats = window.__whiteoutDebug.stats();
      resolve({
        deltas,
        calls: stats.calls,
        triangles: stats.triangles,
        fps: stats.fps,
        lowQuality: stats.lowQuality,
        renderer: stats.renderer,
      });
    }
  };
  requestAnimationFrame(tick);
}));

const buildFleet = () => {
  const d = window.__whiteoutDebug;
    d.start();
    d.giveCredits(250000);
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
  for (const id of Object.values(ids)) {
    const building = d.snapshot().buildings.find((item) => item.id === id);
    if (!building) continue;
    d.teleport(building.x, building.z); d.upgradeNearest(); d.upgradeNearest();
  }
  for (const id of [ids.sweeperA, ids.sweeperB, ids.sweeperC, ids.sweeperD, ids.sweeperE, ids.sweeperF]) {
    d.buyExtraRobot(id); d.buyExtraRobot(id);
  }
  for (const id of [ids.sweeperA, ids.sweeperB, ids.sweeperC]) d.rail(id, ids.purifierA);
  for (const id of [ids.sweeperD, ids.sweeperE, ids.sweeperF]) d.rail(id, ids.purifierB);
  d.rail(ids.purifierA, 0); d.rail(ids.purifierB, 0); d.rail(ids.press, 0);
  d.repairRelay("gale"); d.repairRelay("servo"); d.repairRelay("foundry");
  d.teleport(0, 10); d.step(2);
  const state = d.snapshot();
  return {
    robots: d.robotStates().filter((robot) => robot.kind === "sweeper").length,
    docks: state.buildings.filter((building) => building.type === "sweeper" && building.powered).length,
    heaters: state.buildings.filter((building) => building.type === "heater" && building.powered).length,
    relays: state.buildings.filter((building) => building.type === "generator" && building.powered).length,
  };
};

const browser = await chromium.launch({ headless: true, executablePath });
const profiles = [
  { name: "desktop-high", quality: "high", viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: "desktop-low", quality: "low", viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: "mobile-emulation-low", quality: "low", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
try {
  for (const profile of profiles) {
    const page = await browser.newPage({ viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, isMobile: profile.isMobile, hasTouch: profile.hasTouch });
    page.setDefaultTimeout(0);
    await page.addInitScript((quality) => {
      localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality, volume: 0, muted: true, cameraShake: false, particles: quality !== "low", uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
      localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
      localStorage.removeItem("whiteout.career-v2");
    }, profile.quality);
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
    const fleet = await page.evaluate(buildFleet);
    const frames = await sample(page);
    const body = frames.deltas.slice(30);
    const average = body.reduce((sum, value) => sum + value, 0) / body.length;
    if (fleet.robots !== 18 || fleet.docks !== 6) throw new Error(`full fleet was not built (${JSON.stringify(fleet)})`);
    console.log("PERF", JSON.stringify({
      profile: profile.name,
      device: "emulated viewport on this machine, not a physical phone",
      quality: profile.quality,
      viewport: profile.viewport,
      fleet,
      renderer: frames.renderer,
      lowQuality: frames.lowQuality,
      calls: frames.calls,
      triangles: frames.triangles,
      loopFps: Number(frames.fps.toFixed(1)),
      samples: body.length,
      frameMs: { avg: Number(average.toFixed(2)), p95: Number(percentile(body, 95).toFixed(2)), p99: Number(percentile(body, 99).toFixed(2)) },
    }));
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
