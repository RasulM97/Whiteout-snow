import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const SHOTS = join(ROOT, "batch3-shots");
await mkdir(SHOTS, { recursive: true });
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
const assert = (value, message) => { if (!value) throw new Error(message); console.log("PASS:", message); };

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  await page.evaluate(() => localStorage.removeItem("whiteout.career-v2"));

  const rails = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.setQuest(8); d.giveCredits(8000); d.teleport(0, 10);
    const sweeper = d.build("sweeper", 8, 14);
    const purifier = d.build("purifier", 8, 24);
    const straight = d.buyRail(sweeper, purifier);
    const straightState = d.railState()[0];
    const beforeStraight = d.snapshot().credits;
    const side = d.editRail(sweeper, purifier, [{ x: 18, z: 19 }]);
    const afterLonger = d.snapshot().credits;
    const bent = d.railState()[0];
    const shorter = d.editRail(sweeper, purifier, []);
    const afterShorter = d.snapshot().credits;
    const restoredStraight = d.railState()[0];
    d.setOutput(sweeper, 30); d.step(0.8);
    const busyBefore = d.railState()[0];
    const busyCredits = d.snapshot().credits;
    const busyEdit = d.editRail(sweeper, purifier, [{ x: 16, z: 18 }]);
    const busyAfter = d.railState()[0];
    d.save();
    return {
      straight, straightPoints: straightState.path.length, straightTotal: straightState.total, straightLane: straightState.lane,
      side, longerCost: beforeStraight - afterLonger, bentPoints: bent.path.length, bentTotal: bent.total,
      shorter, refund: afterShorter - afterLonger, restoredPoints: restoredStraight.path.length,
      busyEdit, busyCargo: busyBefore.cargo, busyAfterCargo: busyAfter.cargo,
      busyActive: busyBefore.activeCapsules, busyAfterActive: busyAfter.activeCapsules,
      busyDistances: busyBefore.capsules.filter((c) => c.active).map((c) => c.distance),
      afterDistances: busyAfter.capsules.filter((c) => c.active).map((c) => c.distance),
      creditDrift: d.snapshot().credits - busyCredits,
    };
  });
  assert(rails.straight && rails.straightPoints === 2 && rails.straightTotal > 8 && rails.straightTotal < 12, "one straight connection keeps a two-point path and its real length");
  assert(rails.side.ok && rails.bentPoints === 3 && rails.bentTotal > rails.straightTotal + 2 && rails.longerCost > 0, "a waypoint lengthens the charged path and costs only the increase");
  assert(rails.shorter.ok && rails.refund === 0 && rails.restoredPoints === 2, "removing the waypoint by a shorter confirm never refunds credits");
  assert(rails.busyEdit.ok && Math.abs(rails.busyAfterCargo - rails.busyCargo) < 0.01 && rails.busyAfterActive === rails.busyActive && rails.creditDrift <= 0, "an edit keeps the same in-flight cargo and does not mint credits");
  assert(rails.afterDistances.every((distance, index) => Math.abs(distance - rails.busyDistances[index]) < rails.bentTotal), "active capsules stay on the route instead of being reissued");

  const parallel = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.setQuest(8); d.giveCredits(8000);
    const purifier = d.build("purifier", 16, 8);
    const a = d.build("sweeper", 6, 18);
    const b = d.build("sweeper", 6.4, 18);
    const c = d.build("sweeper", 7, 20);
    d.buyRail(a, purifier); d.buyRail(b, purifier); d.buyRail(c, purifier);
    const routes = d.railState();
    d.teleport(10, 14); d.setAzimuth(Math.PI); d.step(0.2);
    return { count: routes.length, dest: routes.every((route) => route.destinationId === purifier), lanes: routes.map((route) => route.lane), mids: routes.map((route) => route.midpoint), totals: routes.map((route) => route.total) };
  });
  assert(parallel.count === 3 && parallel.dest, "several sources can feed one destination");
  assert(new Set(parallel.lanes).size >= 2, "parallel routes receive different lanes");
  const spread = Math.max(...parallel.mids.map((mid) => mid.x)) - Math.min(...parallel.mids.map((mid) => mid.x));
  assert(spread > 0.5, `parallel routes are visually separated (${spread.toFixed(2)} m)`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOTS, "rails-before.png") });
  await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const routes = d.railState();
    routes.forEach((route, index) => d.editRail(route.sourceId, route.destinationId, [{ x: 2 + index * 6, z: 13 }]));
    d.teleport(10, 14); d.setAzimuth(Math.PI); d.step(0.2);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOTS, "rails-after.png") });
  const separated = await page.evaluate(() => window.__whiteoutDebug.railState().map((route) => route.midpoint.x));
  assert(Math.max(...separated) - Math.min(...separated) > 4, "edited waypoints pull overlapping routes apart");

  const rules = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.setQuest(8); d.giveCredits(5000);
    const sweeper = d.build("sweeper", 10, 16);
    const purifier = d.build("purifier", 10, 28);
    d.build("heater", 16, 22);
    d.buyRail(sweeper, purifier);
    const credits = d.snapshot().credits;
    const blocked = d.editRail(sweeper, purifier, [{ x: 16, z: 22 }]);
    const afterBlock = d.snapshot().credits;
    const path = d.railState()[0].path.length;
    const invalid = d.editRail(sweeper, 0, []);
    const afterInvalid = d.snapshot().credits;
    return { blocked, afterBlock: afterBlock === credits, path, invalid, afterInvalid: afterInvalid === credits, rails: d.railState().length };
  });
  assert(!rules.blocked.ok && rules.blocked.reason === "blocked" && rules.afterBlock && rules.path === 2, "a route through a building is refused without charging");
  assert(!rules.invalid.ok && rules.afterInvalid && rules.rails === 1, "raw snow still cannot be routed to the sales depot");

  await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.setOutput(d.railState()[0].sourceId, 20); d.step(0.5); d.pause();
    const saved = JSON.parse(localStorage.getItem("whiteout.career-v2"));
    delete saved.rails[0].routed; delete saved.rails[0].lane; delete saved.rails[0].paid;
    localStorage.setItem("whiteout.career-v2", JSON.stringify(saved));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  await page.click("#continue-btn");
  const legacy = await page.evaluate(() => {
    const route = window.__whiteoutDebug.railState()[0];
    return { routed: route.routed, points: route.path.length, cargo: route.cargo, total: route.total };
  });
  assert(legacy.routed === false && legacy.points === 2 && legacy.cargo > 0 && legacy.total > 2, `an old straight rail loads without lane data and keeps its cargo ${JSON.stringify(legacy)}`);

  const edited = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const route = d.railState()[0];
    const result = d.editRail(route.sourceId, route.destinationId, [{ x: 24, z: 20 }]);
    d.pause();
    return result;
  });
  assert(edited.ok, `edited route can be saved (${edited.reason})`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  await page.click("#continue-btn");
  const kept = await page.evaluate(() => window.__whiteoutDebug.railState()[0]);
  assert(kept.routed === true && kept.path.length === 3 && kept.cargo > 0, `an edited route and its cargo survive save and reload ${JSON.stringify(kept)}`);

  const production = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const measure = (type, level, seconds) => {
      d.start(); d.setQuest(8); d.giveCredits(20000); d.teleport(0, 10);
      const id = d.build(type, 2, 12);
      let guard = 0;
      while (d.snapshot().buildings.find((b) => b.id === id).level < level && guard++ < 4) {
        d.teleport(2, 12); d.upgradeNearest();
      }
      d.setInput(id, 900); d.setOutput(id, 0);
      const before = d.snapshot();
      const started = before.runTime;
      d.step(seconds);
      const after = d.snapshot();
      const building = after.buildings.find((b) => b.id === id);
      const minutes = (after.runTime - started) / 60;
      return {
        level: building.level, made: building.output, consumed: 900 - building.input, state: building.factoryState,
        rate: building.productionRate, efficiency: building.powerEfficiency, powered: building.powered,
        perMinute: building.output / minutes, credits: after.credits - before.credits,
      };
    };
    const purifier = [1, 2, 3].map((level) => measure("purifier", level, 45));
    const press = [1, 2, 3].map((level) => measure("press", level, 45));
    d.start(); d.setQuest(8); d.giveCredits(20000);
    const live = d.build("purifier", 2, 12);
    d.setInput(live, d.snapshot().buildings.find((b) => b.id === live).inputCapacity);
    d.setOutput(live, 0); d.step(5);
    const flowing = d.snapshot().buildings.find((b) => b.id === live);
    const cap = flowing.outputCapacity;
    d.setOutput(live, cap); d.setInput(live, 400);
    const blockedInput = d.snapshot().buildings.find((b) => b.id === live).input;
    d.step(8);
    const blocked = d.snapshot().buildings.find((b) => b.id === live);
    return { purifier, press, flowing: { output: flowing.output, state: flowing.factoryState }, blocked: { output: blocked.output, input: blocked.input, state: blocked.factoryState, inputBefore: blockedInput, cap } };
  });
  const purified = production.purifier.map((row) => row.perMinute);
  const ice = production.press.map((row) => row.perMinute);
  assert(purified[0] > 60 && purified[1] > purified[0] * 1.6 && purified[2] > purified[1] * 1.3, `purifier levels rise (${purified.map((n) => n.toFixed(1)).join(" / ")} per minute)`);
  assert(ice[0] > 20 && ice[1] > ice[0] * 1.6 && ice[2] > ice[1] * 1.3, `ice press levels rise (${ice.map((n) => n.toFixed(1)).join(" / ")} per minute)`);
  assert(production.purifier.every((row) => Math.abs(row.made - row.consumed * 0.85) < 0.05 && row.credits === 0), "purifier conversion stays 0.85 and creates no credits by itself");
  assert(production.press.every((row) => row.consumed >= row.made * 5 - 0.01 && row.consumed <= row.made * 5 + 5.01), "ice press still spends 5 purified per block");
  assert(production.flowing.output > 4 && production.flowing.state === "processing", "a full input with free output keeps the purifier processing");
  assert(production.blocked.state === "output" && production.blocked.output <= production.blocked.cap + 0.01 && Math.abs(production.blocked.input - production.blocked.inputBefore) < 0.05, "a full output tank is labeled blocked and does not consume more input");

  const delivery = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const run = (level) => {
      d.start(); d.setQuest(8); d.giveCredits(20000); d.teleport(0, 10);
      const id = d.build("purifier", 2, 12);
      let guard = 0;
      while (d.snapshot().buildings.find((b) => b.id === id).level < level && guard++ < 4) { d.teleport(2, 12); d.upgradeNearest(); }
      d.buyRail(id, 0); d.setInput(id, 900); d.setOutput(id, 0);
      const before = d.snapshot();
      d.step(40);
      const after = d.snapshot();
      const building = after.buildings.find((b) => b.id === id);
      const cargo = d.railState()[0].cargo;
      const minutes = (after.runTime - before.runTime) / 60;
      const credits = after.credits - before.credits;
      const sold = credits / 6;
      return {
        produced: after.produced - before.produced, sold, credits,
        leftover: building.output + cargo, perMinute: sold / minutes, creditsPerMinute: credits / minutes,
      };
    };
    const levels = [1, 2, 3].map(run);
    d.start(); d.setQuest(8); d.giveCredits(5000);
    const purifier = d.build("purifier", 2, 12);
    const press = d.build("press", 6, 12);
    d.buyRail(purifier, press);
    d.setInput(press, d.snapshot().buildings.find((b) => b.id === press).inputCapacity);
    d.setOutput(purifier, 80);
    d.step(6);
    const stalled = { delivered: d.snapshot().produced, cargo: d.railState()[0].cargo, input: d.snapshot().buildings.find((b) => b.id === press).input };
    d.setInput(press, 0); d.step(6);
    const released = d.snapshot().buildings.find((b) => b.id === press).input;
    return { levels, stalled, released };
  });
  assert(delivery.levels[2].sold > delivery.levels[1].sold && delivery.levels[1].sold > delivery.levels[0].sold, `depot deliveries rise with purifier level (${delivery.levels.map((row) => row.sold.toFixed(1)).join(" / ")})`);
  assert(delivery.levels.every((row) => Math.abs(row.produced - (row.sold + row.leftover)) < 1.5), "produced purified snow is either delivered, buffered, or still aboard a capsule");
  assert(delivery.levels.every((row) => row.credits > row.sold * 6 - 1 && row.credits < row.sold * 6 + 1), "rail sales pay the existing 6 credits per purified unit");
  assert(delivery.stalled.cargo > 0 && delivery.stalled.input >= delivery.released && delivery.released > 0, "a full press stops the delivery, and freeing its input lets the waiting cargo land");

  const modifiers = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const produce = (seconds) => {
      const id = d.snapshot().buildings.find((b) => b.type === "purifier").id;
      d.setInput(id, 400); d.setOutput(id, 0);
      const before = d.snapshot().produced;
      d.step(seconds);
      return { made: d.snapshot().produced - before, rate: d.snapshot().buildings.find((b) => b.id === id).productionRate, efficiency: d.snapshot().buildings.find((b) => b.id === id).powerEfficiency, state: d.snapshot().buildings.find((b) => b.id === id).factoryState };
    };
    d.start(); d.setQuest(8); d.giveCredits(30000); d.teleport(0, 10);
    d.build("purifier", 2, 12);
    const solo = produce(20);
    d.build("generator", -40, 10);
    const repaired = d.repairRelay("foundry");
    d.step(0.2);
    const foundry = produce(20);
    d.start(); d.setQuest(8); d.giveCredits(30000);
    const id = d.build("purifier", 2, 12);
    for (const [x, z] of [[8, 10], [-8, 10], [0, 16], [0, 4], [8, 16]]) d.build("heater", x, z);
    d.step(0.2);
    const loaded = d.snapshot().buildings.find((b) => b.id === id);
    d.setInput(id, 400); d.setOutput(id, 0); const before = d.snapshot().produced; d.step(20);
    const loadedMade = d.snapshot().produced - before;
    d.setOutput(id, 12); d.setInput(id, 40); d.pause();
    const mid = d.snapshot().buildings.find((b) => b.id === id);
    return { repaired, solo, foundry, loaded: { made: loadedMade, efficiency: loaded.powerEfficiency, powered: loaded.powered, state: d.snapshot().buildings.find((b) => b.id === id).factoryState }, mid: { output: mid.output, input: mid.input, progress: mid.progress } };
  });
  assert(modifiers.repaired && modifiers.foundry.made > modifiers.solo.made * 1.2, `a powered foundry raises real output (${modifiers.solo.made.toFixed(1)} -> ${modifiers.foundry.made.toFixed(1)})`);
  assert(modifiers.loaded.powered && modifiers.loaded.efficiency <= 0.65 && modifiers.loaded.made < modifiers.solo.made * 0.7, `shared power cuts throughput (${modifiers.loaded.efficiency.toFixed(2)}, ${modifiers.loaded.made.toFixed(1)})`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  await page.click("#continue-btn");
  const resumed = await page.evaluate(() => {
    const building = window.__whiteoutDebug.snapshot().buildings.find((b) => b.type === "purifier");
    return { output: building.output, input: building.input, level: building.level };
  });
  assert(resumed.level === 1 && Math.abs(resumed.output - modifiers.mid.output) < 1 && Math.abs(resumed.input - modifiers.mid.input) < 1, `production buffers and the purchased level survive reload ${JSON.stringify({ resumed, mid: modifiers.mid })}`);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.setDefaultTimeout(30000);
  mobile.on("pageerror", (error) => errors.push(String(error)));
  await mobile.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
    localStorage.removeItem("whiteout.career-v2");
  });
  await mobile.goto(origin, { waitUntil: "domcontentloaded" });
  await mobile.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  await mobile.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start(); d.setQuest(8); d.giveCredits(4000); d.teleport(0, 10); d.setAzimuth(Math.PI);
    d.build("sweeper", 4, 18); d.build("purifier", 12, 26); d.step(0.3);
  });
  await mobile.waitForTimeout(700);
  const touch = await mobile.evaluate(() => {
    const d = window.__whiteoutDebug;
    const buildings = d.snapshot().buildings;
    const sweeper = buildings.find((b) => b.type === "sweeper");
    const purifier = buildings.find((b) => b.type === "purifier");
    return { sweeper: d.worldToScreen(sweeper.x, sweeper.z), purifier: d.worldToScreen(purifier.x, purifier.z), corner: d.worldToScreen(sweeper.x, purifier.z), coarse: matchMedia("(pointer: coarse)").matches || innerWidth < 760 };
  });
  assert(touch.coarse && !touch.sweeper.behind && !touch.purifier.behind, "touch layout can see both rail endpoints");
  await mobile.evaluate(() => window.__whiteoutDebug.selectRail());
  const point = async (type, target) => mobile.evaluate(({ type, target }) => {
    const canvas = document.querySelector("canvas");
    canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: target.x, clientY: target.y, pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
  }, { type, target });
  await mobile.mouse.move(touch.sweeper.x, touch.sweeper.y);
  await mobile.mouse.down();
  await mobile.mouse.move(touch.purifier.x, touch.purifier.y, { steps: 10 });
  await mobile.mouse.up();
  await mobile.waitForFunction(() => window.__whiteoutDebug.snapshot().railEditor);
  const draft = await mobile.evaluate(() => window.__whiteoutDebug.snapshot().railEditor);
  assert(draft && draft.network === true && draft.kind === "raw" && draft.points === 0 && !!draft.sourceName && !!draft.destinationName && draft.valid && draft.cost > 0, `touch selection opens a network preview with source, destination and cargo (${JSON.stringify(draft)})`);
  const creditsBefore = await mobile.evaluate(() => window.__whiteoutDebug.snapshot().credits);
  await mobile.click("#rail-confirm");
  await mobile.waitForFunction(() => window.__whiteoutDebug.netState().edges.length === 1);
  const touchRail = await mobile.evaluate(() => {
    const snap = window.__whiteoutDebug.snapshot();
    const edge = window.__whiteoutDebug.netState().edges[0];
    return { credits: snap.credits, railCount: snap.railCount, edge };
  });
  assert(touchRail.credits < creditsBefore && touchRail.railCount === 0 && touchRail.edge.kind === "raw" && touchRail.edge.total > 2 && touchRail.edge.paid > 0, `confirming the touch preview charges one shared raw route (${JSON.stringify(touchRail)})`);

  console.log("BATCH3", JSON.stringify({ rails, parallel: { lanes: parallel.lanes, spread }, production, delivery, modifiers: { solo: modifiers.solo, foundry: modifiers.foundry, loaded: modifiers.loaded }, resumed }, null, 2));
  if (errors.length) throw new Error(errors.join(" | "));
} finally {
  await browser.close();
  server.close();
}
