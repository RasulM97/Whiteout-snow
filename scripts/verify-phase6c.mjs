import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
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
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(0);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.addInitScript(() => {
  localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "high", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
  localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
  localStorage.removeItem("whiteout.career-v2");
});
await page.goto(origin, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
const result = await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  const round = (n) => Number(n.toFixed(2));
  d.start(); d.giveCredits(300000); d.setQuest(4); d.teleport(0, 10);
  const obstacles = d.obstacles();
  const fits = (x, z, radius) => Math.abs(x) <= 62 && Math.abs(z) <= 62 && obstacles.every((item) => Math.hypot(item.x - x, item.z - z) >= radius + item.r + 0.8);
  let best = null;
  for (let x = -48; x <= 48; x += 4) for (let z = -48; z <= 48; z += 4) {
    if (Math.abs(x) + Math.abs(z - 10) > 60 || !fits(x, z, 2)) continue;
    let count = 0;
    for (let dx = -16; dx <= 16; dx += 8) for (let dz = -16; dz <= 16; dz += 8) if (fits(x + dx, z + dz, 1.8)) count++;
    if (!best || count > best.count) best = { x, z, count };
  }
  const center = best ?? { x: 24, z: -8, count: 0 };
  const gen = d.build("generator", center.x, center.z);
  if (gen) { d.teleport(center.x, center.z); d.upgradeNearest(); d.upgradeNearest(); }
  const at = (dx, dz, type, radius) => {
    const x = center.x + dx; const z = center.z + dz;
    if (!fits(x, z, radius)) return 0;
    if (type !== "generator" && !d.powerPreview(type, x, z).connected) return 0;
    return d.build(type, x, z) ?? 0;
  };
  const purifierA = at(-12, 0, "purifier", 1.75);
  const purifierB = at(12, 0, "purifier", 1.75);
  const press = at(0, 12, "press", 1.7);
  const sweepers = [];
  for (let dx = -24; dx <= 24 && sweepers.length < 14; dx += 8) for (let dz = -24; dz <= 24 && sweepers.length < 14; dz += 8) {
    if (Math.hypot(dx, dz) < 10) continue;
    const id = at(dx, dz, "sweeper", 1.35);
    if (id) sweepers.push(id);
  }
  const spot = (id) => d.snapshot().buildings.find((item) => item.id === id);
  const line = (a, b) => d.commitStroke([{ x: spot(a).x, z: spot(a).z }, { x: spot(b).x, z: spot(b).z }]);
  const links = purifierA ? sweepers.slice(0, 4).map((id) => line(id, purifierA)) : [];
  let merge = null;
  if (purifierA && links[0]?.ok && sweepers[4]) {
    const a = spot(sweepers[0]); const p = spot(purifierA);
    merge = d.commitStroke([{ x: spot(sweepers[4]).x, z: spot(sweepers[4]).z }, { x: (a.x + p.x) / 2, z: (a.z + p.z) / 2 }]);
  }
  const trunkToPress = purifierA && press ? line(purifierA, press) : null;
  const split = trunkToPress?.ok && sweepers[5] ? d.commitStroke([{ x: (spot(purifierA).x + spot(press).x) / 2, z: (spot(purifierA).z + spot(press).z) / 2 }, { x: spot(sweepers[5]).x, z: spot(sweepers[5]).z }]) : null;
  let cross = null;
  if (sweepers[5] && purifierB && sweepers[6] && purifierA) {
    const trunk = line(sweepers[6], purifierB);
    const crossing = line(sweepers[5], purifierA);
    cross = { trunk: trunk?.reason, crossing: crossing?.reason, junctions: crossing?.junctions ?? [] };
  }
  const idleFrom = sweepers[7];
  const idle = idleFrom && purifierB ? line(idleFrom, purifierB) : null;
  const beforeCredits = d.snapshot().credits;
  const removed = idle?.ok ? d.deleteEdge(d.netState().edges.at(-1).id) : { ok: false, reason: idle?.reason ?? "missing" };
  const creditDelta = round(d.snapshot().credits - beforeCredits);
  for (const id of sweepers) d.setOutput(id, 400);
  if (purifierA) d.setInput(purifierA, 1);
  if (purifierB) d.setInput(purifierB, 1);
  const outputsBefore = sweepers.reduce((sum, id) => sum + spot(id).output, 0);
  d.step(8);
  const net = d.netState();
  const retained = d.logistics().retained;
  const outputsAfter = sweepers.reduce((sum, id) => sum + (spot(id)?.output ?? 0), 0);
  const gap = net.account.dispatched - net.account.delivered - net.cargo - retained.raw - retained.purified - retained.ice;
  const capped = net.capsules.length >= 48;
  d.step(4);
  const later = d.netState();
  return {
    center, generator: !!gen,
    built: { purifiers: [purifierA, purifierB].filter(Boolean).length, press: !!press, sweepers: sweepers.length },
    links: links.map((item) => item?.reason),
    merge: merge && { ok: merge.ok, reason: merge.reason, junctions: merge.junctions },
    split: split && { ok: split.ok, reason: split.reason, junctions: split.junctions },
    cross,
    removed: { ok: !!removed?.ok, reason: removed?.reason, creditDelta },
    traffic: {
      edges: net.edges.length,
      junctions: net.junctions.map((item) => item.kind),
      capsules: net.capsules.length,
      laterCapsules: later.capsules.length,
      moved: net.capsules.filter((item) => item.distance > 1).length,
      holds: net.capsules.filter((item) => item.hold).length,
      maxWait: round(Math.max(0, ...net.capsules.map((item) => item.wait), 0)),
      dispatched: round(net.account.dispatched),
      delivered: round(net.account.delivered),
      riding: round(net.cargo),
      gap: round(gap),
      outputDrop: round(outputsBefore - outputsAfter),
      capped,
    },
  };
});
await page.screenshot({ path: join(ROOT, "phase6-shots", "07-open-yard.png") });
await writeFile("D:/Game/reports/phase6c-result.json", JSON.stringify({ result, errors }, null, 2));
console.log("PHASE6C", JSON.stringify(result));
await browser.close();
server.close();
