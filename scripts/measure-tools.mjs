import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const phase = process.argv[2] === "after" ? "after" : "before";
const check = phase === "after";
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

const report = await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  const ids = ["hands", "shovel", "brush", "blower", "vacuum"];
  const round = (value) => Math.round(value * 1000) / 1000;

  const face = () => {
    d.walk(0, 1);
    d.step(0.08);
    d.walk(0, 0);
  };
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
    d.start(); d.setQuest(8); d.giveCredits(40000);
    while ((d.snapshot().tools[id] ?? 0) < level) d.buyTool(id);
    d.selectTool(id);
    d.setToolHealth(id, 100);
    d.setRaw(0);
    d.holdClear(false);
    d.walk(0, 0);
  };
  const recharge = () => { d.holdClear(false); d.walk(0, 0); d.teleport(0, 10); d.step(1.2); };
  const burst = (density, seconds) => {
    recharge();
    const aim = standOver(32, 28);
    d.paintSnow(aim.x, aim.z, Math.max(6, aim.radius + 3), density);
    const watch = aim.radius + 1.2;
    const beforeMass = d.snowDisk(aim.x, aim.z, watch);
    const circle = d.snowDisk(aim.x, aim.z, aim.radius);
    const before = d.snapshot();
    d.setRaw(0);
    d.holdClear(true);
    d.step(seconds);
    d.holdClear(false);
    const after = d.snapshot();
    const removed = beforeMass - d.snowDisk(aim.x, aim.z, watch);
    const gained = after.raw;
    return {
      removed: round(removed), perSecond: round(removed / seconds), cargo: round(gained), cargoPerSecond: round(gained / seconds),
      heat: round((before.heat - after.heat) / seconds), wear: round((before.toolHealth[after.selectedTool] - after.toolHealth[after.selectedTool]) / seconds),
      yieldRatio: removed > 0.05 ? round(gained / removed) : 0,
      capped: after.load > after.capacity - 0.05, saturated: removed > circle * 0.82,
      radius: round(aim.radius), reach: round(Math.hypot(aim.x - aim.px, aim.z - aim.pz)),
    };
  };
  const clearPatch = (density) => {
    recharge();
    const cx = 32, cz = 28, patch = 3.1;
    d.paintSnow(cx, cz, patch + 2, 0);
    d.paintSnow(cx, cz, patch, density);
    const initial = d.snowDisk(cx, cz, patch);
    d.setRaw(0); d.setToolHealth(d.snapshot().selectedTool, 100);
    face();
    const aimed = standOver(cx, cz + patch);
    const ox = aimed.x - aimed.px, oz = aimed.z - aimed.pz;
    const startHeat = d.snapshot().heat;
    let t = 0; let unloads = 0;
    d.holdClear(true);
    for (const offset of [-2.4, -1.2, 0, 1.2, 2.4]) {
      d.walk(0, 0);
      d.teleport(cx + offset - ox, cz + patch + 0.45 - oz);
      d.walk(0, 1);
      for (let i = 0; i < 45 && t < 20; i++) {
        d.step(0.1); t += 0.1;
        const snap = d.snapshot();
        if (snap.load > snap.capacity - 0.4) { d.setRaw(0); unloads++; }
        const aim = d.aimPoint();
        if (aim.z < cz - patch - 0.35) break;
        if (d.snowDisk(cx, cz, patch) < initial * 0.08) break;
      }
      if (d.snowDisk(cx, cz, patch) < initial * 0.08) break;
    }
    d.holdClear(false); d.walk(0, 0);
    const left = d.snowDisk(cx, cz, patch);
    return { seconds: round(t), left: round(left), cleared: round(1 - left / Math.max(0.001, initial)), unloads, heat: round(startHeat - d.snapshot().heat) };
  };
  const fillTime = () => {
    recharge();
    d.paintSnow(32, 24, 14, 1);
    face();
    const aimed = standOver(32, 36);
    const ox = aimed.x - aimed.px, oz = aimed.z - aimed.pz;
    d.setRaw(0);
    d.holdClear(true);
    d.walk(0, 1);
    let t = 0;
    for (; t < 22; t += 0.1) {
      d.step(0.1);
      const after = d.snapshot();
      if (after.load >= after.capacity - 0.25) { d.holdClear(false); d.walk(0, 0); return { seconds: round(t + 0.1), cargo: round(after.raw), capacity: after.capacity }; }
      if (window.__gameProbe().z < 14) d.teleport(32 - ox, 36 - oz);
    }
    d.holdClear(false); d.walk(0, 0);
    return { seconds: round(t), cargo: round(d.snapshot().raw), capacity: d.snapshot().capacity };
  };
  const travel = (density) => {
    recharge();
    d.paintSnow(32, 28, 10, density);
    face();
    d.teleport(32, 36);
    d.setRaw(0);
    d.holdClear(true);
    d.walk(0, 1);
    const start = window.__gameProbe();
    d.step(1.2);
    const endState = d.snapshot().state;
    d.holdClear(false); d.walk(0, 0);
    const end = window.__gameProbe();
    return { speed: round(Math.hypot(end.x - start.x, end.z - start.z) / 1.2), state: endState };
  };
  const rangeProbe = () => {
    face();
    d.teleport(32, 36);
    d.step(1 / 60);
    const aim = d.aimPoint();
    d.paintSnow(aim.px, aim.pz - 6, 8, 1);
    const samples = [];
    for (let dist = 0; dist <= 10.5; dist += 0.3) samples.push({ dist, before: d.snowAt(aim.px, aim.pz - dist) });
    d.holdClear(true); d.step(0.45); d.holdClear(false);
    let far = 0;
    for (const sample of samples) {
      const after = d.snowAt(aim.px, aim.pz - sample.dist);
      if (sample.before - after > 0.04) far = sample.dist;
    }
    const markers = d.aimMarkers();
    return { far: round(far), center: round(Math.hypot(aim.x - aim.px, aim.z - aim.pz)), radius: round(aim.radius), markers };
  };

  const rows = [];
  for (const id of ids) for (const level of [1, 4]) {
    equip(id, level);
    const stats = d.toolStats(id, level);
    const thin = burst(0.3, 0.16);
    const deep = burst(1, 0.22);
    const mixed = burst(0.55, 0.18);
    const thinArea = clearPatch(0.22);
    const deepArea = clearPatch(1);
    const tank = fillTime();
    const speedDeep = travel(1);
    const speedThin = travel(0.22);
    const range = rangeProbe();
    rows.push({
      id, level, capacity: stats.capacity,
      radius: thin.radius, reach: thin.reach, far: range.far,
      thin: thin.perSecond, deep: deep.perSecond, mixed: mixed.perSecond,
      cargoThin: thin.cargoPerSecond, cargoDeep: deep.cargoPerSecond,
      yieldThin: thin.yieldRatio, yieldDeep: deep.yieldRatio,
      heat: deep.heat, wear: deep.wear,
      thinSeconds: thinArea.seconds, deepSeconds: deepArea.seconds,
      thinCleared: thinArea.cleared, deepCleared: deepArea.cleared,
      unloadsDeep: deepArea.unloads, fillSeconds: tank.seconds, fillCargo: tank.cargo,
      speedDeep: speedDeep.speed, speedThin: speedThin.speed, speedState: speedDeep.state,
      saturatedThin: thin.saturated, saturatedDeep: deep.saturated,
      cappedThin: thin.capped, cappedDeep: deep.capped,
      markers: range.markers,
      conserved: thin.cargo <= thin.removed + 0.05 && deep.cargo <= deep.removed + 0.05,
    });
  }
  return { rows, errors: [] };
});

await mkdir(join(ROOT, "tool-balance"), { recursive: true });
await writeFile(join(ROOT, "tool-balance", `${phase}.json`), JSON.stringify(report, null, 2));

const fails = [];
const row = (id, level) => report.rows.find((item) => item.id === id && item.level === level);
if (check) {
  const brush = row("brush", 1), shovel = row("shovel", 1), blower = row("blower", 1), vacuum = row("vacuum", 1), hands = row("hands", 1);
  const brush4 = row("brush", 4), shovel4 = row("shovel", 4), blower4 = row("blower", 4), vacuum4 = row("vacuum", 4), hands4 = row("hands", 4);
  const expect = (ok, message) => { if (!ok) fails.push(message); };
  expect(brush.thin > shovel.thin * 1.35 && brush.thin > blower.thin && brush.thin > hands.thin, `brush should win thin clearing ${brush.thin} vs shovel ${shovel.thin}`);
  expect(shovel.deep > brush.deep * 1.35 && shovel.deep > blower.deep, `shovel should win deep clearing ${shovel.deep} vs brush ${brush.deep}`);
  expect(brush.deep < shovel.deep, `brush must not dominate deep snow ${brush.deep} vs ${shovel.deep}`);
  expect(blower.far > brush.far * 1.45 && blower.far > vacuum.far * 1.35, `blower reach should be obviously longer ${blower.far} brush ${brush.far} vacuum ${vacuum.far}`);
  expect(vacuum.cargoThin > brush.cargoThin * 1.15 && vacuum.cargoDeep >= shovel.cargoDeep * 0.9, `vacuum should collect more cargo ${vacuum.cargoThin} vs brush ${brush.cargoThin}`);
  expect(hands.yieldThin >= vacuum.yieldThin - 0.02 && hands.wear < vacuum.wear && hands.wear <= shovel.wear, `hands should stay the efficient starter ${JSON.stringify({ hands, vacuum })}`);
  expect(brush4.thin > brush.thin * 1.35, `brush upgrade should speed thin clearing ${brush.thin} -> ${brush4.thin}`);
  expect(shovel4.deep > shovel.deep * 1.45, `shovel upgrade should speed deep clearing ${shovel.deep} -> ${shovel4.deep}`);
  expect(blower4.far > blower.far + 1.2, `blower upgrade should extend reach ${blower.far} -> ${blower4.far}`);
  expect(vacuum4.cargoThin > vacuum.cargoThin * 1.4, `vacuum upgrade should collect faster ${vacuum.cargoThin} -> ${vacuum4.cargoThin}`);
  expect(hands4.wear < hands.wear * 0.7 && hands4.thin > hands.thin * 1.3, `hands upgrade should clear faster and wear less`);
  expect(report.rows.every((item) => item.conserved), "cargo exceeded snow removed");
  expect(report.rows.every((item) => item.markers.ring && !item.markers.lane && !item.markers.chevron && !item.markers.sweep && !item.markers.suction), "indicator is not a single circle");
  expect(report.rows.every((item) => Math.abs(item.markers.ringScale - item.radius) < 0.05), "indicator radius does not match the clear radius");
}
if (errors.length) fails.push(errors.join("\n"));
const lines = report.rows.map((item) => [item.id, item.level, item.far, item.radius, item.thin, item.deep, item.cargoThin, item.cargoDeep, item.heat, item.wear, item.thinSeconds, item.deepSeconds, item.speedDeep, item.fillSeconds].join("\t"));
console.log(["tool", "lv", "far", "radius", "thin/s", "deep/s", "cargoThin", "cargoDeep", "heat/s", "wear/s", "thinTime", "deepTime", "move", "fill"].join("\t"));
console.log(lines.join("\n"));
if (fails.length) { console.error(fails.join("\n")); await browser.close(); server.close(); process.exit(1); }
await browser.close();
server.close();
