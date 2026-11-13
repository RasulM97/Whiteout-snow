import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const SHOTS = join(tmpdir(), "whiteout-guidance");
mkdirSync(SHOTS, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".mp3": "audio/mpeg" };
const server = createServer(async (req, res) => {
  try {
    const raw = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const file = resolve(DIST, "." + decodeURIComponent(raw));
    if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const origin = `http://127.0.0.1:${server.address().port}/`;
const executablePath = [process.env.CHROMIUM_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find((path) => path && existsSync(path));
if (!executablePath) throw new Error("No Chrome or Edge executable found");
const browser = await chromium.launch({ headless: true, executablePath });
const errors = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log("PASS:", message); };

async function openGame(language = "en") {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript((lang) => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: lang, quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
    if (!sessionStorage.getItem("guidance-ready")) { localStorage.removeItem("whiteout.career-v2"); sessionStorage.setItem("guidance-ready", "1"); }
  }, language);
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug, null, { timeout: 30000 });
  await page.click("#start-btn");
  await page.click("#skip-cinematic");
  await page.waitForFunction(() => window.__whiteoutDebug.snapshot().state === "playing", null, { timeout: 10000 });
  return page;
}

try {
  const page = await openGame("en");
  const heat = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const toast = () => document.querySelector("#toast").textContent;
    const mark = () => { document.querySelector("#toast").textContent = "CLEARED"; };
    d.teleport(40, 40); d.step(10);
    const early = { heat: d.snapshot().heat, toast: toast() };
    d.step(70);
    const warned = { heat: d.snapshot().heat, toast: toast() };
    mark(); d.step(8);
    const held = { heat: d.snapshot().heat, toast: toast() };
    d.teleport(0, 10); d.step(2); mark(); d.teleport(40, 40); d.step(40);
    return { early, warned, held, rearmed: { heat: d.snapshot().heat, toast: toast() }, charges: d.snapshot().radarCharges, cores: d.snapshot().cores, power: d.snapshot().power };
  });
  assert(Math.abs(heat.early.heat - 90.5) < 0.05 && !heat.early.toast.includes("28%"), `calm heat drain is unchanged and stays quiet above 28% (${JSON.stringify(heat.early)})`);
  assert(heat.warned.heat < 28 && heat.warned.heat > 0 && heat.warned.toast.includes("Body heat is below 28%"), `one warning appears below 28% (${JSON.stringify(heat.warned)})`);
  assert(heat.held.toast === "CLEARED" && heat.held.heat < 28, `the warning does not repeat while heat stays low (${JSON.stringify(heat.held)})`);
  assert(heat.rearmed.heat < 28 && heat.rearmed.toast.includes("Body heat is below 28%"), `the warning arms again only after heat recovers (${JSON.stringify(heat.rearmed)})`);
  await page.screenshot({ path: join(SHOTS, "heat-en.png") });
  await page.evaluate(() => { window.__whiteoutDebug.teleport(0, 10); window.__whiteoutDebug.step(4); });

  const scan = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const before = d.snapshot();
    d.setQuest(1);
    const id = d.build("purifier", 3, -2);
    const after = d.snapshot();
    return {
      id, beforeCharges: before.radarCharges, beforeCores: before.cores, beforeRecovered: before.coreViews.map((c) => c.recovered),
      quest: after.quest.index, power: after.power, charges: after.radarCharges, recovered: after.cores,
      cores: after.coreViews, radarActive: after.radarActive, toast: document.querySelector("#toast").textContent,
    };
  });
  assert(scan.quest === 2 && scan.toast.includes("south-west district") && !/orbital|previous crew|habitat/i.test(scan.toast), `purifier completion shows the existing radar hint without evidence spoilers (${scan.toast})`);
  assert(scan.charges === scan.beforeCharges && scan.recovered === scan.beforeCores && scan.cores.every((c) => !c.scanned && !c.recovered) && !scan.radarActive, `the hint does not spend charges, reveal caches, or activate the radar (${JSON.stringify(scan)})`);
  await page.evaluate(() => window.__whiteoutDebug.save());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug, null, { timeout: 30000 });
  await page.click("#continue-btn");
  await page.waitForFunction(() => window.__whiteoutDebug.snapshot().state === "playing", null, { timeout: 10000 });
  const resumed = await page.evaluate(() => {
    const d = window.__whiteoutDebug; const toast = document.querySelector("#toast").textContent;
    d.step(1);
    return { quest: d.snapshot().quest.index, toast, later: document.querySelector("#toast").textContent, heat: d.snapshot().heat, power: d.snapshot().power, charges: d.snapshot().radarCharges };
  });
  assert(resumed.quest === 2 && !resumed.toast.includes("south-west") && !resumed.later.includes("south-west"), `reloading does not repeat the scanner hint (${JSON.stringify(resumed)})`);

  const languages = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.setQuest(9);
    const read = (language) => {
      const select = document.querySelector("#set-language");
      select.value = language; select.dispatchEvent(new Event("change", { bubbles: true }));
      d.setQuest(6);
      const objective = document.querySelector("#objective-text").textContent;
      d.setQuest(9);
      return {
        quest: document.querySelector("#quest-desc").textContent,
        relay: [...document.querySelectorAll("#relay-guide p")].map((node) => node.textContent).join("\n"),
        objective,
      };
    };
    return { en: read("en"), fa: read("fa"), zh: read("zh") };
  });
  assert(languages.en.quest.includes("92%") && languages.en.quest.includes("at least two") && languages.en.relay.includes("92%") && languages.en.relay.includes("at least two"), "English mission and relay guidance require two installations");
  assert(languages.fa.quest.includes("۹۲٪") && languages.fa.quest.includes("دو") && languages.fa.relay.includes("۹۲٪") && languages.fa.relay.includes("دو"), "Persian mission and relay guidance require two installations");
  assert(languages.zh.quest.includes("92%") && languages.zh.quest.includes("两座") && languages.zh.relay.includes("92%") && languages.zh.relay.includes("两座"), "Chinese mission and relay guidance require two installations");
  assert(languages.en.objective.includes("marked building") && languages.fa.objective.includes("علامت") && languages.zh.objective.includes("标记"), `rail objective copy is localized (${JSON.stringify({ en: languages.en.objective, fa: languages.fa.objective, zh: languages.zh.objective })})`);
  await page.screenshot({ path: join(SHOTS, "mission-zh.png") });
  await page.evaluate(() => { const select = document.querySelector("#set-language"); select.value = "en"; select.dispatchEvent(new Event("change", { bubbles: true })); });

  const rail = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.setQuest(6);
    const purifier = d.snapshot().buildings.find((b) => b.type === "purifier");
    const press = d.build("press", -3, -3);
    const atPurifier = d.snapshot().objective;
    const linked = d.rail(purifier.id, 0);
    const atPress = d.snapshot().objective;
    d.setOutput(purifier.id, 20);
    d.step(2);
    const state = d.railState();
    const output = d.logistics().buildings.find((b) => b.id === purifier.id).output;
    const cargo = state.reduce((sum, route) => sum + route.cargo, 0);
    d.rail(press, 0);
    const afterBoth = d.snapshot().objective;
    return { linked, atPurifier, atPress, afterBoth, output, cargo, press, purifier, depot: { x: 7, z: 8 } };
  });
  const away = (point) => Math.hypot(point.x - rail.depot.x, point.z - rail.depot.z) > 3;
  assert(rail.linked && Math.hypot(rail.atPurifier.x - rail.purifier.x, rail.atPurifier.z - rail.purifier.z) < 0.1 && away(rail.atPurifier) && rail.atPurifier.key === "objective.rail", `the rail arrow starts at the purifier (${JSON.stringify(rail.atPurifier)})`);
  assert(Math.hypot(rail.atPress.x - (-3), rail.atPress.z - (-3)) < 0.1 && away(rail.atPress), `after the purifier is linked the arrow moves to the press (${JSON.stringify(rail.atPress)})`);
  assert(away(rail.afterBoth) && rail.output + rail.cargo <= 20.05, `a linked chain still does not create cargo (${JSON.stringify({ output: rail.output, cargo: rail.cargo, objective: rail.afterBoth })})`);
  await page.screenshot({ path: join(SHOTS, "rail-objective.png") });

  await page.evaluate(() => {
    const d = window.__whiteoutDebug; d.pause();
    const save = JSON.parse(localStorage.getItem("whiteout.career-v2"));
    save.questIndex = 9; save.power = 92; save.recovered = 3; save.cleanupCertified = true;
    save.cores = save.cores.map((core) => ({ ...core, scanned: true, revealed: true, recovered: true }));
    localStorage.setItem("whiteout.career-v2", JSON.stringify(save));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug, null, { timeout: 30000 });
  await page.click("#continue-btn");
  await page.waitForFunction(() => window.__whiteoutDebug.snapshot().state === "playing", null, { timeout: 10000 });
  const uplink = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const low = d.snapshot();
    d.setPower(96); const oneShort = d.snapshot().state;
    d.setPower(92); const back = d.snapshot().state;
    d.setPower(100); const full = d.snapshot().state;
    const saved = JSON.parse(localStorage.getItem("whiteout.career-v2"));
    return { power: low.power, state: low.state, recovered: low.cores, certified: low.cleanupCertified, oneShort, back, full, version: saved.version };
  });
  assert(uplink.state === "playing" && uplink.power === 92 && uplink.recovered === 3 && uplink.certified && uplink.oneShort === "playing" && uplink.back === "playing" && uplink.full === "victory" && uplink.version === 11, `92% and 96% cannot win, and 100% still can (${JSON.stringify(uplink)})`);

  const fa = await openGame("fa");
  const faHeat = await fa.evaluate(() => { const d = window.__whiteoutDebug; d.teleport(40, 40); d.step(80); return { heat: d.snapshot().heat, toast: document.querySelector("#toast").textContent }; });
  assert(faHeat.heat < 28 && faHeat.toast.includes("۲۸٪"), `Persian heat warning (${faHeat.toast})`);
  await fa.screenshot({ path: join(SHOTS, "heat-fa.png") });
  const zh = await openGame("zh");
  const zhHeat = await zh.evaluate(() => { const d = window.__whiteoutDebug; d.teleport(40, 40); d.step(80); return { heat: d.snapshot().heat, toast: document.querySelector("#toast").textContent }; });
  assert(zhHeat.heat < 28 && zhHeat.toast.includes("28%") && zhHeat.toast.includes("加热器"), `Chinese heat warning (${zhHeat.toast})`);
  await zh.screenshot({ path: join(SHOTS, "heat-zh.png") });
  assert(errors.length === 0, `browser runtime stayed free of page errors (${errors.join(" | ")})`);
  console.log("GUIDANCE VERIFY OK");
  console.log("SHOTS", SHOTS);
} finally {
  await browser.close();
  server.close();
}
