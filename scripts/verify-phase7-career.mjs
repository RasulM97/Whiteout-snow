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

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(0);
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (msg) => { if (msg.type() === "log") console.log(msg.text()); });
  await page.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
    localStorage.removeItem("whiteout.career-v2");
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);

  const result = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const UNLOCK = { purifier: 1, press: 4, heater: 8, generator: 7, sweeper: 7, hauler: 7 };
    const COST = { purifier: 120, press: 480, heater: 280, generator: 520, sweeper: 780, hauler: 2200 };
    const log = [];
    const notes = [];
    d.start();
    const opened = d.snapshot();
    if (opened.credits !== 0 || opened.quest.index !== 0) throw new Error(`career did not start clean ${JSON.stringify({ credits: opened.credits, quest: opened.quest.index })}`);

    const snap = () => d.snapshot();
    const mark = (label, extra = {}) => {
      const s = snap();
      const row = {
        t: Number((s.runTime / 60).toFixed(2)), label, credits: s.credits, quest: s.quest.index,
        progress: Number(s.quest.progress.toFixed(2)), target: s.quest.target, cleanup: Number(s.cleanupPercent.toFixed(2)),
        certified: s.cleanupCertified, power: Number(s.power.toFixed(2)), cores: s.cores, sold: s.sold,
        produced: Number(s.produced.toFixed(1)), state: s.state, raw: Number(s.raw.toFixed(2)),
        pure: Number(s.purified.toFixed(2)), ice: s.ice, buildings: s.buildings.length, ...extra,
      };
      log.push(row); console.log("CAREER", JSON.stringify(row)); return row;
    };
    const warm = () => { d.teleport(0, 10); if (snap().heat < 90) d.step(Math.min(8, (100 - snap().heat) / 20)); };
    const alive = () => {
      if (snap().state === "gameover") { notes.push(`heat death at ${ (snap().runTime / 60).toFixed(2) } min`); d.teleport(0, 10); return false; }
      return snap().state === "playing" || snap().state === "victory";
    };
    const snowSpot = () => {
      let best = { x: 22, z: 24 }, score = -1;
      for (let z = -50; z <= 54; z += 7) for (let x = -50; x <= 54; x += 7) {
        const density = d.snowAt(x, z);
        const near = Math.hypot(x, z - 10);
        const rank = density - near * 0.004;
        if (density > 0.35 && rank > score) { score = rank; best = { x, z: z + 1.4 }; }
      }
      return best;
    };
    const gatherRaw = () => {
      let guard = 0;
      while (snap().load < snap().capacity - 0.15 && snap().heat > 34 && guard++ < 6 && snap().state === "playing") {
        const spot = snowSpot(); d.teleport(spot.x, spot.z); d.holdClear(true); d.step(1.1); d.holdClear(false);
      }
      d.holdClear(false);
      if (snap().state !== "playing") alive();
      if (snap().heat < 40) warm();
    };
    const sellCargo = () => { d.teleport(7, 8); d.interact(); warm(); };
    const visit = (id) => { const b = snap().buildings.find((item) => item.id === id); if (!b) return false; d.teleport(b.x, b.z); d.interact(); return true; };
    const buy = (type, x, z) => {
      const before = snap();
      if (before.quest.index < UNLOCK[type]) { notes.push(`refused ${type} before quest ${UNLOCK[type]}`); return 0; }
      if (before.credits < COST[type]) return 0;
      const id = d.buyBuilding(type, x, z);
      if (!id) { notes.push(`buy ${type} failed at ${before.credits}`); return 0; }
      mark(`bought ${type}`, { id, spent: before.credits - snap().credits });
      return id;
    };
    const afford = (type) => snap().quest.index >= UNLOCK[type] && snap().credits >= COST[type];
    const repairAll = () => { for (const b of snap().buildings) if (b.damaged) d.repairBuilding(b.id); };

    mark("fresh career");
    let spins = 0;
    while (snap().quest.index < 1 && spins++ < 40 && snap().state !== "victory") {
      gatherRaw(); sellCargo();
      if (snap().quest.index < 1 && snap().credits >= 45) { const before = snap().credits; d.buyTool("shovel"); if (snap().credits < before) mark("bought shovel", { spent: before - snap().credits }); }
    }
    mark("after first contract");
    spins = 0;
    while (!afford("purifier") && spins++ < 50) { gatherRaw(); sellCargo(); }
    const purifier = buy("purifier", 4, 16);
    if (!purifier) throw new Error(`could not buy purifier ${JSON.stringify(log.at(-1))}`);

    const feedPurifier = () => { gatherRaw(); d.teleport(4, 16); d.interact(); warm(); };
    spins = 0;
    while (snap().quest.index < 3 && spins++ < 80) {
      feedPurifier();
      d.step(4); warm();
      let pulls = 0;
      while (pulls++ < 4 && snap().load < snap().capacity - 0.2) { if (!visit(purifier)) break; if (snap().purified < 0.2 && snap().raw > 0.2) break; }
      if (snap().purified > 0.2 || snap().ice > 0) sellCargo();
      if (snap().quest.index >= 1 && snap().credits >= 160 && snap().tools.brush < 1) { const before = snap().credits; d.buyTool("brush"); d.selectTool("brush"); if (snap().credits < before) mark("bought brush", { spent: before - snap().credits }); }
    }
    mark("purified contract done");

    spins = 0;
    while (!afford("press") && spins++ < 40) { feedPurifier(); d.step(5); warm(); visit(purifier); if (snap().purified > 0.2) sellCargo(); }
    const press = buy("press", -4, 16);
    if (!press) notes.push("press not affordable at quest gate");
    spins = 0;
    while (press && snap().quest.index < 6 && spins++ < 70) {
      feedPurifier();
      let moved = 0;
      while (moved++ < 3 && snap().purified < snap().capacity - 1) { visit(purifier); if (snap().purified < 0.2) break; }
      d.teleport(-4, 16); d.interact();
      warm(); d.step(3);
      if (snap().ice > 0 || snap().purified > 0.2) sellCargo();
    }
    mark("reached rail contract");

    let rail = false;
    if (snap().quest.index >= 6) {
      const before = snap().credits;
      rail = d.buyRail(purifier, 0);
      if (rail) mark("railed purifier to depot", { spent: before - snap().credits });
      else notes.push("purifier rail was refused");
    }
    spins = 0;
    while (snap().quest.index < 7 && spins++ < 80) {
      feedPurifier(); warm(); d.step(8); repairAll();
    }
    mark("rail contract done");

    const sweeper = buy("sweeper", 8, 4);
    if (sweeper) {
      const dock = () => snap().buildings.find((item) => item.id === sweeper);
      if (dock() && dock().level < 2 && snap().credits >= 560) {
        const before = snap().credits;
        d.teleport(dock().x, dock().z); d.upgradeNearest();
        if (snap().credits < before) mark("upgraded sweeper", { spent: before - snap().credits, level: dock().level });
      }
      if (dock() && (dock().robots?.length ?? 0) < 2 && snap().credits >= 390) {
        const before = snap().credits;
        const extra = d.buyExtraRobot(sweeper);
        if (extra) mark("bought second sweeper robot", { spent: before - snap().credits });
        else notes.push("second robot was refused");
      }
      if (snap().quest.index >= 6) {
        const railBefore = snap().credits;
        const linked = d.buyRail(sweeper, purifier);
        if (linked) mark("railed sweeper to purifier", { spent: railBefore - snap().credits });
      }
    } else notes.push("sweeper was not purchased");
    mark("robots online");

    const heaterSpots = [[0, 18], [12, 14], [-10, 16]];
    const heaters = [];
    let generator = 0;
    spins = 0;
    while (snap().quest.index < 9 && spins++ < 40) {
      warm(); d.step(20); repairAll();
      if (!generator && afford("generator")) generator = buy("generator", 18, 10);
      if (snap().quest.index >= 8) {
        while (heaters.length < 3 && afford("heater")) heaters.push(buy("heater", ...heaterSpots[heaters.length]));
        if (generator && heaters.length === 3 && afford("heater")) heaters.push(buy("heater", 18, 18));
      }
      if (snap().buildings.filter((b) => b.type === "heater" && b.powered).length >= 4) break;
      if (snap().credits < 280 && spins % 2 === 0) mark("earning for heaters");
    }
    mark("heater gate", { poweredHeaters: snap().buildings.filter((b) => b.type === "heater" && b.powered).length });

    const cores = [{ id: "comms", x: -36.45, z: -29.7 }, { id: "habitat", x: 40.5, z: -25.65 }, { id: "command", x: -40.5, z: 39.15 }];
    for (const core of cores) {
      d.teleport(core.x, core.z + 1.2);
      d.holdClear(true); d.step(2.5); d.holdClear(false);
      if (snap().scannerCooldown > 0) d.step(snap().scannerCooldown + 0.1);
      d.scan();
      d.step(1);
      d.teleport(core.x, core.z); d.interact();
      warm();
    }
    mark("cores visited");

    const relayOrder = [["gale", 650], ["servo", 1050], ["foundry", 1450]];
    for (const [id, cost] of relayOrder) {
      let wait = 0;
      while (snap().credits < cost && snap().quest.index >= 2 && wait++ < 15 && snap().state === "playing") {
        warm(); d.step(20); repairAll(); mark(`earning for ${id}`);
      }
      if (snap().quest.index >= 2 && snap().credits >= cost) {
        const before = snap().credits;
        const ok = d.repairRelay(id);
        if (ok) mark(`repaired ${id}`, { spent: before - snap().credits });
      }
    }
    mark("relays attempted", { mission: snap().power });

    const upgradeCost = { purifier: 260, press: 440, heater: 240, generator: 460, sweeper: 560, hauler: 880 };
    const upgradeAt = (id) => {
      const building = snap().buildings.find((item) => item.id === id);
      if (!building || building.level >= 3) return false;
      const cost = upgradeCost[building.type] * building.level;
      if (snap().credits < cost) return false;
      const before = snap().credits;
      d.teleport(building.x, building.z); d.upgradeNearest();
      const now = snap().buildings.find((item) => item.id === id);
      if (snap().credits < before && now && now.level > building.level) {
        mark(`upgraded ${building.type}`, { id, spent: before - snap().credits, level: now.level });
        return true;
      }
      return false;
    };
    const setZones = (mode) => {
      for (const building of snap().buildings) if (building.type === "sweeper") for (const robot of building.robots ?? []) {
        if (robot.zoneMode !== mode) d.setRobotZoneMode(building.id, robot.slot, mode);
      }
    };
    const expand = () => {
      const raise = (type) => {
        const building = snap().buildings.find((item) => item.type === type);
        let guard = 0;
        while (building && guard++ < 3 && upgradeAt(building.id)) {}
      };
      raise("purifier");
      raise("press");
      if (snap().credits >= 520 && !snap().buildings.some((item) => item.type === "generator" && Math.hypot(item.x + 45.9, item.z - 10.8) < 12)) buy("generator", -40, 12);
      const foundry = snap().relays?.find((relay) => relay.id === "foundry");
      if (foundry && !foundry.repaired && snap().credits >= 1450 && snap().quest.index >= 2) {
        const before = snap().credits;
        if (d.repairRelay("foundry")) mark("repaired foundry during expansion", { spent: before - snap().credits, powered: snap().relays.find((relay) => relay.id === "foundry")?.powered });
      }
      const phase = snap().stormPhase;
      setZones(phase === "warning" || phase === "storm" ? "shelter" : "auto");
      const generators = () => snap().buildings.filter((item) => item.type === "generator" && item.powered);
      if (!snap().buildings.some((item) => item.type === "hauler") && snap().credits >= 2200 && snap().quest.index >= 7) {
        const host = generators().find((item) => item.powerLoad < item.powerCapacity) ?? generators()[0];
        if (host && host.powerLoad >= host.powerCapacity) upgradeAt(host.id);
        const ready = generators().find((item) => item.powerLoad < item.powerCapacity);
        if (ready && snap().credits >= 2200) buy("hauler", ready.x, ready.z + 4);
      }
      if (!snap().buildings.some((item) => item.type === "hauler")) return;
      let actions = 0;
      while (actions < 4 && snap().buildings.filter((item) => item.type === "sweeper").length < 6 && snap().state === "playing") {
        const host = generators().find((item) => item.powerLoad < item.powerCapacity);
        if (host && snap().credits >= 780) {
          const radius = 9 + (host.level - 1) * 4;
          const spots = [[6, 0], [-6, 0], [0, 6], [0, -6], [8, 4], [-8, 4]];
          let placed = 0;
          for (const [dx, dz] of spots) {
            const x = host.x + dx; const z = host.z + dz;
            if (Math.hypot(dx, dz) > radius - 1.6) continue;
            if (snap().buildings.some((item) => Math.hypot(item.x - x, item.z - z) < 3.2)) continue;
            placed = buy("sweeper", x, z);
            if (placed) { d.buyRail(placed, purifier); break; }
          }
          if (!placed) break;
          actions++;
          continue;
        }
        if (snap().credits < 1300 || generators().length >= 3) break;
        const anchor = generators()[0] ?? { x: 0, z: 10 };
        const sites = [[-22, 10], [40, 10], [18, 28]];
        let added = 0;
        for (const [x, z] of sites) {
          const reach = Math.min(Math.abs(x - anchor.x) + Math.abs(z - anchor.z), Math.abs(x) + Math.abs(z - 10));
          if (reach > 68 || snap().buildings.some((item) => Math.hypot(item.x - x, item.z - z) < 8)) continue;
          added = buy("generator", x, z);
          if (added) break;
        }
        if (!added) break;
        actions++;
      }
      for (const dock of snap().buildings.filter((item) => item.type === "sweeper" && item.powered)) {
        if (dock.level < 3 && snap().credits >= upgradeCost.sweeper * dock.level) { upgradeAt(dock.id); break; }
        const live = snap().buildings.find((item) => item.id === dock.id);
        if (live && (live.robots?.length ?? 0) < live.level && snap().credits >= 390) {
          const before = snap().credits;
          if (d.buyExtraRobot(live.id)) mark("bought extra robot", { id: live.id, spent: before - snap().credits });
          break;
        }
      }
    };
    const curve = [];
    let overflow = { discardedMass: 0, sold: 0, credits: 0, samples: 0 };
    while (snap().state === "playing" && snap().runTime < 220 * 60 && curve.length < 120) {
      expand();
      const before = snap();
      const massBefore = d.snowMass();
      warm(); d.step(90); repairAll(); warm();
      const after = snap();
      const massAfter = d.snowMass();
      const docks = after.buildings.filter((b) => b.type === "sweeper");
      const full = docks.filter((b) => b.output >= b.outputCapacity - 0.05).length;
      const robots = d.robotStates().filter((robot) => robot.kind === "sweeper");
      const row = {
        t: Number((after.runTime / 60).toFixed(2)), cleanup: Number(after.cleanupPercent.toFixed(2)), certified: after.cleanupCertified,
        credits: after.credits, sold: after.sold, full, state: after.state, frozen: after.frozenRobots,
        robots: robots.length, docks: docks.length, powered: docks.filter((b) => b.powered).length, haulers: after.buildings.filter((b) => b.type === "hauler").length,
      };
      curve.push(row); console.log("CLEAR", JSON.stringify(row));
      if (full > 0) {
        overflow.samples++;
        overflow.discardedMass += Math.max(0, massBefore - massAfter);
        overflow.sold += Math.max(0, after.sold - before.sold);
        overflow.credits += after.credits - before.credits;
      }
      if (after.cleanupCertified || after.state === "victory") break;
    }
    const final = snap();
    return {
      victory: final.state === "victory", certified: final.cleanupCertified, minute: Number((final.runTime / 60).toFixed(2)),
      credits: final.credits, sold: final.sold, power: final.power, cores: final.cores, quest: final.quest.index,
      cleanup: Number(final.cleanupPercent.toFixed(2)), buildings: final.buildings.map((b) => ({ type: b.type, level: b.level, powered: b.powered })),
      tools: final.tools, log, notes, curve, overflow, errors: [],
      freeze: d.freezeLog().map((event) => ({
        t: Number((event.time / 60).toFixed(2)), id: event.id, slot: event.slot, kind: event.kind,
        x: Number(event.x.toFixed(1)), z: Number(event.z.toFixed(1)), mode: event.mode,
        carry: Number(event.carry.toFixed(1)), returning: event.returning,
        gap: Number(event.gap.toFixed(1)), storm: Number(event.storm.toFixed(2)),
      })),
    };
  });
  console.log("CAREER RESULT", JSON.stringify({ victory: result.victory, certified: result.certified, minute: result.minute, credits: result.credits, sold: result.sold, power: result.power, cores: result.cores, quest: result.quest, cleanup: result.cleanup, notes: result.notes, overflow: result.overflow, buildings: result.buildings, tools: result.tools, freezeCount: result.freeze.length, freeze: result.freeze }));
  if (errors.length) console.log("PAGE ERRORS", errors.join(" | "));
} finally {
  await browser.close();
  server.close();
}
