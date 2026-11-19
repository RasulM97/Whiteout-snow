import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const phase = process.argv[2] === "after" ? "after" : "before";
const port = Number(process.argv[3] || 3000);
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const executablePath = [process.env.CHROMIUM_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((item) => item && existsSync(item));
if (!executablePath) throw new Error("No Chrome");
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.addInitScript(() => {
  localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
  localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
  localStorage.removeItem("whiteout.career-v2");
});
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);

const report = await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  const marks = [];
  const mark = (name) => {
    const s = d.snapshot();
    marks.push({
      name, minute: Math.round(s.runTime / 6) / 10, runTime: Math.round(s.runTime * 10) / 10,
      credits: s.credits, quest: s.quest.index, sold: Math.round(s.sold),
      rawSold: Math.round(s.rawSold * 10) / 10, purifiedSold: Math.round((s.purifiedSold ?? 0) * 10) / 10,
      iceSold: Math.round((s.iceSold ?? 0) * 10) / 10, produced: Math.round((s.produced ?? 0) * 10) / 10, cleanup: Math.round(s.cleanupPercent * 10) / 10,
      power: s.power, cores: s.cores, state: s.state, heat: Math.round(s.heat),
    });
  };
  const dead = () => d.snapshot().state !== "playing";
  const go = (x, z) => {
    for (let guard = 0; guard < 50; guard++) {
      if (dead()) return false;
      const p = window.__gameProbe();
      const dx = x - p.x, dz = z - p.z, dist = Math.hypot(dx, dz);
      if (dist < 1.5) break;
      d.walk(dx / dist, -(dz / dist));
      d.holdClear(false);
      d.step(Math.min(1.1, Math.max(0.25, dist / 4)));
      if (d.snapshot().heat < 24) { d.walk(0, 0); d.teleport(0, 10); d.step(1.5); }
    }
    d.walk(0, 0);
    return !dead();
  };
  const sell = () => { if (!go(7, 8)) return; d.interact(); };
  let patch = 0;
  const gather = (seconds) => {
    const x = 18 + (patch % 6) * 7;
    const z = -22 + Math.floor(patch / 6) * 7;
    patch += 1;
    if (!go(x, z)) return;
    d.holdClear(true);
    d.walk(1, 0);
    let t = 0;
    while (t < seconds) {
      if (dead()) break;
      d.step(0.35); t += 0.35;
      const s = d.snapshot();
      if (s.heat < 30 || s.load > s.capacity - 0.3) break;
    }
    d.holdClear(false); d.walk(0, 0);
  };
  const harvest = (seconds) => { gather(seconds); sell(); };
  d.start();
  mark("start");
  let loops = 0;
  while (loops++ < 70 && !dead() && !d.snapshot().buildings.some((b) => b.type === "purifier")) {
    harvest(5);
    const s = d.snapshot();
    if (s.quest.index >= 1 && s.credits >= 120) {
      const id = d.buyBuilding("purifier", 4, 12);
      mark(id ? "purifier" : "purifier-refused");
      if (id) break;
    }
  }
  const feed = (seconds) => {
    const purifier = d.snapshot().buildings.find((b) => b.type === "purifier");
    if (!purifier || dead()) return;
    gather(seconds);
    if (!go(purifier.x, purifier.z)) return;
    d.interact();
    d.step(Math.min(8, seconds));
    if (!go(purifier.x, purifier.z)) return;
    d.interact();
    sell();
  };
  loops = 0;
  while (loops++ < 40 && !dead() && !d.snapshot().buildings.some((b) => b.type === "press")) {
    feed(6);
    const s = d.snapshot();
    if (s.quest.index >= 4 && s.credits >= 480) {
      const id = d.buyBuilding("press", 10, 14);
      mark(id ? "press" : "press-refused");
      if (id) break;
    }
    if (d.snapshot().runTime > 900) break;
  }
  const pressWork = (seconds) => {
    const press = d.snapshot().buildings.find((b) => b.type === "press");
    const purifier = d.snapshot().buildings.find((b) => b.type === "purifier");
    if (!press || !purifier || dead()) return;
    gather(4);
    if (!go(purifier.x, purifier.z)) return;
    d.interact();
    d.step(6);
    if (!go(purifier.x, purifier.z)) return;
    d.interact();
    if (!go(press.x, press.z)) return;
    d.interact();
    d.step(seconds);
    if (!go(press.x, press.z)) return;
    d.interact();
    sell();
  };
  loops = 0;
  while (loops++ < 24 && !dead() && (d.snapshot().iceSold ?? 0) < 12) {
    pressWork(8);
    if (d.snapshot().runTime > 1200) break;
  }
  mark("ice-12-or-stop");
  const beforeIdle = d.snapshot();
  d.teleport(0, 10); d.holdClear(false); d.walk(0, 0); d.step(60);
  const afterIdle = d.snapshot();
  const passive = { credits: afterIdle.credits - beforeIdle.credits, state: afterIdle.state, minute: Math.round(afterIdle.runTime / 6) / 10 };
  let sweeper = null;
  if (!dead() && d.snapshot().quest.index >= 7 && d.snapshot().credits >= 780) {
    sweeper = d.buyBuilding("sweeper", 14, 10);
    mark(sweeper ? "sweeper" : "sweeper-refused");
  }
  if (sweeper) {
    const purifier = d.snapshot().buildings.find((b) => b.type === "purifier");
    if (purifier) d.commitStroke([{ x: 14, z: 10 }, { x: purifier.x, z: purifier.z }]);
    d.step(45);
  }
  mark("late-sample");
  const affordHauler = marks.find((item) => item.credits >= 2200) ?? (d.snapshot().credits >= 2200 ? { name: "hauler-affordable", minute: Math.round(d.snapshot().runTime / 6) / 10, credits: d.snapshot().credits } : null);
  return {
    marks, passive, affordHauler, final: marks[marks.length - 1],
    buildings: d.snapshot().buildings.map((b) => ({ type: b.type, level: b.level, powered: b.powered })),
    errors: [],
  };
});
await mkdir(join(ROOT, "railv3-shots"), { recursive: true });
await writeFile(join(ROOT, "railv3-shots", `career-${phase}.json`), JSON.stringify({ phase, port, report, errors }, null, 2));
console.log(JSON.stringify({ phase, marks: report.marks, passive: report.passive, affordHauler: report.affordHauler, buildings: report.buildings, errors }, null, 2));
await browser.close();
if (errors.length) process.exit(1);
