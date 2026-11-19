import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const SHOTS = join(ROOT, "phase7-shots");
const RESULT = "D:/Game/reports/phase7-result.json";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".mp3": "audio/mpeg", ".svg": "image/svg+xml", ".png": "image/png" };
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
if (!executablePath) throw new Error("No Chrome");
await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath });
const report = { shots: [], errors: [] };

async function openPage(touch = false) {
  const page = await browser.newPage({ viewport: touch ? { width: 844, height: 390 } : { width: 1280, height: 720 }, isMobile: touch, hasTouch: touch });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => report.errors.push(String(error)));
  await page.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "high", volume: 0, muted: true, cameraShake: false, particles: true, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
    if (!sessionStorage.getItem("phase7-keep")) localStorage.removeItem("whiteout.career-v2");
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  return page;
}

try {
  const page = await openPage(false);
  report.ui = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start();
    d.giveCredits(5000);
    const id = d.build("sweeper", 8, 4);
    d.teleport(8, 6);
    d.buyExtraRobot(id);
    d.buyExtraRobot(id);
    d.step(0.3);
    const before = d.snapshot().buildings.find((b) => b.id === id);
    return { id, robots: before.robots.length, modes: before.robots.map((r) => r.zoneMode), card: document.getElementById("work-area-set")?.textContent ?? "", visible: !document.getElementById("work-area-actions")?.classList.contains("hidden"), state: d.snapshot().state };
  });
  if (!report.ui.visible) throw new Error(`work area button hidden ${JSON.stringify(report.ui)}`);
  await page.click("#work-area-set");
  const canvas = page.locator("#game-canvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.42);
  await page.mouse.click(box.x + box.width * 0.68, box.y + box.height * 0.42);
  await page.waitForTimeout(250);
  report.preview = await page.evaluate(() => {
    const aim = window.__whiteoutDebug.snapshot().workAim;
    return { aim, state: window.__whiteoutDebug.snapshot().state, confirmDisabled: document.getElementById("work-area-confirm")?.disabled ?? null };
  });
  await page.screenshot({ path: join(SHOTS, "01-area-preview.png") });
  report.shots.push(join(SHOTS, "01-area-preview.png"));
  await page.click("#work-area-confirm");
  report.assigned = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const dock = d.snapshot().buildings.find((b) => b.type === "sweeper");
    return { state: d.snapshot().state, workArea: dock.workArea, modes: dock.robots.map((r) => r.zoneMode), aim: d.snapshot().workAim };
  });
  await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const area = d.snapshot().buildings.find((b) => b.type === "sweeper").workArea;
    d.teleport(area.x, area.z);
    d.paintSnow(area.x, area.z, 10, 1);
    d.step(4);
  });
  report.working = await page.evaluate(() => {
    const dock = window.__whiteoutDebug.snapshot().buildings.find((b) => b.type === "sweeper");
    const robots = window.__whiteoutDebug.robotStates().filter((r) => r.kind === "sweeper");
    return { state: window.__whiteoutDebug.snapshot().state, chunks: robots.map((r) => r.activeChunk), modes: robots.map((r) => r.mode), fallback: dock.workArea?.fallback ?? null };
  });
  await page.screenshot({ path: join(SHOTS, "02-robots-in-area.png") });
  report.shots.push(join(SHOTS, "02-robots-in-area.png"));
  report.fallback = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const area = d.snapshot().buildings.find((b) => b.type === "sweeper").workArea;
    d.paintSnow(area.x, area.z, area.radius + 4, 0);
    d.paintSnow(area.x + 40, area.z, 8, 1);
    d.step(6);
    const dock = d.snapshot().buildings.find((b) => b.type === "sweeper");
    return { fallback: dock.workArea?.fallback ?? null, modes: dock.robots.map((r) => r.zoneMode), chunks: d.robotStates().filter((r) => r.kind === "sweeper").map((r) => r.activeChunk), state: d.snapshot().state };
  });
  await page.evaluate(() => { window.__whiteoutDebug.save(); sessionStorage.setItem("phase7-keep", "1"); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  report.reload = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.continue();
    const dock = d.snapshot().buildings.find((b) => b.type === "sweeper");
    return { state: d.snapshot().state, workArea: dock?.workArea ?? null, modes: dock?.robots?.map((r) => r.zoneMode) ?? [] };
  });
  await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const dock = d.snapshot().buildings.find((b) => b.type === "sweeper");
    d.teleport(dock.x, dock.z + 1.4);
    d.step(0.2);
  });
  const autoReady = await page.evaluate(() => ({
    hidden: document.getElementById("work-area-auto")?.classList.contains("hidden"),
    cardHidden: document.getElementById("building-card")?.classList.contains("hidden"),
    area: window.__whiteoutDebug.snapshot().buildings.find((b) => b.type === "sweeper")?.workArea ?? null,
  }));
  if (autoReady.hidden) report.autoReady = autoReady;
  else await page.click("#work-area-auto");
  report.cleared = await page.evaluate(() => {
    const dock = window.__whiteoutDebug.snapshot().buildings.find((b) => b.type === "sweeper");
    return { workArea: dock.workArea, modes: dock.robots.map((r) => r.zoneMode), state: window.__whiteoutDebug.snapshot().state, autoReady: true };
  });
  report.cleared.autoReady = autoReady;
  await page.screenshot({ path: join(SHOTS, "03-back-to-auto.png") });
  report.shots.push(join(SHOTS, "03-back-to-auto.png"));
  await page.close();

  const touch = await openPage(true);
  report.touch = await touch.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start();
    d.giveCredits(2000);
    const id = d.build("sweeper", 6, 4);
    d.teleport(6, 5.2);
    d.step(0.3);
    return { id, visible: !document.getElementById("work-area-actions")?.classList.contains("hidden"), text: document.getElementById("work-area-set")?.textContent ?? "" };
  });
  await touch.tap("#work-area-set");
  await touch.locator("#game-canvas").tap({ position: { x: 280, y: 160 } });
  await touch.waitForTimeout(200);
  const locked = await touch.evaluate(() => window.__whiteoutDebug.snapshot().workAim);
  if (locked?.locked) await touch.tap("#work-area-confirm");
  report.touchResult = await touch.evaluate(() => {
    const dock = window.__whiteoutDebug.snapshot().buildings.find((b) => b.type === "sweeper");
    return { aim: window.__whiteoutDebug.snapshot().workAim, modes: dock.robots.map((r) => r.zoneMode), area: dock.workArea, state: window.__whiteoutDebug.snapshot().state };
  });
  await touch.screenshot({ path: join(SHOTS, "04-touch-area.png") });
  report.shots.push(join(SHOTS, "04-touch-area.png"));
  await touch.close();

  const fleet = await openPage(false);
  report.fleets = await fleet.evaluate(() => {
    const d = window.__whiteoutDebug;
    const run = (docksWanted) => {
      d.start();
      d.giveCredits(900000);
      d.setQuest(4);
      d.teleport(0, 10);
      const placed = [];
      const fits = (x, z, radius) => Math.abs(x) <= 62 && Math.abs(z) <= 62 && d.obstacles().every((item) => Math.hypot(item.x - x, item.z - z) >= radius + item.r + 0.7) && placed.every((item) => Math.hypot(item.x - x, item.z - z) >= 5.2);
      const gens = [];
      for (let x = -48; x <= 48; x += 16) for (let z = -40; z <= 48; z += 16) {
        if (gens.length >= 8 || !fits(x, z, 1.5)) continue;
        const id = d.build("generator", x, z); if (!id) continue;
        d.teleport(x, z); d.upgradeNearest(); d.upgradeNearest();
        gens.push(id); placed.push({ x, z });
      }
      const docks = [];
      for (let x = -56; x <= 56 && docks.length < docksWanted; x += 7) for (let z = -48; z <= 56 && docks.length < docksWanted; z += 7) {
        if (!fits(x, z, 1.35) || !d.powerPreview("sweeper", x, z).connected) continue;
        const id = d.build("sweeper", x, z); if (!id) continue;
        docks.push(id); placed.push({ x, z });
      }
      for (const id of docks) {
        const b = d.snapshot().buildings.find((item) => item.id === id);
        d.teleport(b.x, b.z); d.upgradeNearest(); d.upgradeNearest(); d.buyExtraRobot(id); d.buyExtraRobot(id);
        d.assignWorkArea(id, b.x + 12, b.z + 6);
      }
      const started = performance.now();
      d.step(8);
      const robots = d.robotStates().filter((r) => r.kind === "sweeper");
      const areas = d.snapshot().buildings.filter((b) => b.type === "sweeper");
      const saveStarted = performance.now(); d.save(); const saveMs = performance.now() - saveStarted;
      const saved = JSON.parse(localStorage.getItem("whiteout.career-v2"));
      return {
        docks: docks.length, powered: areas.filter((b) => b.powered).length, robots: robots.length,
        areaOrders: areas.filter((b) => b.workArea).length, fallback: areas.filter((b) => b.workArea?.fallback).length,
        uniqueChunks: new Set(robots.map((r) => r.activeChunk).filter((id) => id >= 0)).size,
        frozen: robots.filter((r) => r.frozen).length, waiting: robots.filter((r) => r.mode === "wait" || r.mode === "expand").length,
        simMs: Number((performance.now() - started).toFixed(1)), saveMs: Number(saveMs.toFixed(1)),
        savedAreas: saved.buildings.filter((b) => b.workArea).length, schema: saved.version, state: d.snapshot().state,
      };
    };
    const eighteen = run(6);
    d.teleport(0, 10);
    return { eighteen };
  });
  await fleet.screenshot({ path: join(SHOTS, "05-eighteen-sweepers.png") });
  report.shots.push(join(SHOTS, "05-eighteen-sweepers.png"));
  report.fleets.fiftyFour = await fleet.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start();
    d.giveCredits(900000);
    d.setQuest(4);
    const placed = [];
    const fits = (x, z, radius) => Math.abs(x) <= 62 && Math.abs(z) <= 62 && d.obstacles().every((item) => Math.hypot(item.x - x, item.z - z) >= radius + item.r + 0.7) && placed.every((item) => Math.hypot(item.x - x, item.z - z) >= 5.2);
    for (let x = -48; x <= 48; x += 16) for (let z = -40; z <= 48; z += 16) {
      if (!fits(x, z, 1.5)) continue;
      const id = d.build("generator", x, z); if (!id) continue;
      d.teleport(x, z); d.upgradeNearest(); d.upgradeNearest();
      placed.push({ x, z });
    }
    const docks = [];
    for (let x = -56; x <= 56 && docks.length < 18; x += 7) for (let z = -48; z <= 56 && docks.length < 18; z += 7) {
      if (!fits(x, z, 1.35) || !d.powerPreview("sweeper", x, z).connected) continue;
      const id = d.build("sweeper", x, z); if (!id) continue;
      docks.push(id); placed.push({ x, z });
    }
    for (const id of docks) {
      const b = d.snapshot().buildings.find((item) => item.id === id);
      d.teleport(b.x, b.z); d.upgradeNearest(); d.upgradeNearest(); d.buyExtraRobot(id); d.buyExtraRobot(id);
      d.assignWorkArea(id, b.x + 10, b.z);
    }
    const started = performance.now();
    d.step(8);
    const robots = d.robotStates().filter((r) => r.kind === "sweeper");
    d.teleport(d.snapshot().buildings.find((b) => b.type === "sweeper").x, d.snapshot().buildings.find((b) => b.type === "sweeper").z);
    return {
      docks: docks.length, robots: robots.length, frozen: robots.filter((r) => r.frozen).length,
      area: d.snapshot().buildings.filter((b) => b.workArea).length,
      uniqueChunks: new Set(robots.map((r) => r.activeChunk).filter((id) => id >= 0)).size,
      simMs: Number((performance.now() - started).toFixed(1)), state: d.snapshot().state,
    };
  });
  await fleet.screenshot({ path: join(SHOTS, "06-fifty-four-sweepers.png") });
  report.shots.push(join(SHOTS, "06-fifty-four-sweepers.png"));
  report.capsules = await fleet.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start();
    d.giveCredits(200000);
    const purifier = d.build("purifier", 0, 22);
    const ids = [];
    for (const [x, z] of [[-18, 22], [18, 22], [0, 36], [0, 8], [-14, 32], [14, 32], [-14, 12], [14, 12]]) {
      const id = d.build("sweeper", x, z); if (id) ids.push(id);
    }
    const spot = (id) => d.snapshot().buildings.find((b) => b.id === id);
    const links = ids.map((id) => d.commitStroke([{ x: spot(id).x, z: spot(id).z }, { x: spot(purifier).x, z: spot(purifier).z }]));
    for (const id of ids) d.setOutput(id, 500);
    d.setInput(purifier, 1);
    d.step(8);
    const net = d.netState();
    return { links: links.map((item) => item.reason), capsules: net.capsules.length, gap: Number((net.account.dispatched - net.account.delivered - net.cargo).toFixed(2)), edges: net.edges.length, capReached: net.capsules.length >= 48 };
  });
  await fleet.close();
  await writeFile(RESULT, JSON.stringify(report, null, 2));
  const bad = [];
  if (report.assigned?.modes?.some((mode) => mode !== "area")) bad.push("mouse confirm did not assign the circle");
  if (!report.reload?.workArea) bad.push("work area did not survive reload");
  if (report.cleared?.workArea) bad.push("return to auto left an area");
  if (report.cleared?.modes?.some((mode) => mode !== "auto")) bad.push("return to auto left a robot ordered");
  if (report.fleets?.eighteen?.robots !== 18) bad.push(`eighteen sweepers built ${report.fleets?.eighteen?.robots}`);
  if (report.fleets?.fiftyFour?.robots !== 54) bad.push(`fifty-four sweepers built ${report.fleets?.fiftyFour?.robots}`);
  if (report.errors.length) bad.push(report.errors.join(" | "));
  console.log("PHASE7", JSON.stringify({ bad, ui: report.ui, preview: report.preview, assigned: report.assigned, working: report.working, fallback: report.fallback, reload: report.reload, cleared: report.cleared, touch: report.touchResult, fleets: report.fleets, capsules: report.capsules }));
  if (bad.length) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
