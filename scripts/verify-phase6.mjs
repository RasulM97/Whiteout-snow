import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const SHOTS = join(ROOT, "phase6-shots");
const RESULT = "D:/Game/reports/phase6-result.json";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".mp3": "audio/mpeg", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
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
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ["--enable-precise-memory-info"],
});

const report = { origin, defects: [], shots: [] };

async function openPage(quality, viewport, options = {}) {
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
    isMobile: options.isMobile ?? false,
    hasTouch: options.hasTouch ?? false,
  });
  page.setDefaultTimeout(0);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript((settings) => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify(settings));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
    if (!sessionStorage.getItem("phase6-keep-save")) localStorage.removeItem("whiteout.career-v2");
  }, {
    language: "en", quality, volume: 0, muted: true, cameraShake: false,
    particles: quality !== "low", uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false,
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  return { page, errors };
}

async function sampleFrames(page) {
  const frames = await page.evaluate(() => new Promise((resolve) => {
    const deltas = [];
    let last = 0;
    const tick = (now) => {
      if (last) deltas.push(now - last);
      last = now;
      if (deltas.length < 180) requestAnimationFrame(tick);
      else {
        const stats = window.__whiteoutDebug.stats();
        const memory = performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null;
        resolve({ deltas, calls: stats.calls, triangles: stats.triangles, fps: stats.fps, lowQuality: stats.lowQuality, renderer: stats.renderer, memory });
      }
    };
    requestAnimationFrame(tick);
  }));
  const body = frames.deltas.slice(20);
  const average = body.reduce((sum, value) => sum + value, 0) / body.length;
  return {
    renderer: frames.renderer,
    lowQuality: frames.lowQuality,
    calls: frames.calls,
    triangles: frames.triangles,
    loopFps: Number(frames.fps.toFixed(1)),
    samples: body.length,
    memory: frames.memory,
    frameMs: { avg: Number(average.toFixed(2)), p95: Number(percentile(body, 95).toFixed(2)), p99: Number(percentile(body, 99).toFixed(2)) },
  };
}

try {
  const economyPage = await openPage("high", { width: 1280, height: 720 });
  report.economy = await economyPage.page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const building = (id) => d.snapshot().buildings.find((item) => item.id === id);
    const round = (value) => Number(value.toFixed(2));
    d.start();
    d.giveCredits(80000);
    d.setQuest(4);
    const upgrade = (id) => {
      const before = building(id).level;
      d.teleport(building(id).x, building(id).z);
      d.upgradeNearest();
      return building(id).level === before + 1;
    };
    const fed = (id, seconds) => {
      let made = 0;
      const stalled = [];
      for (let t = 0; t < seconds; t += 5) {
        const current = building(id);
        if (current.input < current.inputCapacity * 0.5) d.setInput(id, current.inputCapacity);
        if (current.output > current.outputCapacity * 0.62) { made += current.output; d.setOutput(id, 0); stalled.push(false); }
        d.step(5);
      }
      made += building(id).output;
      return made;
    };
    const rows = [];
    const measure = (id, machine, foundry) => {
      const view = building(id);
      const made = fed(id, 20);
      const perMin = made * 3;
      rows.push({
        machine, level: view.level, foundry, efficiency: round(view.powerEfficiency),
        hudPerSec: round(view.productionRate ?? 0), made: round(made), perMin: round(perMin),
        creditsPerMin: round(perMin * (machine === "press" ? 42 : 6)),
        inputCap: view.inputCapacity, outputCap: view.outputCapacity,
      });
    };
    const purifier = d.build("purifier", 0, 22);
    for (let level = 1; level <= 3; level++) {
      measure(purifier, "purifier", false);
      if (level < 3 && !upgrade(purifier)) return { error: "purifier upgrade failed", rows };
    }
    d.demolishBuilding(purifier);
    const press = d.build("press", 0, 22);
    for (let level = 1; level <= 3; level++) {
      measure(press, "press", false);
      if (level < 3 && !upgrade(press)) return { error: "press upgrade failed", rows };
    }
    const full = building(press);
    d.setInput(press, full.inputCapacity);
    d.setOutput(press, full.outputCapacity);
    const inputBefore = building(press).input;
    d.step(4);
    const stalled = building(press);
    d.demolishBuilding(press);
    const loadedPlant = d.build("purifier", 22, 16);
    const loadedGen = d.build("generator", 24, 10);
    d.teleport(24, 10); d.upgradeNearest(); d.upgradeNearest();
    const heaters = [d.build("heater", 28, 14), d.build("heater", 30, 10)].filter(Boolean);
    const loadedView = building(loadedPlant);
    const loadedMade = fed(loadedPlant, 20);
    const lone = rows.find((row) => row.machine === "purifier" && row.level === 1 && !row.foundry);
    d.demolishBuilding(loadedPlant);
    for (const id of heaters) d.demolishBuilding(id);
    d.demolishBuilding(loadedGen);
    const foundryPlant = d.build("purifier", 0, 22);
    upgrade(foundryPlant); upgrade(foundryPlant);
    const foundryGen = d.build("generator", -40, 12);
    d.teleport(-40, 12); d.upgradeNearest(); d.upgradeNearest();
    const repaired = d.repairRelay("foundry");
    d.step(0.2);
    const foundry = d.snapshot().relays.find((relay) => relay.id === "foundry");
    measure(foundryPlant, "purifier", true);
    const span = d.buildingSpan("purifier");
    const obstacle = d.obstacles().find((item) => Math.hypot(item.x - 0, item.z - 22) < 0.2);
    d.setCarried(0, 1);
    d.teleport(7, 8);
    const creditsBefore = d.snapshot().credits;
    d.interact();
    const iceCredit = d.snapshot().credits - creditsBefore;
    return {
      rows,
      stall: { inputBefore: round(inputBefore), inputAfter: round(stalled.input), output: round(stalled.output), cap: stalled.outputCapacity },
      loaded: {
        efficiency: round(loadedView.powerEfficiency), load: loadedView.powerLoad, capacity: loadedView.powerCapacity,
        perMin: round(loadedMade * 3), lonePerMin: lone?.perMin ?? null, heaters: heaters.length, generator: !!loadedGen,
      },
      foundry: { repaired, powered: !!foundry?.powered, level: building(foundryPlant).level },
      purifier: { span, collisionRadius: obstacle?.r ?? null, iceCredit },
    };
  });
  report.economyErrors = economyPage.errors;
  await economyPage.page.close();

  report.comparable = [];
  for (const profile of [
    { name: "desktop-high", quality: "high", viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    { name: "desktop-low", quality: "low", viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    { name: "mobile-emulation-low", quality: "low", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ]) {
    const opened = await openPage(profile.quality, profile.viewport, profile);
    const fleet = await opened.page.evaluate(() => {
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
      const started = performance.now();
      d.step(5);
      const simMs = performance.now() - started;
      return {
        robots: d.robotStates().filter((robot) => robot.kind === "sweeper").length,
        haulers: d.robotStates().filter((robot) => robot.kind === "hauler").length,
        docks: state.buildings.filter((building) => building.type === "sweeper" && building.powered).length,
        heaters: state.buildings.filter((building) => building.type === "heater" && building.powered).length,
        generators: state.buildings.filter((building) => building.type === "generator" && building.powered).length,
        relays: state.relays.filter((relay) => relay.repaired && relay.powered).map((relay) => relay.id),
        simMs: Number(simMs.toFixed(1)),
        simFrameMs: Number((simMs / 300).toFixed(3)),
      };
    });
    const frames = await sampleFrames(opened.page);
    report.comparable.push({
      profile: profile.name,
      device: "emulated viewport on this machine, not a physical phone",
      scene: "same 6-dock 18-robot fleet as verify-perf, legacy guideways",
      fleet, frames, pageErrors: opened.errors,
    });
    await opened.page.close();
  }

  const stress = await openPage("high", { width: 1280, height: 720 });
  report.large = await stress.page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const round = (value) => Number(value.toFixed(2));
    d.start();
    d.giveCredits(500000);
    d.setQuest(4);
    const obstacles = () => d.obstacles();
    const fits = (x, z, radius) => Math.abs(x) <= 64 && Math.abs(z) <= 64 && obstacles().every((item) => Math.hypot(x - item.x, z - item.z) >= radius + item.r + 0.7);
    const near = (x, z, points, gap) => points.some((point) => Math.hypot(x - point.x, z - point.z) < gap);
    const placed = [];
    const put = (type, x, z, radius) => {
      if (!fits(x, z, radius) || near(x, z, placed, radius + 2.2)) return 0;
      const forecast = type === "generator" ? null : d.powerPreview(type, x, z);
      if (forecast && !forecast.connected) return 0;
      const id = d.build(type, x, z);
      if (!id) return 0;
      placed.push({ id, type, x, z });
      return id;
    };
    const upgradeTo = (id, level) => {
      const building = d.snapshot().buildings.find((item) => item.id === id);
      if (!building) return 0;
      d.teleport(building.x, building.z);
      while ((d.snapshot().buildings.find((item) => item.id === id)?.level ?? 1) < level) {
        const before = d.snapshot().buildings.find((item) => item.id === id).level;
        d.upgradeNearest();
        if (d.snapshot().buildings.find((item) => item.id === id).level === before) break;
      }
      return d.snapshot().buildings.find((item) => item.id === id).level;
    };
    const factories = {
      purifiers: [put("purifier", 0, 22, 1.75), put("purifier", -14, 18, 1.75), put("purifier", 14, 18, 1.75)].filter(Boolean),
      presses: [put("press", -10, 14, 1.7), put("press", 12, 16, 1.7)].filter(Boolean),
      haulers: [put("hauler", -6, 4, 1.35)].filter(Boolean),
    };
    const relayGenerators = [];
    for (const [x, z] of [[-40, 12], [36, 24], [-28, -28]]) {
      if (!fits(x, z, 1.5)) continue;
      const id = d.build("generator", x, z);
      if (id) { upgradeTo(id, 3); relayGenerators.push(id); placed.push({ id, type: "generator", x, z }); }
    }
    const relays = {};
    for (const id of ["foundry", "servo", "gale"]) relays[id] = d.repairRelay(id);
    d.step(0.2);
    const generators = [...relayGenerators];
    for (let x = -56; x <= 56 && generators.length < 10; x += 12) {
      for (let z = -52; z <= 56 && generators.length < 10; z += 12) {
        if (!fits(x, z, 1.5) || near(x, z, placed, 18)) continue;
        const id = d.build("generator", x, z);
        if (!id) continue;
        upgradeTo(id, 3);
        generators.push(id);
        placed.push({ id, type: "generator", x, z });
      }
    }
    const docks = [];
    for (let x = -58; x <= 58 && docks.length < 18; x += 6) {
      for (let z = -56; z <= 58 && docks.length < 18; z += 6) {
        if (!fits(x, z, 1.35) || near(x, z, placed, 5.2)) continue;
        if (!d.powerPreview("sweeper", x, z).connected) continue;
        const id = d.build("sweeper", x, z);
        if (!id) continue;
        docks.push(id);
        placed.push({ id, type: "sweeper", x, z });
      }
    }
    for (const id of docks) upgradeTo(id, 3);
    let extras = 0;
    for (const id of docks) {
      if (d.buyExtraRobot(id)) extras++;
      if (d.buyExtraRobot(id)) extras++;
    }
    const spot = (id) => d.snapshot().buildings.find((item) => item.id === id);
    const link = (from, to) => d.commitStroke([{ x: spot(from).x, z: spot(from).z }, { x: spot(to).x, z: spot(to).z }]);
    const rails = { direct: [], merge: null, split: null, cross: null, depot: null };
    const targetPurifier = factories.purifiers[0];
    for (const id of docks.slice(0, 8)) {
      if (!targetPurifier) break;
      rails.direct.push(link(id, targetPurifier));
    }
    if (docks[8] && targetPurifier && rails.direct[0]?.ok) {
      const first = spot(docks[0]);
      const plant = spot(targetPurifier);
      const mid = { x: (first.x + plant.x) / 2, z: (first.z + plant.z) / 2 };
      rails.merge = d.commitStroke([{ x: spot(docks[8]).x, z: spot(docks[8]).z }, mid]);
    }
    if (targetPurifier) rails.depot = d.commitStroke([{ x: spot(targetPurifier).x, z: spot(targetPurifier).z }, { x: 7, z: 8 }]);
    if (factories.presses[0] && rails.depot?.ok) {
      const plant = spot(targetPurifier);
      const mid = { x: (plant.x + 7) / 2, z: (plant.z + 8) / 2 };
      rails.split = d.commitStroke([mid, { x: spot(factories.presses[0]).x, z: spot(factories.presses[0]).z }]);
    }
    const crossPair = [];
    const candidates = [[-50, 42, -24, 42, -37, 54, -37, 30, -37, 42], [-48, -46, -24, -46, -36, -56, -36, -34, -36, -46]];
    for (const [ax, az, bx, bz, cx, cz, dx, dz, gx, gz] of candidates) {
      if (!fits(gx, gz, 1.5)) continue;
      const gen = d.build("generator", gx, gz);
      if (gen) { upgradeTo(gen, 3); placed.push({ id: gen, type: "generator", x: gx, z: gz }); }
      const ids = [put("sweeper", ax, az, 1.35), put("purifier", bx, bz, 1.75), put("sweeper", cx, cz, 1.35), put("purifier", dx, dz, 1.75)];
      if (ids.every(Boolean)) { crossPair.push(ids); break; }
    }
    if (crossPair.length) {
      const [s1, p1, s2, p2] = crossPair[0];
      const trunk = link(s1, p1);
      const crossing = link(s2, p2);
      rails.cross = { trunk, crossing };
    }
    const creditsBeforeDelete = d.snapshot().credits;
    const spare = docks[9] && factories.purifiers[1] ? link(docks[9], factories.purifiers[1]) : null;
    const deleted = spare?.ok ? d.deleteEdge(d.netState().edges.at(-1).id) : null;
    const deleteCredits = d.snapshot().credits - creditsBeforeDelete;
    for (const id of docks) d.setOutput(id, 70);
    for (const id of factories.purifiers) { d.setInput(id, 30); d.setOutput(id, 20); }
    for (const id of factories.presses) d.setInput(id, 40);
    const beforeNet = d.netState();
    const beforeLog = d.logistics();
    const beforeSold = d.snapshot().sold;
    const simStarted = performance.now();
    d.step(12);
    const simMs = performance.now() - simStarted;
    const afterNet = d.netState();
    const afterLog = d.logistics();
    const riding = afterNet.cargo;
    const retained = afterLog.retained.raw + afterLog.retained.purified + afterLog.retained.ice;
    const gap = afterNet.account.dispatched - (afterNet.account.delivered + riding + Math.max(0, retained - (beforeLog.retained.raw + beforeLog.retained.purified + beforeLog.retained.ice)));
    const moved = afterNet.capsules.filter((capsule) => capsule.distance > 1).length;
    const maxWait = afterNet.capsules.reduce((max, capsule) => Math.max(max, capsule.wait), 0);
    d.storm(false);
    d.step(14);
    const normalStorm = { phase: d.snapshot().stormPhase, severe: d.snapshot().severeStorm };
    d.storm(true);
    d.step(16);
    const severeStorm = { phase: d.snapshot().stormPhase, severe: d.snapshot().severeStorm, frozen: d.snapshot().frozenRobots };
    const haulerBefore = d.robotStates().filter((robot) => robot.kind === "hauler").map((robot) => robot.mode);
    if (docks[0]) d.freezeRobot(docks[0], 0);
    d.step(6);
    const haulerAfter = d.robotStates().filter((robot) => robot.kind === "hauler").map((robot) => ({ mode: robot.mode, x: round(robot.x), z: round(robot.z) }));
    const state = d.snapshot();
    const power = d.powerState();
    const visual = d.netVisual();
    const heapBefore = performance.memory ? performance.memory.usedJSHeapSize : null;
    d.step(8);
    const heapAfter = performance.memory ? performance.memory.usedJSHeapSize : null;
    const saveStarted = performance.now();
    d.save();
    const saveMs = performance.now() - saveStarted;
    const raw = localStorage.getItem("whiteout.career-v2");
    const saved = JSON.parse(raw);
    sessionStorage.setItem("phase6-keep-save", "1");
    const levels = {};
    for (const building of state.buildings) levels[`${building.type}-L${building.level}`] = (levels[`${building.type}-L${building.level}`] ?? 0) + 1;
    return {
      counts: {
        buildings: state.buildings.length,
        docks: docks.length,
        poweredDocks: state.buildings.filter((building) => building.type === "sweeper" && building.powered).length,
        robots: state.robotCount,
        sweepers: d.robotStates().filter((robot) => robot.kind === "sweeper").length,
        haulers: d.robotStates().filter((robot) => robot.kind === "hauler").length,
        purifiers: factories.purifiers.length,
        presses: factories.presses.length,
        generators: generators.length,
        poweredGenerators: state.buildings.filter((building) => building.type === "generator" && building.powered).length,
        extras,
        levels,
      },
      relays: state.relays.map((relay) => ({ id: relay.id, repaired: relay.repaired, powered: relay.powered })),
      rails: {
        directOk: rails.direct.filter((item) => item?.ok).length,
        directReasons: rails.direct.map((item) => item?.reason),
        merge: rails.merge ? { ok: rails.merge.ok, reason: rails.merge.reason, junctions: rails.merge.junctions } : null,
        split: rails.split ? { ok: rails.split.ok, reason: rails.split.reason, junctions: rails.split.junctions } : null,
        cross: rails.cross ? { trunk: rails.cross.trunk?.reason, crossing: rails.cross.crossing?.ok, reason: rails.cross.crossing?.reason, junctions: rails.cross.crossing?.junctions } : null,
        depot: rails.depot ? { ok: rails.depot.ok, reason: rails.depot.reason } : null,
        edges: afterNet.edges.length,
        junctions: afterNet.junctions.map((junction) => junction.kind),
        visual,
      },
      cargo: {
        dispatched: round(afterNet.account.dispatched),
        delivered: round(afterNet.account.delivered),
        riding: round(riding),
        retained: round(retained),
        gap: round(gap),
        capsules: afterNet.capsules.length,
        moved,
        maxWait: round(maxWait),
        holds: afterNet.capsules.filter((capsule) => capsule.hold).length,
        soldDelta: round(state.sold - beforeSold),
        credits: state.credits,
      },
      deleteCheck: { deleted: deleted?.ok ?? false, reason: deleted?.reason ?? null, creditDelta: deleteCredits },
      storms: { normalStorm, severeStorm },
      rescue: { before: haulerBefore, after: haulerAfter },
      timing: { simMs: round(simMs), simFrameMs: round(simMs / (12 * 60)), saveMs: round(saveMs), saveBytes: raw.length, heapBefore, heapAfter, heapDelta: heapBefore == null ? null : heapAfter - heapBefore },
      save: { version: saved.version, buildings: saved.buildings.length, edges: saved.railNetwork?.edges?.length ?? 0, capsules: saved.railNetwork?.capsules?.length ?? 0, credits: saved.credits },
      unpowered: power.filter((item) => !item.powered && state.buildings.find((building) => building.id === item.id && building.type !== "generator")).map((item) => item.id).length,
    };
  });
  const shotBase = join(SHOTS, "01-large-base.png");
  const shotPlant = join(SHOTS, "02-purifiers.png");
  await stress.page.screenshot({ path: shotBase });
  await stress.page.evaluate(() => window.__whiteoutDebug.teleport(0, 18));
  await stress.page.evaluate(() => window.__whiteoutDebug.step(0.2));
  await stress.page.screenshot({ path: shotPlant });
  report.shots.push(shotBase, shotPlant);
  report.stressErrors = stress.errors;
  await stress.page.reload({ waitUntil: "domcontentloaded" });
  await stress.page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  report.reload = await stress.page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const started = performance.now();
    d.continue();
    const loadMs = performance.now() - started;
    const state = d.snapshot();
    const net = d.netState();
    return {
      loadMs: Number(loadMs.toFixed(1)),
      state: state.state,
      versionSeen: true,
      credits: state.credits,
      buildings: state.buildings.length,
      edges: net.edges.length,
      capsules: net.capsules.length,
      cargo: Number(net.cargo.toFixed(2)),
      robots: state.robotCount,
      schemaHint: state.buildings.length,
    };
  });
  const shotReload = join(SHOTS, "03-after-reload.png");
  await stress.page.screenshot({ path: shotReload });
  report.shots.push(shotReload);
  const frames = await sampleFrames(stress.page);
  report.largeFrames = {
    profile: "desktop-high",
    device: "emulated viewport on this machine, not a physical phone",
    scene: "largest valid powered base in this run; not comparable to the 6-dock scene",
    frames,
  };
  await stress.page.close();

  const defects = [];
  if (Math.abs((report.economy?.iceCredit ?? 0) - 42) > 0.01) defects.push(`ice sale credited ${report.economy?.iceCredit}, expected 42`);
  if (report.economy?.purifier?.collisionRadius !== 1.75) defects.push(`purifier collision radius is ${report.economy?.purifier?.collisionRadius}`);
  const gap = report.large?.cargo?.gap;
  if (gap != null && Math.abs(gap) > 1) defects.push(`cargo account gap ${gap}`);
  if ((report.large?.cargo?.capsules ?? 0) > 48) defects.push(`capsule count ${report.large.cargo.capsules} exceeded 48`);
  if (report.large?.deleteCheck?.deleted && Math.abs(report.large.deleteCheck.creditDelta) > 0.01) defects.push("deleting an idle rail changed credits");
  if (report.large?.save?.version !== 11) defects.push(`save schema ${report.large?.save?.version}`);
  if (report.reload && report.large?.save) {
    if (report.reload.buildings !== report.large.save.buildings) defects.push("reload building count changed");
    if (report.reload.edges !== report.large.save.edges) defects.push("reload edge count changed");
    if (Math.abs(report.reload.credits - report.large.save.credits) > 0.01) defects.push("reload credits changed");
    if (report.reload.capsules !== report.large.save.capsules) defects.push("reload capsule count changed");
  }
  if (report.comparable.some((row) => row.fleet.robots !== 18 || row.fleet.docks !== 6)) defects.push("comparable 18-robot fleet did not build");
  report.defects = defects;
  report.pageErrors = {
    economy: report.economyErrors,
    stress: report.stressErrors,
  };
  await writeFile(RESULT, JSON.stringify(report, null, 2));
  console.log("PHASE6", JSON.stringify({ defects, economyRows: report.economy?.rows?.length, docks: report.large?.counts?.docks, robots: report.large?.counts?.robots, edges: report.large?.rails?.edges, capsules: report.large?.cargo?.capsules, reload: report.reload?.state }));
  if (defects.length || report.economyErrors?.length || report.stressErrors?.length) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
