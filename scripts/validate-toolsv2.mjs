import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "tool-balance");
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
const origin = `http://127.0.0.1:${server.address().port}/`;
const executablePath = [process.env.CHROMIUM_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((path) => path && existsSync(path));
if (!executablePath) throw new Error("No Chrome executable found");
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.addInitScript(() => {
  localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
  localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
  localStorage.removeItem("whiteout.career-v2");
});
await page.goto(origin, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);

const field = await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  const round = (value) => Math.round(value * 1000) / 1000;
  const face = () => { d.walk(0, 1); d.step(0.08); d.walk(0, 0); };
  const standOver = (x, z) => {
    face();
    d.teleport(x, z);
    d.step(1 / 60);
    const aim = d.aimPoint();
    d.teleport(x - (aim.x - aim.px), z - (aim.z - aim.pz));
    d.step(1 / 60);
    return d.aimPoint();
  };
  const equip = (id, level) => {
    d.start(); d.setQuest(8); d.giveCredits(80000);
    while ((d.snapshot().tools[id] ?? 0) < level) d.buyTool(id);
    d.selectTool(id);
    d.setToolHealth(id, 100);
    d.setRaw(0);
    d.holdClear(false);
    d.walk(0, 0);
    d.teleport(0, 10); d.step(0.8);
  };
  const sampleField = (cx, cz, radius, step) => {
    let mass = 0, cells = 0, opened = 0, cut = 0;
    for (let z = cz - radius; z <= cz + radius; z += step) {
      for (let x = cx - radius; x <= cx + radius; x += step) {
        if (Math.hypot(x - cx, z - cz) > radius) continue;
        const density = d.snowAt(x, z);
        mass += density; cells++;
        if (density < 0.25) opened++;
        if (density < 0.55) cut++;
      }
    }
    return { mass, cells, opened, cut };
  };
  const sweep = (id, level, density, seconds, cx, cz, radius) => {
    equip(id, level);
    d.paintSnow(cx, cz, radius + 1.2, 0);
    d.paintSnow(cx, cz, radius, density);
    const initialDisk = d.snowDisk(cx, cz, radius);
    const before = sampleField(cx, cz, radius, 0.9);
    face();
    const aimed = standOver(cx, cz + radius - 1.2);
    const ox = aimed.x - aimed.px, oz = aimed.z - aimed.pz;
    d.teleport(cx - ox, cz + radius - 1.2 - oz);
    d.walk(0, 1);
    d.setRaw(0); d.setToolHealth(id, 100);
    const start = d.snapshot();
    const origin = window.__gameProbe();
    let cargo = 0, unloads = 0;
    d.holdClear(true);
    for (let t = 0; t < seconds; t += 0.1) {
      d.step(0.1);
      const snap = d.snapshot();
      if (snap.load > snap.capacity - 0.35) { cargo += snap.raw; d.setRaw(0); unloads++; }
    }
    d.holdClear(false); d.walk(0, 0);
    const end = d.snapshot();
    cargo += end.raw;
    const after = sampleField(cx, cz, radius, 0.9);
    const probe = window.__gameProbe();
    const leftDisk = d.snowDisk(cx, cz, radius);
    return {
      id, level, density, seconds,
      mass: round(initialDisk - leftDisk),
      gridMass: round(before.mass - after.mass),
      diskLeft: round(leftDisk),
      opened: after.opened, cut: after.cut, cells: after.cells,
      openedBefore: before.opened, cutBefore: before.cut,
      cargo: round(cargo), unloads,
      heat: round(start.heat - end.heat),
      wear: round(start.toolHealth[id] - end.toolHealth[id]),
      travel: round(Math.hypot(probe.x - origin.x, probe.z - origin.z)),
      conserved: cargo <= initialDisk - leftDisk + 0.05,
    };
  };
  const disk = (id, level) => {
    equip(id, level);
    const cx = 32, cz = 28, patch = 3.1, density = 1;
    d.paintSnow(cx, cz, patch + 2, 0);
    d.paintSnow(cx, cz, patch, density);
    const initial = d.snowDisk(cx, cz, patch);
    const before = sampleField(cx, cz, patch, 0.45);
    d.setRaw(0); d.setToolHealth(id, 100);
    face();
    const aimed = standOver(cx, cz + patch);
    const ox = aimed.x - aimed.px, oz = aimed.z - aimed.pz;
    const startHeat = d.snapshot().heat;
    const startHealth = d.snapshot().toolHealth[id];
    let t = 0, unloads = 0, cargo = 0;
    d.holdClear(true);
    for (const offset of [-2.4, -1.2, 0, 1.2, 2.4]) {
      d.walk(0, 0);
      d.teleport(cx + offset - ox, cz + patch + 0.45 - oz);
      d.walk(0, 1);
      for (let i = 0; i < 45 && t < 20; i++) {
        d.step(0.1); t += 0.1;
        const snap = d.snapshot();
        if (snap.load > snap.capacity - 0.4) { cargo += snap.raw; d.setRaw(0); unloads++; }
        const aim = d.aimPoint();
        if (aim.z < cz - patch - 0.35) break;
        if (d.snowDisk(cx, cz, patch) < initial * 0.08) break;
      }
      if (d.snowDisk(cx, cz, patch) < initial * 0.08) break;
    }
    d.holdClear(false); d.walk(0, 0);
    const end = d.snapshot();
    cargo += end.raw;
    const left = d.snowDisk(cx, cz, patch);
    const after = sampleField(cx, cz, patch, 0.45);
    return {
      id, level, seconds: round(t), cleared: round(1 - left / Math.max(0.001, initial)),
      mass: round(before.mass - after.mass), opened: after.opened - before.opened, cut: after.cut - before.cut, cells: after.cells,
      cargo: round(cargo), unloads, heat: round(startHeat - end.heat), wear: round(startHealth - end.toolHealth[id]),
    };
  };
  const rows = [];
  for (const level of [1, 4]) for (const id of ["shovel", "brush"]) {
    rows.push({ kind: "large-deep", ...sweep(id, level, 1, 5, 48, 12, 16) });
    rows.push({ kind: "large-thin", ...sweep(id, level, 0.3, 5, 48, -28, 16) });
    rows.push({ kind: "disk-deep", ...disk(id, level) });
  }
  return rows;
});

const blower = [];
for (const level of [1, 4]) for (const azimuth of [0.2, Math.atan2(14, 18), Math.PI]) for (const facing of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
  await page.evaluate(({ level, azimuth, facing }) => {
    const d = window.__whiteoutDebug;
    d.start(); d.setQuest(8); d.giveCredits(20000);
    while ((d.snapshot().tools.blower ?? 0) < level) d.buyTool("blower");
    d.selectTool("blower");
    d.teleport(18, -24); d.setAzimuth(azimuth);
    d.walk(facing[0], facing[1]); d.step(0.08); d.walk(0, 0); d.teleport(18, -24);
  }, { level, azimuth, facing });
  await page.waitForTimeout(350);
  const sample = await page.evaluate(({ level, azimuth, facing }) => {
    const d = window.__whiteoutDebug;
    const aim = d.aimPoint();
    const markers = d.aimMarkers();
    const player = d.worldToScreen(aim.px, aim.pz);
    const ring = d.worldToScreen(markers.ringX, markers.ringZ);
    const feetBefore = d.snowAt(aim.px, aim.pz);
    const ringBefore = d.snowAt(aim.x, aim.z);
    const outside = d.snowAt(aim.x + (aim.x - aim.px) / Math.max(0.2, Math.hypot(aim.x - aim.px, aim.z - aim.pz)) * (aim.radius + 0.8), aim.z + (aim.z - aim.pz) / Math.max(0.2, Math.hypot(aim.x - aim.px, aim.z - aim.pz)) * (aim.radius + 0.8));
    d.paintSnow(aim.px, aim.pz, 10, 0.85);
    const feetPaint = d.snowAt(aim.px, aim.pz);
    const ringPaint = d.snowAt(aim.x, aim.z);
    d.holdClear(true); d.step(0.3); d.holdClear(false);
    const round = (value) => Math.round(value * 1000) / 1000;
    return {
      level, azimuth: round(azimuth), facing,
      world: round(Math.hypot(aim.x - aim.px, aim.z - aim.pz)),
      ringWorld: round(Math.hypot(markers.ringX - aim.px, markers.ringZ - aim.pz)),
      radius: round(aim.radius), ringScale: round(markers.ringScale),
      screen: round(Math.hypot(player.x - ring.x, player.y - ring.y)),
      player, ring,
      feetDrop: round(feetPaint - d.snowAt(aim.px, aim.pz)),
      ringDrop: round(ringPaint - d.snowAt(aim.x, aim.z)),
      outsideBefore: round(outside),
      ring: markers.ring, lane: markers.lane, chevron: markers.chevron, sweep: markers.sweep, suction: markers.suction,
      cam: d.cameraPose(),
    };
  }, { level, azimuth, facing });
  blower.push(sample);
}

await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(20000);
  while ((d.snapshot().tools.blower ?? 0) < 1) d.buyTool("blower");
  d.selectTool("blower");
  d.teleport(18, -24); d.setAzimuth(0.2);
  d.walk(0, 1); d.step(0.08); d.walk(0, 0); d.teleport(18, -24);
});
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, "blower-aim-l1.png") });
await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  while ((d.snapshot().tools.blower ?? 0) < 4) d.buyTool("blower");
  d.selectTool("blower");
  d.teleport(18, -24); d.setAzimuth(0.2);
  d.walk(0, 1); d.step(0.08); d.walk(0, 0); d.teleport(18, -24);
});
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, "blower-aim-l4.png") });

const report = { field, blower, errors };
await writeFile(join(OUT, process.argv[2] === "after" ? "validate-after.json" : "validate-before.json"), JSON.stringify(report, null, 2));
const brief = field.map((row) => [row.kind, row.id, row.level, row.mass ?? "", row.cleared ?? "", row.seconds ?? row.travel, row.cargo, row.heat, row.wear, row.opened, row.cut].join("\t"));
console.log(brief.join("\n"));
console.log("--- blower ---");
for (const row of blower) console.log([row.level, row.azimuth, row.facing.join(","), "world", row.world, "screen", row.screen, "feet", row.feetDrop, "ring", row.ringDrop, "scale", row.ringScale].join(" "));
if (errors.length) console.error(errors.join("\n"));
await browser.close();
server.close();
