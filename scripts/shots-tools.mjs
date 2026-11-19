import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "tool-balance-shots");
await mkdir(OUT, { recursive: true });
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
const executablePath = [process.env.CHROMIUM_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((path) => path && existsSync(path));
if (!executablePath) throw new Error("No Chrome executable found");
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(40000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.addInitScript(() => {
  localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
  localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
  localStorage.removeItem("whiteout.career-v2");
});
await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);

const prep = await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(20000);
  for (const id of ["shovel", "brush", "blower", "vacuum"]) d.buyTool(id);
  d.teleport(18, -24); d.setAzimuth(0.15);
  const switched = ["hands", "shovel", "brush", "blower", "vacuum"].map((id) => { d.selectTool(id); return d.snapshot().selectedTool; });
  d.selectTool("brush");
  d.walk(0, 1); d.step(0.08); d.walk(0, 0);
  d.teleport(18, -24);
  d.step(1 / 60);
  const aim = d.aimPoint();
  d.paintSnow(aim.x, aim.z, 4, 0.85);
  const full = (() => {
    const watch = aim.radius + 0.4;
    const before = d.snowDisk(aim.x, aim.z, watch);
    d.setRaw(d.snapshot().capacity);
    d.holdClear(true); d.step(0.4); d.holdClear(false);
    const blocked = Math.abs(d.snowDisk(aim.x, aim.z, watch) - before) < 0.02;
    d.setRaw(0);
    d.holdClear(true); d.step(0.4); d.holdClear(false);
    return { blocked, resumed: before - d.snowDisk(aim.x, aim.z, watch) > 0.2, before };
  })();
  d.setToolHealth("brush", 64);
  d.setRaw(4);
  d.save();
  return { switched, full, save: localStorage.getItem("whiteout.career-v2") };
});

for (const id of ["hands", "shovel", "brush", "blower", "vacuum"]) {
  await page.evaluate((id) => {
    const d = window.__whiteoutDebug;
    d.selectTool(id);
    d.walk(0, 1); d.step(0.05); d.walk(0, 0);
    d.teleport(18, -24); d.setAzimuth(0.2); d.step(0.15);
  }, id);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, `${id}.png`) });
}
await page.evaluate(() => window.__whiteoutDebug.openUpgrades());
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, "shop.png") });

await page.addInitScript((stored) => { localStorage.setItem("whiteout.career-v2", stored); }, prep.save);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
const resumed = await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.continue();
  const snap = d.snapshot();
  return { tool: snap.selectedTool, brush: snap.tools.brush, health: snap.toolHealth.brush, raw: snap.raw, credits: snap.credits };
});
const perf = await page.evaluate(() => new Promise((resolve) => {
  const stamps = [];
  const tick = (now) => {
    stamps.push(now);
    if (stamps.length < 70) requestAnimationFrame(tick);
    else {
      const dts = stamps.slice(1).map((value, index) => value - stamps[index]);
      const stats = window.__whiteoutDebug.stats();
      resolve({ avg: dts.reduce((sum, value) => sum + value, 0) / dts.length, calls: stats.calls, triangles: stats.triangles, fps: stats.fps });
    }
  };
  requestAnimationFrame(tick);
}));
console.log(JSON.stringify({ switched: prep.switched, full: prep.full, resumed, perf, errors }, null, 2));
await browser.close();
server.close();
if (errors.length || prep.switched.join() !== "hands,shovel,brush,blower,vacuum" || !prep.full.blocked || !prep.full.resumed || resumed.brush !== 1 || resumed.tool !== "brush" || Math.abs(resumed.health - 64) > 0.1 || Math.abs(resumed.raw - 4) > 0.01) process.exit(1);
