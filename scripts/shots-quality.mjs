import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

const phase = process.argv[2] === "after" ? "after" : "before";
const out = `D:/Game/app/quality-shots/${phase}`;
await mkdir(out, { recursive: true });
const executablePath = [process.env.CHROMIUM_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((path) => path && existsSync(path));
if (!executablePath) throw new Error("No Chrome executable found");
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.addInitScript(() => {
  localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
  localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
  localStorage.removeItem("whiteout.career-v2");
});
await page.goto("http://127.0.0.1:3010/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);

const scene = await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.start(); d.setQuest(8); d.giveCredits(40000); d.teleport(2, 8); d.setAzimuth(0.4);
  const sweeper = d.build("sweeper", -14, 22);
  const purifier = d.build("purifier", 16, 20);
  const press = d.build("press", -12, 4);
  const purifierB = d.build("purifier", 14, 2);
  d.editRail(sweeper, purifier, [{ x: 2, z: 28 }]);
  d.editRail(purifierB, press, [{ x: 0, z: 12 }]);
  d.editRail(press, 0, [{ x: -4, z: 8 }]);
  d.editRail(purifier, 0, [{ x: 18, z: 10 }]);
  for (let i = 0; i < 4; i++) d.teleport(-12, 4);
  while ((d.snapshot().buildings.find((b) => b.id === press)?.level ?? 1) < 3) d.upgradeNearest();
  const heaters = [[6, 10], [-6, 10], [0, 16], [4, 4], [10, 8]];
  for (const [x, z] of heaters) d.build("heater", x, z);
  d.setInput(press, 900); d.setOutput(press, 0); d.buyRail(press, 0);
  d.step(3);
  d.teleport(1, 10); d.setAzimuth(0.55); d.step(0.4);
  const card = d.snapshot().buildings.find((b) => b.id === press);
  return { sweeper, purifier, press, purifierB, card: { input: card.input, output: card.output, capacity: card.inputCapacity, outCap: card.outputCapacity, efficiency: card.powerEfficiency, state: card.factoryState, rate: card.productionRate, level: card.level, progress: card.progress } };
});
await page.screenshot({ path: `${out}/rails.png` });

await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  const press = d.snapshot().buildings.find((b) => b.type === "press");
  d.teleport(press.x, press.z); d.step(0.2);
});
await page.screenshot({ path: `${out}/press-card.png` });

await page.evaluate(() => {
  const d = window.__whiteoutDebug;
  d.selectRail();
  d.editRail(d.snapshot().buildings.find((b) => b.type === "sweeper").id, d.snapshot().buildings.find((b) => b.type === "purifier" && b.x > 0).id, [{ x: 0, z: 4 }]);
});
await page.screenshot({ path: `${out}/rail-invalid.png` });
const layout = await page.evaluate(() => {
  const rect = (id) => {
    const node = document.querySelector(id);
    if (!node || node.classList.contains("hidden")) return null;
    const box = node.getBoundingClientRect();
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), text: node.textContent.replace(/\s+/g, " ").trim().slice(0, 160) };
  };
  const editor = rect("#rail-editor");
  const help = rect("#desktop-help");
  const dock = rect("#build-dock");
  const hint = rect("#build-hint");
  const overlap = (a, b) => !!a && !!b && a.top < b.bottom && a.bottom > b.top;
  const card = document.querySelector("#building-card")?.innerText?.replace(/\s+/g, " ").trim().slice(0, 420) ?? "";
  return { editor, help, dock, hint, editorHitsHelp: overlap(editor, help), editorHitsDock: overlap(editor, dock), hintHitsHelp: overlap(hint, help), card };
});

for (const tool of ["brush", "blower", "vacuum"]) {
  await page.evaluate((id) => {
    const d = window.__whiteoutDebug;
    d.start(); d.setQuest(8); d.giveCredits(5000); d.teleport(0, -18); d.setAzimuth(0.15);
    d.buyTool(id); d.selectTool(id); d.holdClear(true); d.step(0.45);
  }, tool);
  await page.screenshot({ path: `${out}/tool-${tool}.png` });
}

const boxes = await page.evaluate(() => {
  const hint = document.querySelector("#build-hint");
  const help = document.querySelector("#desktop-help");
  const editor = document.querySelector("#rail-editor");
  const dock = document.querySelector("#build-dock");
  const rect = (node) => {
    if (!node || node.classList.contains("hidden")) return null;
    const box = node.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, text: node.textContent.slice(0, 180) };
  };
  return { hint: rect(hint), help: rect(help), editor: rect(editor), dock: rect(dock) };
});
console.log(JSON.stringify({ phase, scene, layout, boxes, errors }, null, 2));
await browser.close();
