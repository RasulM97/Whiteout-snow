import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const SHOTS = join(ROOT, "phase6-shots");
const RESULT = "D:/Game/reports/phase6b-result.json";
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
if (!executablePath) throw new Error("No Chrome executable found");
await mkdir(SHOTS, { recursive: true });
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};
const browser = await chromium.launch({ headless: true, executablePath, args: ["--enable-precise-memory-info"] });

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(0);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "high", volume: 0, muted: true, cameraShake: false, particles: true, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
    if (!sessionStorage.getItem("phase6-keep-save")) localStorage.removeItem("whiteout.career-v2");
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  return { page, errors };
}
async function sample(page) {
  const frames = await page.evaluate(() => new Promise((resolve) => {
    const deltas = []; let last = 0;
    const tick = (now) => {
      if (last) deltas.push(now - last);
      last = now;
      if (deltas.length < 150) requestAnimationFrame(tick);
      else {
        const stats = window.__whiteoutDebug.stats();
        resolve({ deltas, calls: stats.calls, triangles: stats.triangles, fps: stats.fps, state: window.__whiteoutDebug.snapshot().state });
      }
    };
    requestAnimationFrame(tick);
  }));
  const body = frames.deltas.slice(15);
  const average = body.reduce((sum, value) => sum + value, 0) / body.length;
  return { state: frames.state, calls: frames.calls, triangles: frames.triangles, loopFps: Number(frames.fps.toFixed(1)), samples: body.length, frameMs: { avg: Number(average.toFixed(2)), p95: Number(percentile(body, 95).toFixed(2)), p99: Number(percentile(body, 99).toFixed(2)) } };
}

const report = { shots: [] };
try {
  const opened = await openPage();
  const page = opened.page;
  report.bench = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const round = (n) => Number(n.toFixed(2));
    const view = (id) => d.snapshot().buildings.find((item) => item.id === id);
    const upgrade = (id) => { d.teleport(view(id).x, view(id).z); const before = view(id).level; d.upgradeNearest(); return view(id).level > before; };
    const produced = (id) => {
      d.setOutput(id, 0);
      d.setInput(id, view(id).inputCapacity);
      let made = 0;
      for (let i = 0; i < 4; i++) {
        d.step(5);
        const after = view(id);
        made += after.output;
        d.setOutput(id, 0);
        if (after.input < after.inputCapacity * 0.45) d.setInput(id, after.inputCapacity);
      }
      return made;
    };
    d.start(); d.giveCredits(80000); d.setQuest(4);
    const rows = [];
    const run = (type, foundry) => {
      const id = d.build(type, 0, 22);
      for (let level = 1; level <= 3; level++) {
        const made = produced(id);
        const current = view(id);
        rows.push({ machine: type, level, foundry, efficiency: round(current.powerEfficiency), hud: round(current.productionRate ?? 0), made: round(made), perMin: round(made * 3), creditsPerMin: round(made * 3 * (type === "press" ? 42 : 6)) });
        if (level < 3) upgrade(id);
      }
      return id;
    };
    const purifier = run("purifier", false);
    const sweeper = d.build("sweeper", 10, 22);
    const stroke = d.commitStroke([{ x: 10, z: 22 }, { x: 0, z: 22 }]);
    const end = stroke.points[stroke.points.length - 1];
    const port = Math.hypot(end.x, end.z - 22);
    d.demolishBuilding(sweeper); d.demolishBuilding(purifier);
    const press = run("press", false);
    d.demolishBuilding(press);
    const gen = d.build("generator", 24, 10); d.teleport(24, 10); d.upgradeNearest(); d.upgradeNearest();
    const loaded = d.build("purifier", 24, 16);
    d.build("heater", 30, 12); d.build("heater", 30, 8);
    const loadedView = view(loaded);
    const loadedMade = produced(loaded);
    d.demolishBuilding(loaded);
    const foundryPlant = d.build("purifier", 0, 22); upgrade(foundryPlant); upgrade(foundryPlant);
    d.build("generator", -40, 12); d.teleport(-40, 12); d.upgradeNearest(); d.upgradeNearest();
    const repaired = d.repairRelay("foundry"); d.step(0.2);
    const foundry = d.snapshot().relays.find((relay) => relay.id === "foundry");
    const foundryMade = produced(foundryPlant);
    const foundryView = view(foundryPlant);
    rows.push({ machine: "purifier", level: 3, foundry: true, efficiency: round(foundryView.powerEfficiency), hud: round(foundryView.productionRate ?? 0), made: round(foundryMade), perMin: round(foundryMade * 3), creditsPerMin: round(foundryMade * 3 * 6), powered: !!foundry?.powered, repaired });
    return { rows, port: round(port), stroke: stroke.reason, loaded: { efficiency: round(loadedView.powerEfficiency), load: loadedView.powerLoad, capacity: loadedView.powerCapacity, perMin: round(loadedMade * 3) }, span: d.buildingSpan("purifier") };
  });

  report.yard = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const round = (n) => Number(n.toFixed(2));
    d.start(); d.giveCredits(400000); d.setQuest(4); d.teleport(0, 10);
    const fits = (x, z, radius) => Math.abs(x) <= 64 && Math.abs(z) <= 64 && d.obstacles().every((item) => Math.hypot(x - item.x, z - item.z) >= radius + item.r + 0.7);
    const gen = fits(40, -24, 1.5) ? d.build("generator", 40, -24) : 0;
    if (gen) { d.teleport(40, -24); d.upgradeNearest(); d.upgradeNearest(); }
    const purifier = d.build("purifier", 28, -24);
    const pressA = d.build("press", 28, -34);
    const pressB = d.build("press", 18, -24);
    const sweepers = [];
    for (const [x, z] of [[48, -12], [48, -20], [48, -28], [48, -36], [52, -16], [52, -32], [44, -8], [44, -40]]) {
      if (fits(x, z, 1.35) && d.powerPreview("sweeper", x, z).connected) sweepers.push(d.build("sweeper", x, z));
    }
    const spot = (id) => d.snapshot().buildings.find((item) => item.id === id);
    const line = (a, b) => d.commitStroke([{ x: spot(a).x, z: spot(a).z }, { x: spot(b).x, z: spot(b).z }]);
    const links = sweepers.filter(Boolean).map((id) => line(id, purifier));
    let merge = null;
    if (links[0]?.ok && sweepers[4]) {
      const a = spot(sweepers[0]); const p = spot(purifier);
      merge = d.commitStroke([{ x: spot(sweepers[4]).x, z: spot(sweepers[4]).z }, { x: (a.x + p.x) / 2, z: (a.z + p.z) / 2 }]);
    }
    const toPress = pressA ? line(purifier, pressA) : null;
    let split = null;
    if (toPress?.ok && pressB) {
      const p = spot(purifier); const a = spot(pressA);
      split = d.commitStroke([{ x: (p.x + a.x) / 2, z: (p.z + a.z) / 2 }, { x: spot(pressB).x, z: spot(pressB).z }]);
    }
    const crossGen = fits(-36, -40, 1.5) ? d.build("generator", -36, -40) : 0;
    if (crossGen) { d.teleport(-36, -40); d.upgradeNearest(); d.upgradeNearest(); }
    const crossIds = [[-48, -32], [-24, -48], [-48, -48], [-24, -32]].map(([x, z], index) => fits(x, z, index % 2 ? 1.75 : 1.35) ? d.build(index % 2 ? "purifier" : "sweeper", x, z) : 0);
    const crossTrunk = crossIds[0] && crossIds[1] ? line(crossIds[0], crossIds[1]) : null;
    const crossLine = crossIds[2] && crossIds[3] ? line(crossIds[2], crossIds[3]) : null;
    const idleSweeper = fits(56, -24, 1.35) ? d.build("sweeper", 56, -24) : 0;
    const idlePurifier = fits(36, -8, 1.75) ? d.build("purifier", 36, -8) : 0;
    const idle = idleSweeper && idlePurifier ? line(idleSweeper, idlePurifier) : null;
    const credits = d.snapshot().credits;
    const edgeId = idle?.ok ? d.netState().edges.at(-1)?.id : 0;
    const deleted = edgeId ? d.deleteEdge(edgeId) : { ok: false, reason: idle?.reason ?? "no-edge" };
    const deleteDelta = d.snapshot().credits - credits;
    for (const id of sweepers.filter(Boolean)) d.setOutput(id, 200);
    d.setInput(purifier, 10); d.setOutput(purifier, 0);
    const before = d.netState();
    const simStarted = performance.now();
    d.step(10);
    const simMs = performance.now() - simStarted;
    const after = d.netState();
    const retained = d.logistics().retained;
    const gap = after.account.dispatched - after.account.delivered - after.cargo - (retained.raw + retained.purified + retained.ice);
    for (const id of [purifier, pressA, pressB].filter(Boolean)) { d.teleport(spot(id).x, spot(id).z); d.upgradeNearest(); d.upgradeNearest(); }
    d.repairRelay("foundry"); d.step(0.2);
    d.setInput(purifier, viewSafe(purifier));
    function viewSafe(id) { return d.snapshot().buildings.find((item) => item.id === id)?.inputCapacity ?? 0; }
    const soldBefore = d.snapshot().sold;
    const iceBefore = d.snapshot().iceSold;
    d.setInput(purifier, viewSafe(purifier));
    for (let i = 0; i < 4; i++) { d.setInput(purifier, viewSafe(purifier)); d.step(5); }
    const soldAfter = d.snapshot();
    d.teleport(0, 10);
    const heatBefore = d.snapshot().heat;
    d.storm(true); d.step(8); d.teleport(0, 10);
    const sheltered = { state: d.snapshot().state, phase: d.snapshot().stormPhase, severe: d.snapshot().severeStorm, heat: round(d.snapshot().heat), heatBefore: round(heatBefore) };
    d.teleport(36, -24);
    const saveStarted = performance.now(); d.save(); const saveMs = performance.now() - saveStarted;
    sessionStorage.setItem("phase6-keep-save", "1");
    const saved = JSON.parse(localStorage.getItem("whiteout.career-v2"));
    return {
      built: { generator: !!gen, purifier: !!purifier, presses: [pressA, pressB].filter(Boolean).length, sweepers: sweepers.filter(Boolean).length },
      links: links.map((item) => item?.reason),
      merge: merge && { ok: merge.ok, reason: merge.reason, junctions: merge.junctions },
      toPress: toPress && { ok: toPress.ok, reason: toPress.reason },
      split: split && { ok: split.ok, reason: split.reason, junctions: split.junctions },
      cross: { trunk: crossTrunk?.reason ?? null, line: crossLine?.reason ?? null, junctions: crossLine?.junctions ?? [] },
      deleted: { ok: !!deleted?.ok, reason: deleted?.reason, creditDelta: round(deleteDelta) },
      traffic: { edges: after.edges.length, junctions: after.junctions.map((item) => item.kind), capsules: after.capsules.length, moved: after.capsules.filter((item) => item.distance > 1).length, maxWait: round(Math.max(0, ...after.capsules.map((item) => item.wait))), holds: after.capsules.filter((item) => item.hold).length, dispatched: round(after.account.dispatched), delivered: round(after.account.delivered), riding: round(after.cargo), gap: round(gap), beforeCapsules: before.capsules.length },
      delivery: { soldDelta: round(soldAfter.sold - soldBefore), iceSoldDelta: round(soldAfter.iceSold - iceBefore), credits: soldAfter.credits, foundry: soldAfter.relays.find((item) => item.id === "foundry")?.powered ?? false },
      sheltered, simMs: round(simMs), simFrameMs: round(simMs / 600), saveMs: round(saveMs), save: { version: saved.version, status: saved.status, buildings: saved.buildings.length, edges: saved.railNetwork.edges.length, capsules: saved.railNetwork.capsules.length, credits: saved.credits },
    };
  });
  await page.screenshot({ path: join(SHOTS, "04-rail-yard.png") });
  report.shots.push(join(SHOTS, "04-rail-yard.png"));
  report.yardFrames = await sample(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  report.reload = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const started = performance.now(); d.continue(); const loadMs = performance.now() - started;
    const state = d.snapshot(); const net = d.netState();
    return { loadMs: Number(loadMs.toFixed(1)), state: state.state, credits: state.credits, buildings: state.buildings.length, edges: net.edges.length, capsules: net.capsules.length, heat: Number(state.heat.toFixed(1)) };
  });
  await page.screenshot({ path: join(SHOTS, "05-reload-playing.png") });
  report.shots.push(join(SHOTS, "05-reload-playing.png"));

  const fleetPage = await openPage();
  report.fleet = await fleetPage.page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.giveCredits(500000); d.setQuest(4); d.teleport(0, 10);
    const placed = [];
    const fits = (x, z, radius) => Math.abs(x) <= 64 && Math.abs(z) <= 64 && d.obstacles().every((item) => Math.hypot(item.x - x, item.z - z) >= radius + item.r + 0.7) && placed.every((item) => Math.hypot(item.x - x, item.z - z) >= 5.4);
    const generators = [];
    for (let x = -48; x <= 48; x += 16) for (let z = -40; z <= 48; z += 16) {
      if (generators.length >= 8 || !fits(x, z, 1.5)) continue;
      const id = d.build("generator", x, z); if (!id) continue;
      d.teleport(x, z); d.upgradeNearest(); d.upgradeNearest();
      generators.push(id); placed.push({ x, z });
    }
    const docks = [];
    for (let x = -56; x <= 56 && docks.length < 18; x += 7) for (let z = -48; z <= 56 && docks.length < 18; z += 7) {
      if (!fits(x, z, 1.35) || !d.powerPreview("sweeper", x, z).connected) continue;
      const id = d.build("sweeper", x, z); if (!id) continue;
      docks.push(id); placed.push({ x, z });
    }
    for (const id of docks) { const b = d.snapshot().buildings.find((item) => item.id === id); d.teleport(b.x, b.z); d.upgradeNearest(); d.upgradeNearest(); d.buyExtraRobot(id); d.buyExtraRobot(id); }
    d.repairRelay("gale"); d.repairRelay("servo"); d.repairRelay("foundry"); d.step(0.2);
    const look = docks[0] ? d.snapshot().buildings.find((item) => item.id === docks[0]) : null;
    if (look) d.teleport(look.x, look.z);
    const state = d.snapshot();
    const started = performance.now(); d.step(4); const simMs = performance.now() - started;
    return {
      state: state.state, docks: docks.length, powered: state.buildings.filter((item) => item.type === "sweeper" && item.powered).length,
      robots: d.robotStates().filter((item) => item.kind === "sweeper").length, haulers: d.robotStates().filter((item) => item.kind === "hauler").length,
      generators: generators.length, relays: state.relays.filter((item) => item.repaired && item.powered).map((item) => item.id),
      simMs: Number(simMs.toFixed(1)), simFrameMs: Number((simMs / 240).toFixed(3)), heat: state.heat,
    };
  });
  await fleetPage.page.screenshot({ path: join(SHOTS, "06-eighteen-docks.png") });
  report.shots.push(join(SHOTS, "06-eighteen-docks.png"));
  report.fleetFrames = await sample(fleetPage.page);
  report.errors = { bench: opened.errors, fleet: fleetPage.errors };
  await writeFile(RESULT, JSON.stringify(report, null, 2));
  console.log("PHASE6B", JSON.stringify({ port: report.bench?.port, rows: report.bench?.rows?.map((row) => [row.machine, row.level, row.foundry, row.perMin]), yard: report.yard?.traffic, cross: report.yard?.cross, reload: report.reload, fleet: report.fleet, frames: report.fleetFrames }));
} finally {
  await browser.close();
  server.close();
}
