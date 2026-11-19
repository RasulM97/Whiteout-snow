import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

const phase = process.argv[2] === "after" ? "after" : "before";
const out = `D:/Game/app/railv2-shots/${phase}`;
await mkdir(out, { recursive: true });
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
await page.goto("http://127.0.0.1:3020/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);

const cameras = [
  ["01-crowded.png", 0, 12, 0.7],
  ["02-shared-trunk.png", -1, 14, 0.9],
  ["03-merge.png", -6, 14, 0.55],
  ["04-split.png", 14, 14, 1.15],
  ["05-purifier.png", 4, 14, 0.8],
  ["06-full-base.png", 2, 8, 0.35],
];

const report = await page.evaluate(async (mode) => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(80000); d.teleport(0, 0); d.setAzimuth(0.4);
  const a = d.build("sweeper", -16, 20);
  const b = d.build("sweeper", -16, 8);
  const purifier = d.build("purifier", 4, 14);
  const press = d.build("press", 22, 8);
  d.build("heater", 0, 18); d.build("heater", 8, 10); d.build("heater", -8, 14);
  d.build("generator", 16, 8);
  let network = null;
  if (mode === "before" || typeof d.netPlace !== "function") {
    d.buyRail(a, purifier); d.buyRail(b, purifier);
    d.buyRail(purifier, press); d.buyRail(purifier, 0); d.buyRail(press, 0);
  } else {
    const merge = d.netPlace("merge", -6, 14);
    const split = d.netPlace("split", 14, 14);
    const links = [
      d.netLink({ buildingId: a, port: "out" }, { nodeId: merge }),
      d.netLink({ buildingId: b, port: "out" }, { nodeId: merge }),
      d.netLink({ nodeId: merge }, { buildingId: purifier, port: "in" }),
      d.netLink({ buildingId: purifier, port: "out" }, { nodeId: split }),
      d.netLink({ nodeId: split }, { buildingId: press, port: "in" }),
      d.netLink({ nodeId: split }, { buildingId: 0, port: "in" }),
      d.netLink({ buildingId: press, port: "out" }, { buildingId: 0, port: "in" }),
    ];
    d.netPolicy(split, "ratio", 70);
    network = { merge, split, links: links.map((link) => link.reason), visual: d.netVisual() };
  }
  window.__shotIds = { a, b, purifier, press };
  d.setOutput(a, 90); d.setOutput(b, 90); d.setInput(purifier, 80);
  d.step(8);
  d.setOutput(purifier, 70); d.setOutput(press, 24);
  d.step(6);
  return { mode, rails: d.railState().length, network };
}, phase);

const perf = await page.evaluate(() => new Promise((resolve) => {
  const stamps = [];
  const tick = (now) => {
    stamps.push(now);
    if (stamps.length < 90) requestAnimationFrame(tick);
    else {
      const dts = stamps.slice(1).map((value, index) => value - stamps[index]);
      dts.sort((a, b) => a - b);
      const stats = window.__whiteoutDebug.stats();
      resolve({ avg: dts.reduce((sum, value) => sum + value, 0) / dts.length, p95: dts[Math.floor(0.95 * (dts.length - 1))], frames: dts.length, calls: stats.calls, triangles: stats.triangles, fps: stats.fps });
    }
  };
  requestAnimationFrame(tick);
}));

for (const [name, x, z, azimuth] of cameras) {
  await page.evaluate(({ x, z, azimuth }) => {
    const d = window.__whiteoutDebug;
    const ids = window.__shotIds;
    d.setOutput(ids.a, 90); d.setOutput(ids.b, 90); d.setOutput(ids.purifier, 70); d.setOutput(ids.press, 24);
    d.teleport(x, z); d.setAzimuth(azimuth); d.step(0.35);
  }, { x, z, azimuth });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}` });
}

let resumed = null;
if (phase === "after") {
  const saved = await page.evaluate(() => { window.__whiteoutDebug.save(); return localStorage.getItem("whiteout.career-v2"); });
  await page.addInitScript((stored) => { localStorage.setItem("whiteout.career-v2", stored); }, saved);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  resumed = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.continue();
    d.step(5);
    return { edges: d.netState().edges.length, capsules: d.netState().capsules.length, cargo: d.netState().cargo, visual: d.netVisual(), rails: d.railState().length };
  });
  await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const ids = window.__shotIds;
    if (ids) { d.setOutput(ids.a, 90); d.setOutput(ids.b, 90); d.setOutput(ids.purifier, 70); d.setOutput(ids.press, 24); }
    d.teleport(2, 10); d.setAzimuth(0.7); d.step(1.2);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/07-reloaded.png` });
}
console.log(JSON.stringify({ phase, report, perf, resumed, errors }, null, 2));
await browser.close();
if (errors.length) process.exit(1);
