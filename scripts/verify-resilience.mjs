import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".mp3": "audio/mpeg" };
const server = createServer(async (req, res) => {
  try {
    const raw = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const file = resolve(DIST, "." + decodeURIComponent(raw));
    if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file); res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" }); res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
let browser;
for (const executablePath of [process.env.CHROMIUM_PATH, "/opt/ms-playwright/chromium-1234/chrome-linux64/chrome", "/usr/bin/chromium"].filter(Boolean)) {
  try { browser = await chromium.launch({headless:!process.env.DISPLAY, executablePath, args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-angle=swiftshader","--enable-unsafe-swiftshader"] }); break; } catch { /* next */ }
}
if (!browser) { server.close(); throw new Error("No usable Chromium browser found"); }
const errors = [];
const watch = (page) => {
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() === 404) errors.push(`404 ${r.url()}`); });
};
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log("PASS:", message); };
const finiteState = (state) => [state.runTime, state.raw, state.purified, state.ice, state.credits, state.heat, state.power, state.cleanupPercent, state.salesPerMinute, ...Object.values(state.toolHealth)].every(Number.isFinite);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); watch(page);
  await page.addInitScript(() => { if (!sessionStorage.getItem("stress-settings")) { localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1 })); sessionStorage.setItem("stress-settings", "1"); } });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug, null, { timeout: 30000 });
  const evaluate = (fn, arg) => page.evaluate(fn, arg);

  await evaluate(() => {
    const d = window.__whiteoutDebug; d.start(); d.teleport(7, 8);
    for (let i = 0; i < 100; i++) { d.setRaw(1); d.interact(); }
  });
  let state = await evaluate(() => window.__whiteoutDebug.snapshot());
  assert(state.salesPerMinute === 150 && finiteState(state), "100 consecutive real sales preserve a finite, exact rolling ledger");
  await evaluate(() => window.__whiteoutDebug.step(61));
  assert((await evaluate(() => window.__whiteoutDebug.snapshot())).salesPerMinute === 0, "rolling sale history expires cleanly after stress transactions");

  await evaluate(() => {
    const d = window.__whiteoutDebug; d.giveCredits(100000);
    for (let i = 0; i < 50; i++) { d.setToolHealth("hands", 0); d.setRaw(3); if (!d.repairTool("hands")) throw new Error("repair loop rejected"); }
  });
  state = await evaluate(() => window.__whiteoutDebug.snapshot());
  assert(state.toolHealth.hands === 100 && state.raw === 3, "50 wear-and-paid-repair cycles never lose tool cargo");
  await evaluate(() => {
    const d = window.__whiteoutDebug; d.setQuest(8); const sweeper = d.build("sweeper", 10, 12); d.setOutput(sweeper, 0);
    for (let i = 0; i < 12; i++) { d.step(0.25); }
    for (let i = 0; i < 10; i++) { d.setRobotHealth(sweeper, 0); d.repairBuilding(sweeper); }
  });
  assert((await evaluate(() => window.__whiteoutDebug.robotStates())).every((r) => r.health > 99 && r.health <= 100 && Number.isFinite(r.carry)), "repeated robot breakdown and repair leaves finite health and cargo");

  await evaluate(() => {
    const d = window.__whiteoutDebug; d.teleport(0, 8);
    for (let i = 0; i < 12; i++) { d.teleport(0, 8); d.storm(i % 5 === 0); d.step(40); }
    d.teleport(0, 8);
    // Long-run stability is tested with regular warm-base check-ins, not an AFK survival challenge.
    for (let i = 0; i < 60; i++) { d.teleport(0, 8); d.step(30); }
  });
  state = await evaluate(() => window.__whiteoutDebug.snapshot());
  assert(finiteState(state) && state.stormCount >= 12 && state.runTime >= 2200, `12 storm cycles and 30 additional simulated minutes remain numerically stable (${JSON.stringify({ runTime: state.runTime, stormCount: state.stormCount, heat: state.heat, gameState: state.state })})`);
  assert(await evaluate(() => window.__whiteoutDebug.baseVisual()).then((b) => b.spaceship), "base remains intact after extended simulation");

  for (let i = 0; i < 5; i++) {
    await evaluate(() => window.__whiteoutDebug.save());
    const saved = await evaluate(() => JSON.parse(localStorage.getItem("whiteout.career-v2")));
    assert(saved.version === 11 && saved.toolHealth && Array.isArray(saved.salesHistory) && Array.isArray(saved.relays) && Array.isArray(saved.events), `save/load loop ${i + 1} writes complete schema 11`);
    await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
    assert(await page.locator("#continue-btn").isVisible(), `save/load loop ${i + 1} exposes the continue action`);
    await evaluate(() => { document.querySelector("#continue-btn").click(); window.__whiteoutDebug.pause(); }); state = await evaluate(() => window.__whiteoutDebug.snapshot());
    assert(finiteState(state) && state.runTime >= saved.runTime && state.runTime - saved.runTime < 1, `save/load loop ${i + 1} restores the saved run clock with less than one second of live-frame drift`);
  }

  await evaluate(() => { const d = window.__whiteoutDebug; for (let i = 0; i < 25; i++) d.start(); });
  state = await evaluate(() => window.__whiteoutDebug.snapshot());
  assert(state.credits === 0 && state.raw === 0 && state.salesPerMinute === 0 && Object.values(state.toolHealth).every((v) => v === 100), "25 consecutive restarts leave no economy, ledger or durability residue");

  for (const value of ["{broken", "null", "[]", JSON.stringify({ version: 7, snow: [] }), JSON.stringify({ version: 6, runTime: 10, snow: [0], buildings: [], cores: [], rails: [] })]) {
    await evaluate((v) => localStorage.setItem("whiteout.career-v2", v), value);
    await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
    assert(await evaluate(() => window.__whiteoutDebug.snapshot().state === "title"), "malformed or partial save falls back safely to title");
  }

  const mobile = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }); watch(mobile);
  await mobile.addInitScript(() => localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1 })));
  await mobile.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" }); await mobile.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  await mobile.evaluate(() => window.__whiteoutDebug.start());
  for (let i = 0; i < 8; i++) {
    await mobile.setViewportSize({ width: 390, height: 844 }); await mobile.waitForTimeout(40);
    assert(await mobile.locator("#orientation-lock").isVisible(), `portrait lock ${i + 1} blocks unsafe controls`);
    await mobile.setViewportSize({ width: 844, height: 390 }); await mobile.waitForTimeout(40);
    assert(!(await mobile.locator("#orientation-lock").isVisible()), `landscape restoration ${i + 1} removes the lock`);
  }
  assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "repeated orientation changes produce no horizontal overflow"); await mobile.close();

  const blocked = await browser.newPage({ viewport: { width: 1000, height: 700 } }); watch(blocked);
  await blocked.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"]) Object.defineProperty(Storage.prototype, method, { configurable: true, value() { throw new DOMException("Blocked for stress test", "SecurityError"); } });
  });
  await blocked.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" }); await blocked.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  await blocked.evaluate(() => { const d = window.__whiteoutDebug; d.start(); d.giveCredits(100); d.save(); d.pause(); d.resume(); });
  assert(await blocked.evaluate(() => window.__whiteoutDebug.snapshot().state === "playing"), "unavailable browser storage does not interrupt gameplay");
  await blocked.close();

  assert(errors.length === 0, `zero browser, page or asset errors under stress${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  console.log("RESILIENCE VERIFY OK");
} finally { await browser.close(); server.close(); }
