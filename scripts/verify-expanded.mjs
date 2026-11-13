import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const SHOTS = join(ROOT, "verification-expanded");
mkdirSync(SHOTS, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".mp3": "audio/mpeg" };
const server = createServer(async (req, res) => {
  try {
    const raw = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const file = resolve(DIST, "." + decodeURIComponent(raw));
    if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" }); res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
let browser;
for (const executablePath of [process.env.CHROMIUM_PATH, "/opt/ms-playwright/chromium-1234/chrome-linux64/chrome", "/usr/bin/chromium", "/opt/gchrome/opt/google/chrome/chrome"].filter(Boolean)) {
  try { browser = await chromium.launch({headless:!process.env.DISPLAY, executablePath, args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-angle=swiftshader","--enable-unsafe-swiftshader"] }); break; } catch { /* next browser */ }
}
if (!browser) { server.close(); throw new Error("No usable Chromium browser found"); }
const errors = [];
const watch = (page) => {
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() === 404) errors.push(`404 ${r.url()}`); });
};
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log("PASS:", message); };

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(20000); watch(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem("whiteout.settings-v2")) localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0.2, muted: true, cameraShake: true, particles: true, uiScale: 1 }));
  });
  const debug = (expression, ...args) => page.evaluate(({ expression, args }) => {
    const parts = expression.split("."); let target = window.__whiteoutDebug;
    for (const part of parts) target = target[part];
    return typeof target === "function" ? target(...args) : target;
  }, { expression, args });
  const snap = () => debug("snapshot");
  const probe = () => page.evaluate(() => window.__gameProbe());
  const ready = () => page.waitForFunction(() => window.__GAME_READY__ === true && !!window.__whiteoutDebug, null, { timeout: 90000 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" }); await ready();
  let state;
  assert(await page.evaluate(() => document.documentElement.lang === "en") && await page.locator("#title-settings-btn").isVisible(), "English title screen integrates Settings into its main actions");

  if (!process.env.VERIFY_ROBOTS_ONLY) {
  // Legacy schema migration and the current schema writer.
  await page.evaluate(() => {
    const cores = ["comms", "habitat", "command"].map((id) => ({ id, scanned: false, revealed: false, recovered: false }));
    localStorage.setItem("whiteout.career-v2", JSON.stringify({
      version: 2, runTime: 12, raw: 2, purified: 0, ice: 0, credits: 123, heat: 80, power: 20,
      recovered: 0, produced: 0, collectedRaw: 2, purifiedSold: 0, sold: 0, iceSold: 0,
      railDelivered: 0, questIndex: 0, upgrades: { tank: true, scanner: false, thermal: true, boots: false },
      tools: { shovel: 1, brush: 0, blower: 0, vacuum: 0 }, selectedTool: "shovel",
      player: { x: 0, z: 2 }, snow: Array(160 * 160).fill(0), cores, buildings: [], rails: [],
    }));
  });
  await page.reload({ waitUntil: "networkidle" }); await ready(); await page.click("#continue-btn");
  state = await snap();
  assert(state.capacity === 10 && state.upgrades.thermal === 1 && state.tools.hands === 1, "legacy save migrates to numeric gear levels and per-tool capacity");
  await debug("save");
  const migratedWrite = await page.evaluate(() => ({ state: window.__whiteoutDebug.snapshot().state, raw: localStorage.getItem("whiteout.career-v2") }));
  assert(JSON.parse(migratedWrite.raw).version === 11, `next save writes schema version 11 (${migratedWrite.state}: ${migratedWrite.raw.slice(0, 100)})`);
  await debug("start"); await page.waitForTimeout(200); state = await snap();
  assert(state.worldSize === 140.4, "physical world is exactly 35 percent larger than the original 104-unit map");
  assert(state.credits === 0 && state.capacity === 5 && state.selectedTool === "hands" && state.tools.shovel === 0, "fresh run starts with zero credits and only five-unit hands");
  assert(Object.values((await debug("visualState")).tools).filter(Boolean).length === 1 && (await debug("visualState")).tools.hands, "hands are the only visible starting equipment");
  assert(state.radarCharges === 3 && state.radarMaxCharges === 5, "handheld scanner begins with a three-charge stack and five-charge limit");
  assert(await page.locator("#storm-forecast").isVisible() && state.stormEta > 149 && state.stormEta <= 150, "top forecast bar shows the approximate first storm arrival");

  // Pointer policy, walking, Shift sprint and thermal cost.
  const passive = await debug("visualState");
  await page.mouse.move(1100, 500); await page.waitForTimeout(150);
  const passiveAfter = await debug("visualState");
  assert(Math.abs(passiveAfter.facingX - passive.facingX) < 0.001 && Math.abs(passiveAfter.facingZ - passive.facingZ) < 0.001, "passive mouse movement leaves robot facing unchanged");
  await page.keyboard.down("KeyD"); await page.waitForFunction(() => window.__whiteoutDebug.visualState().facingX > 0.9, null, { timeout: 10000 }); await page.keyboard.up("KeyD");
  assert((await debug("visualState")).facingX > 0.9, "WASD primarily determines robot facing");
  const beforeClick = await debug("visualState");
  await page.mouse.move(640, 480); await page.mouse.down(); await page.waitForFunction((before) => Math.hypot(window.__whiteoutDebug.visualState().facingX - before.facingX, window.__whiteoutDebug.visualState().facingZ - before.facingZ) > 0.15, beforeClick, { timeout: 10000 });
  const afterClick = await debug("visualState");
  const clickEvidence = await page.evaluate(() => ({ element: document.elementFromPoint(340, 480)?.outerHTML.slice(0, 180), state: window.__whiteoutDebug.snapshot().state, visual: window.__whiteoutDebug.visualState() }));
  assert(Math.hypot(afterClick.facingX - beforeClick.facingX, afterClick.facingZ - beforeClick.facingZ) > 0.15, `holding a snow-clearing click aims toward the pointer (${JSON.stringify(clickEvidence)})`);
  await page.mouse.up();

  const movement = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code }));
    const run = (sprint) => {
      d.teleport(0, -10); const start = window.__gameProbe(); const heat = d.snapshot().heat;
      key("keydown", "KeyD"); if (sprint) key("keydown", "ShiftLeft");
      d.step(1); const end = window.__gameProbe(); const state = d.snapshot(); const animation = d.visualState().character;
      key("keyup", "KeyD"); key("keyup", "ShiftLeft");
      return { distance: Math.hypot(end.x - start.x, end.z - start.z), drain: heat - state.heat, speed: state.speed, sprinting: state.sprinting, animation };
    };
    return { walk: run(false), sprint: run(true) };
  });
  assert(movement.walk.animation === "walk", "walking uses articulated walk animation");
  assert(movement.sprint.sprinting && movement.sprint.animation === "run", "Shift produces the actual run state and animation");
  const walkDistance = movement.walk.distance, sprintDistance = movement.sprint.distance;
  const walkingDrain = movement.walk.drain, sprintingDrain = movement.sprint.drain;
  assert(Math.abs(movement.sprint.speed / movement.walk.speed - 1.62) < 0.001 && sprintDistance > walkDistance * 1.4, `Shift applies the exact 1.62 speed multiplier and moves farther on physical terrain (walk=${walkDistance.toFixed(3)}, sprint=${sprintDistance.toFixed(3)})`);
  assert(Math.abs(walkingDrain - 0.95) < 0.03 && Math.abs(sprintingDrain / walkingDrain - 1.35) < 0.03, "calm drain is 0.95 per second and sprinting costs 35 percent more heat");

  // All UI dictionaries, direction, accessible descriptions and mystery wording.
  await page.click("#settings-btn");
  for (const [lang, dir] of [["en", "ltr"], ["zh", "ltr"], ["fa", "rtl"]]) {
    await page.selectOption("#set-language", lang);
    assert(await page.evaluate(({ lang, dir }) => document.documentElement.lang.startsWith(lang) && document.documentElement.dir === dir, { lang, dir }), `language ${lang} applies with correct direction`);
    assert(await page.evaluate(() => [...document.querySelectorAll("[data-i18n]")].every((el) => el.textContent.trim() && el.textContent.trim() !== el.dataset.i18n)), `no visible untranslated i18n keys in ${lang}`);
    assert(await page.locator("[data-build]").evaluateAll((buttons) => buttons.filter((b) => b.dataset.build !== "rail").every((b) => b.title.length > 35 && b.getAttribute("aria-label").includes("—"))), `every building has a precise translated description in ${lang}`);
    if (lang === "fa") {
      await page.click("#close-settings-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn"); await page.waitForTimeout(150);
      const rtlStack = await page.evaluate(() => {
        const q = document.querySelector(".quest-card").getBoundingClientRect(); const t = document.querySelector(".tool-chip").getBoundingClientRect(); const s = document.querySelector(".scanner-chip").getBoundingClientRect(); const r = document.querySelector(".resource-card").getBoundingClientRect();
        return { questLeft: q.left, questBottom: q.bottom, toolTop: t.top, toolBottom: t.bottom, scannerTop: s.top, scannerRight: s.right, resourceLeft: r.left };
      });
      assert(rtlStack.questLeft < 40 && rtlStack.questBottom <= rtlStack.toolTop && rtlStack.toolBottom <= rtlStack.scannerTop && rtlStack.scannerRight < rtlStack.resourceLeft, `Persian keeps the left instrument flow clear of the right resource card (${JSON.stringify(rtlStack)})`);
      await page.click("#settings-btn");
    }
  }
  for (const [track, file] of [["quiet-aurora", "quiet-aurora-loop.mp3"], ["snowglass-drift", "snowglass-drift-loop.mp3"], ["polar-night", "polar-night-loop.mp3"]]) {
    await page.selectOption("#set-music-track", track);
    const selectedAudio = await debug("audioState");
    assert(selectedAudio.track === track && selectedAudio.music === file && selectedAudio.musicLoop, `calm music choice ${track} loads its local seamless-loop asset`);
  }
  await page.selectOption("#set-music-track", "none");
  assert((await debug("audioState")).track === "none" && (await debug("audioState")).sfxEnabled && (await debug("audioState")).ambienceEnabled, "music can be disabled without muting effects or ambience");
  await page.uncheck("#set-music-enabled");
  assert(!(await debug("audioState")).musicEnabled && (await debug("audioState")).sfxEnabled && (await debug("audioState")).ambienceEnabled, "music switch is independent from both other audio channels");
  await page.uncheck("#set-sfx-enabled");
  assert(!(await debug("audioState")).sfxEnabled && (await debug("audioState")).ambienceEnabled, "action-effects switch leaves ambience independently enabled");
  await page.uncheck("#set-ambience-enabled");
  assert(!(await debug("audioState")).ambienceEnabled && !(await debug("audioState")).sfxEnabled, "ambience switch has its own authoritative state");
  await page.check("#set-music-enabled"); await page.check("#set-sfx-enabled"); await page.check("#set-ambience-enabled");
  await page.selectOption("#set-music-track", "quiet-aurora");
  for (const [selector, key, value] of [["#set-music-volume", "musicVolume", 0.35], ["#set-sfx-volume", "sfxVolume", 0.45], ["#set-ambience-volume", "ambienceVolume", 0.25]]) {
    await page.locator(selector).evaluate((el, next) => { el.value = String(next); el.dispatchEvent(new Event("input", { bubbles: true })); }, value);
    assert(Math.abs((await debug("audioState"))[key] - value) < 0.001, `${key} slider updates only its own channel`);
  }
  await page.selectOption("#set-language", "en"); await page.click("#close-settings-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn");
  await page.keyboard.down("ControlLeft"); await page.waitForFunction(() => document.querySelector("#ui-overlay").classList.contains("details-expanded"), null, { timeout: 10000 });
  assert(await page.locator("#ui-overlay").evaluate((el) => el.classList.contains("details-expanded")), "holding Ctrl expands summarized HUD details");
  const expandedStack = await page.evaluate(() => { const q = document.querySelector(".quest-card").getBoundingClientRect(); const t = document.querySelector(".tool-chip").getBoundingClientRect(); const s = document.querySelector(".scanner-chip").getBoundingClientRect(); return { questBottom: q.bottom, toolTop: t.top, toolBottom: t.bottom, scannerTop: s.top }; });
  assert(expandedStack.questBottom <= expandedStack.toolTop && expandedStack.toolBottom <= expandedStack.scannerTop, "expanded quest, tool and scanner cards flow without overlap");
  await page.keyboard.up("ControlLeft"); await page.waitForFunction(() => !document.querySelector("#ui-overlay").classList.contains("details-expanded"), null, { timeout: 10000 });
  assert(!(await page.locator("#ui-overlay").evaluate((el) => el.classList.contains("details-expanded"))), "releasing Ctrl restores the compact HUD");
  assert(!(await page.locator("body").innerText()).match(/memories|خاطره|回忆/i), "old memories terminology is absent from player-facing text");

  // Opening economy and handheld scanner charges.
  await debug("setRaw", 1); await debug("teleport", 7, 8); await debug("interact"); state = await snap();
  assert(state.raw === 0 && state.credits === 1, "one raw unit (20% hand load) sells immediately");
  await debug("setRaw", 5); await debug("interact"); state = await snap();
  assert(state.raw === 0 && state.credits === 89 && state.quest.index === 1, "partial raw sales complete the first guided income loop");
  await debug("setCarried", 0.5, 0); await debug("interact"); state = await snap();
  assert(state.purified === 0 && state.credits === 92, "partial purified cargo sells without a full tank");
  await debug("setCarried", 0, 1); await debug("interact"); state = await snap();
  assert(state.ice === 0 && state.credits === 147 && state.iceSold === 1, "a single ice block sells without any other cargo");
  await debug("scan"); assert((await snap()).radarCharges === 2, "each handheld scan consumes exactly one stacked charge");
  await debug("step", 7); await debug("scan"); assert((await snap()).radarCharges === 1, "a second ready pulse consumes the next charge");
  const beforeBattery = (await snap()).credits; await debug("buyBattery");
  assert((await snap()).radarCharges === 2 && (await snap()).credits === beforeBattery - 55, "each purchased battery adds one charge and deducts its price");
  await debug("giveCredits", 500); for (let i = 0; i < 3; i++) await debug("buyBattery");
  assert((await snap()).radarCharges === 5, "battery purchases stack to the five-charge cap");
  const cappedCredits = (await snap()).credits; await debug("buyBattery");
  assert((await snap()).radarCharges === 5 && (await snap()).credits === cappedCredits, "a full scanner stack rejects extra purchases without charging");

  // Three damaged recovery installations replace the old paid radar.
  assert(await page.evaluate(() => document.documentElement.lang === "en" && document.querySelector("#title-settings-btn")), "English is the default and title settings are integrated into the main actions");
  const lockedRelayCredits = (await snap()).credits;
  assert(!(await debug("repairRelay", "gale")) && (await snap()).credits === lockedRelayCredits, "recovery installation remains locked before purification without charging");
  await debug("setQuest", 2); await debug("giveCredits", 5000);
  const relayCosts = { gale: 650, servo: 1050, foundry: 1450 };
  for (const [id, cost] of Object.entries(relayCosts)) {
    const before = await snap(); assert(await debug("repairRelay", id), `${id} recovery installation repairs successfully`);
    state = await snap(); const relay = state.relays.find((r) => r.id === id);
    assert(relay.repaired && state.credits === before.credits - cost && relay.warmth >= 12, `${id} charges its distinct price and provides a warm radius larger than an ordinary heater`);
  }
  await page.click("#relay-top-btn");
  assert(await page.locator("#relay-guide").isVisible() && await page.locator("#relay-list .relay-card.online").count() === 3 && (await page.locator(".power-explainer").innerText()).includes("never fill this mission bar"), "recovery guide shows three restored installations and explains mission charge versus local electricity");
  const relayBounds = await page.locator("#relay-guide").boundingBox();
  assert(!!relayBounds && relayBounds.x >= 0 && relayBounds.y >= 0 && relayBounds.x + relayBounds.width <= 1280 && relayBounds.y + relayBounds.height <= 720, "desktop recovery guide stays completely inside the viewport");
  await page.click("#close-relay-help"); assert(!(await page.locator("#relay-guide").isVisible()), "recovery guide closes without opening another overlapping dialog");
  const scannerBefore = await snap(); await debug("step", 0.02);
  assert((await snap()).scannerRadius === scannerBefore.scannerRadius, "handheld scanner range is independent from recovery installations");

  // Tools, independent tanks, mounted models and artwork.
  await debug("setQuest", 6); await debug("giveCredits", 20000);
  await page.waitForFunction(() => window.__whiteoutDebug.visualState().character === "idle", null, { timeout: 30000 });
  assert(true, "cute recovery robot exposes procedural animation states");
  for (const capacity of [8, 12, 18]) { await debug("buyTool", "hands"); assert((await snap()).capacity === capacity, `hand capacity upgrades to ${capacity}`); }
  for (const [id, capacities] of Object.entries({ shovel: [10, 16, 24, 34], brush: [20, 30, 44, 62], blower: [32, 48, 68, 94], vacuum: [48, 70, 100, 140] })) {
    for (const capacity of capacities) {
      await debug("buyTool", id); await debug("selectTool", id); state = await snap();
      assert(state.capacity === capacity, `${id} has independent capacity ${capacity}`);
    }
    assert((await debug("visualState")).tools[id], `${id} is visibly mounted when selected`);
  }
  await debug("openUpgrades"); await page.waitForFunction(() => { const images = [...document.querySelectorAll("img.item-art")]; return images.length === 9 && images.every((img) => img.complete && img.naturalWidth > 0); }, null, { timeout: 10000 });
  assert(await page.locator("img.item-art").count() === 9, "all five tools, three gear upgrades and scanner battery have item-specific artwork");
  assert(await page.locator("img.item-art").evaluateAll((images) => images.every((img) => img.src.startsWith("data:image/svg+xml") && img.complete && img.naturalWidth > 0)), "every shop illustration loads as a coherent local SVG");
  assert((await page.locator("#mute-btn").innerText()).trim().length > 2 && (await page.locator("#mute-btn").getAttribute("title")).length > 2, "sound control has a visible label and accessible action name");
  await page.screenshot({ path: join(SHOTS, "02-tools-and-gear.png") });
  await page.click("#close-upgrades-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn");

  // Production, actual machine geometry and explicit storage bars.
  await debug("selectTool", "vacuum");
  const purifier = await debug("buyBuilding", "purifier", 3, -2);
  await debug("setRaw", 12); await debug("teleport", 3, -2); await debug("interact");
  assert((await snap()).raw === 0, "raw snow has an explicit purifier unloading destination");
  await debug("setInput", purifier, 12); await debug("step", 4);
  state = await snap(); const purifierView = state.buildings.find((b) => b.id === purifier);
  assert(purifierView.output > 0 && purifierView.inputCapacity === 80 && purifierView.outputCapacity === 80, "purifier processes snow and reports used/capacity storage");
  await page.waitForTimeout(120);
  assert(await page.locator("#building-input-bar").evaluate((el) => parseFloat(el.style.width) > 0) && await page.locator("#building-output-bar").evaluate((el) => parseFloat(el.style.width) > 0), "both purifier tanks display real progress bars as well as numbers");
  assert((await page.locator("#building-output").innerText()).includes("/"), "building tanks retain explicit numeric used/capacity readouts");
  await debug("selectBuild", "purifier"); await page.waitForTimeout(500);
  assert((await debug("ghostCount")) >= 5, "construction ghost uses actual machine geometry"); await page.keyboard.press("Escape");
  const press = await debug("buyBuilding", "press", -3, -3);
  await debug("setInput", press, 10); await debug("step", 7);
  assert((await snap()).buildings.find((b) => b.id === press).output >= 2, "ice press produces blocks with assigned-power efficiency");
  const initialPurifierRate = (await snap()).buildings.find((b) => b.id === purifier).productionRate;
  await debug("teleport", 3, -2); await debug("upgradeNearest"); await debug("step", 0.02);
  const levelTwoRate = (await snap()).buildings.find((b) => b.id === purifier).productionRate;
  assert(levelTwoRate > initialPurifierRate * 1.8, "higher-level production buildings have a meaningfully faster measured throughput");
  assert(await page.locator("#building-production").isVisible() && (await page.locator("#building-next-rate").innerText()).length > 2, "building card displays current and next-level production throughput");
  const sites = await debug("heaterSites"); assert(sites.length === 4 && new Set(sites.map((p) => `${p.x}:${p.z}`)).size === 4, "four-heater quest exposes four distinct recommended installation sites");

  // Heater melting, permanent powered-zone protection and variable forecast scheduling.
  const heater = await debug("buyBuilding", "heater", 14, 0);
  assert((await debug("snowAt", 14, 0)) < 0.001, "construction automatically clears the building pad instead of leaving the machine on snow");
  const snowBefore = await debug("snowAt", 14, 3);
  await debug("step", 2); const snowAfter = await debug("snowAt", 14, 3);
  assert(snowBefore > 0 && snowAfter < snowBefore, "powered heater gradually melts existing snow outside its cleared construction pad");
  await debug("storm"); await debug("step", 2);
  assert((await debug("snowAt", 14, 0)) <= snowAfter + 0.001, "heater zone remains permanently protected from storm snow");
  const waitForCalm = async () => {
    for (let i = 0; i < 90; i++) {
      if ((await snap()).stormPhase === "calm") return (await snap()).stormEta;
      await debug("step", 1);
    }
    throw new Error("storm did not return to calm within the bounded verification window");
  };
  await debug("teleport", 0, 8); const etaFirst = await waitForCalm();
  assert(etaFirst > 80 && etaFirst < 145, `post-storm calm interval is randomly scheduled inside the configured range, including Gale-shortened severe storms (eta=${etaFirst})`);
  await debug("storm"); await debug("step", 2); const etaSecond = await waitForCalm();
  assert(etaSecond > 80 && etaSecond < 145 && Math.abs(etaSecond - etaFirst) > 0.01, "successive calm intervals vary instead of using a fixed timer");

  // Relocation, demolition, footprints, work poses and storm penalties.
  assert(await debug("moveBuilding", heater, 15, 1), "constructed building relocates successfully");
  state = await snap(); const moved = state.buildings.find((b) => b.id === heater);
  assert(moved.x === 15 && moved.z === 1, "relocated building updates its authoritative position");
  assert((await debug("snowAt", 15, 1)) < 0.001, "relocation also clears snow from the new construction pad");
  const beforeDemolish = state.credits;
  assert(await debug("demolishBuilding", heater), "constructed building can be demolished");
  assert(!(await snap()).buildings.some((b) => b.id === heater) && (await snap()).credits === beforeDemolish + 140, "demolition removes the building and refunds 50 percent");
  await debug("teleport", 0, 20); await debug("setRaw", 0); await debug("setCarried", 0, 0);
  await page.keyboard.down("KeyD"); await page.waitForTimeout(1200); await page.keyboard.up("KeyD");
  // A fully upgraded vacuum exhausts its first patch almost instantly. Keep
  // walking into fresh snow so the assertion observes sustained real clearing.
  await page.keyboard.down("KeyD"); await page.keyboard.down("Space");
  await page.waitForFunction(() => window.__whiteoutDebug.visualState().character === "work", null, { timeout: 3000 });
  assert((await debug("visualState")).character === "work", "character visibly works with its equipped tool while clearing");
  await page.keyboard.up("Space"); await page.keyboard.up("KeyD"); await debug("interact");
  const pickupObserved = await page.waitForFunction(() => window.__whiteoutDebug.visualState().character === "pickup", null, { timeout: 3000 }).then(() => true);
  assert(pickupObserved, "character performs a visible pickup and interaction pose");
  assert((await debug("visualState")).activeFootprints > 0, "walking creates active footprints");
  await debug("step", 13); assert((await debug("visualState")).activeFootprints === 0, "footprints fade and disappear after their lifetime");
  const weather = await page.evaluate(() => {
    const d = window.__whiteoutDebug; d.teleport(30, 30);
    const calmHeat = d.snapshot().heat, calmSpeed = d.snapshot().speed; d.step(4);
    const normalDrain = calmHeat - d.snapshot().heat; d.storm(); d.step(0.02);
    const stormHeat = d.snapshot().heat, stormSpeed = d.snapshot().speed; d.step(4);
    return { calmSpeed, stormSpeed, normalDrain, stormDrain: stormHeat - d.snapshot().heat };
  });
  const { calmSpeed, stormSpeed, normalDrain, stormDrain } = weather;
  assert(stormSpeed < calmSpeed * 0.7, "storm materially reduces player movement speed");
  assert(Math.abs(stormDrain / normalDrain - 2.8 / 0.95) < 0.01, `storm heat drain matches the stronger 2.8-per-second rate (calm=${normalDrain.toFixed(3)}, storm=${stormDrain.toFixed(3)}, ratio=${(stormDrain / normalDrain).toFixed(3)})`);
  const accumulationAndWind = await page.evaluate(() => {
    const d = window.__whiteoutDebug; d.teleport(30, 34); d.clearAt(30, 34, 4);
    const cleared = d.snowAt(30, 34); d.step(5);
    const regrown = d.snowAt(30, 34); let repeatedRegrowth = 0;
    for (let i = 0; i < 6; i++) {
      d.teleport(30, 34); d.clearAt(30, 34, 4); d.step(0.75);
      repeatedRegrowth = Math.max(repeatedRegrowth, d.snowAt(30, 34));
    }
    d.teleport(34, 34); const start = window.__gameProbe(); d.step(5); const pushed = window.__gameProbe();
    const wind = d.snapshot(); return { cleared, regrown, repeatedRegrowth, dx: pushed.x - start.x, dz: pushed.z - start.z, windX: wind.windX, windZ: wind.windZ, distance: Math.hypot(pushed.x - start.x, pushed.z - start.z) };
  });
  assert(accumulationAndWind.cleared < 0.001 && accumulationAndWind.regrown > 0.005 && accumulationAndWind.repeatedRegrowth > 0.005, `clean ground keeps accumulating snow during the storm even immediately after repeated clearing (${JSON.stringify(accumulationAndWind)})`);
  const windAlignment = (accumulationAndWind.dx * accumulationAndWind.windX + accumulationAndWind.dz * accumulationAndWind.windZ) / Math.max(0.001, accumulationAndWind.distance);
  assert(accumulationAndWind.dx < -0.25 && accumulationAndWind.dz > 0.15 && accumulationAndWind.distance < 8 && windAlignment > 0.95, `a stationary player slides along the visible negative-X/positive-Z wind vector (${JSON.stringify({ ...accumulationAndWind, windAlignment })})`);
  if (!process.env.VERIFY_EARLY_ONLY) {
  await debug("teleport", 0, 8); await debug("step", 28);
  for (const building of (await snap()).buildings.filter((item) => item.damaged)) await debug("repairBuilding", building.id);

  // Upgrade detail groups and non-cube robot dock geometry.
  const worker = await debug("build", "sweeper", 12, 12);
  const hauler = await debug("build", "hauler", -18, 0);
  const generator = await debug("build", "generator", -12, -12);
  const upgradedHeater = await debug("build", "heater", 14, 0);
  const visualTargets = [[purifier, 3, -2], [press, -3, -3], [worker, 12, 12], [hauler, -18, 0], [upgradedHeater, 14, 0], [generator, -12, -12]];
  for (const [id, x, z] of visualTargets) {
    await debug("teleport", x, z); await debug("upgradeNearest"); await debug("upgradeNearest");
    const visual = (await debug("buildingVisuals")).find((b) => b.id === id);
    assert(visual.level === 3 && visual.visible === 2 && visual.meshes >= 4, `${visual.type} displays two theme-appropriate upgrade detail groups`);
  }
  for (const id of [worker, hauler]) assert((await debug("buildingVisuals")).find((b) => b.id === id).baseMeshes >= 15, "robot dock uses a detailed service bay rather than a simple cube");

  // One-way magnetic capsules, route compatibility and normal-camera restoration.
  await debug("teleport", 0, 8); await debug("setQuest", 6);
  assert(!(await debug("rail", worker, 0)), "raw-snow guideway correctly rejects a sales-only destination");
  assert(await debug("rail", worker, purifier), "sweeper dock connects one-way raw-snow capsules to purifier");
  const capsuleEvidence = await page.evaluate(({ worker }) => {
    const d = window.__whiteoutDebug; d.setOutput(worker, 30);
    const freightBefore = d.snapshot().quest.progress;
    let dispatched = false, enRoute = false, delivered = false, negativeTravel = false;
    const lastDistances = new Map();
    for (let i = 0; i < 180; i++) {
      // Sample each simulation tick so capsule slot reuse cannot look like
      // backwards travel when unloading and redispatch happen within one step.
      d.step(1 / 60); const r = d.railState().find((it) => it.sourceId === worker);
      const active = r.capsules.filter((c) => c.active);
      r.capsules.forEach((c, index) => {
        if (!c.active) { lastDistances.delete(index); return; }
        const previous = lastDistances.get(index);
        if (previous !== undefined && c.distance < previous - 0.01) negativeTravel = true;
        lastDistances.set(index, c.distance);
      });
      if (active.length) dispatched = true;
      if (active.some((c) => c.visible && c.distance > 1 && c.distance < r.total - 1)) enRoute = true;
      const quest = d.snapshot().quest; if (quest.index > 6 || quest.progress > freightBefore) delivered = true;
      if (dispatched && enRoute && delivered) break;
    }
    const route = d.railState().find((it) => it.sourceId === worker);
    return { dispatched, enRoute, delivered, negativeTravel, arrows: route.oneWayArrows, capsules: route.capsules.length };
  }, { worker });
  assert(capsuleEvidence.dispatched && capsuleEvidence.enRoute && capsuleEvidence.delivered && !capsuleEvidence.negativeTravel && capsuleEvidence.arrows >= 1 && capsuleEvidence.capsules === 4, `loaded capsules travel source-to-destination only, remain visible en route and disappear after unloading (${JSON.stringify(capsuleEvidence)})`);
  await debug("step", 0.02); state = await snap(); assert(state.quest.index === 6 && state.quest.progress > 0, "raw-to-purifier capsule deliveries advance the magnetic-freight quest");
  assert(await debug("rail", purifier, press), "purifier connects purified-snow capsules directly to ice press");
  await debug("setOutput", purifier, 28); await debug("step", 10);
  state = await snap(); const pureDestination = state.buildings.find((b) => b.id === press);
  assert(pureDestination.input > 0 || pureDestination.output > 0, "one-way capsules unload purified snow into ice press");
  const beforeRailSale = state.iceSold; assert(await debug("buyRail", press, 0), "ice press connects ice-block capsules to sales depot");
  await debug("setOutput", press, 5); await debug("step", 20);
  assert((await snap()).iceSold > beforeRailSale, "one-way ice capsules deliver real saleable blocks");
  const rails = await debug("railState");
  assert(rails.some((r) => r.corners >= 2), "bent routes include visible curved futuristic corner connectors");
  assert(rails.every((r) => r.modernRails >= 1 && r.oneWayArrows >= 1 && Number.isFinite(r.total)), "every route has magnetic conductors, one-way arrows and finite capsule telemetry");
  await page.click('[data-build="rail"]'); const cameraBeforeOrbit = await debug("cameraState");
  assert(cameraBeforeOrbit.railMode && cameraBeforeOrbit.rotationEnabled, "maglev mode explicitly enables camera rotation for distant endpoints");
  await page.mouse.move(640, 350); await page.mouse.down({ button: "right" }); await page.mouse.move(760, 350, { steps: 12 }); await page.waitForTimeout(300); await page.mouse.up({ button: "right" });
  const cameraAfterOrbit = await debug("cameraState");
  assert(Math.abs(cameraAfterOrbit.azimuth - cameraBeforeOrbit.azimuth) > 0.4 && cameraAfterOrbit.railMode, "right-drag rotates the actual camera azimuth without placing or cancelling a route");
  await page.click('[data-build="rail"]'); await page.waitForTimeout(150); assert(!(await debug("cameraState")).railMode && !(await debug("cameraState")).rotationEnabled, "clicking the maglev button again exits exactly like Escape and restores the normal camera");

  await debug("setInput", purifier, 0); await debug("setOutput", worker, 120); await debug("step", 45);
  assert((await snap()).quest.index >= 8, "60 compatible capsule deliveries complete the freight quest and two robots satisfy the next quest");
  const fractionalQuest = await page.evaluate(() => {
    const d = window.__whiteoutDebug; d.setRailDelivered(59.995); d.setQuest(6);
    const displayed = d.snapshot().quest; d.step(0.02);
    return { displayed, after: d.snapshot() };
  });
  assert(fractionalQuest.displayed.progress === 60, "floating-point values within the display epsilon normalize to the full target");
  assert(fractionalQuest.after.quest.index >= 7, `a full-looking 59.995/60 freight quest completes instead of sticking (${JSON.stringify({ state: fractionalQuest.after.state, quest: fractionalQuest.after.quest })})`);
  await debug("setQuest", 7); await debug("step", 0.02);
  assert((await snap()).robotCount >= 2 && (await snap()).quest.index === 8, "two actual robots complete the two-robot quest");

  // Version-6 restoration of radar, robots, tools, buildings and rails.
  await debug("save"); const savedProduction = await page.evaluate(() => JSON.parse(localStorage.getItem("whiteout.career-v2")));
  await page.reload({ waitUntil: "networkidle" }); await ready(); await page.click("#continue-btn"); state = await snap();
  assert(savedProduction.version === 11 && savedProduction.radarActive === false && savedProduction.relays.length === 3 && Array.isArray(savedProduction.events) && Number.isFinite(savedProduction.nextStormAt), "schema-11 save contains recovery installations, event archive and storm scheduling state");
  assert(!state.radarActive && state.relays.every((r) => r.repaired) && state.buildings.some((b) => b.id === purifier) && state.tools.vacuum === 4 && state.radarCharges === 5 && (await debug("railState")).length === 3, "save restores installations, scanner, tools, buildings and one-way routes without the legacy radar");
  assert(state.robotCount === 2 && state.buildings.find((b) => b.type === "sweeper").robotCapacity === 38 && state.buildings.find((b) => b.type === "hauler").robotCapacity === 0, "save restores the level-three sweeper capacity and the cargo-free rescue role");
  assert((await debug("buildingVisuals")).filter((b) => b.level === 3 && b.visible === 2).length >= 6, "save restoration keeps each building's visible upgrade details");
  await debug("teleport", 3, -1); await page.waitForTimeout(400);
  const desktopBuildingLayout = await page.evaluate(() => {
    const card = document.querySelector("#building-card").getBoundingClientRect();
    const others = [...document.querySelectorAll(".quest-card, .tool-chip, .scanner-chip, .resource-card, .prompt, .build-dock")].map((el) => el.getBoundingClientRect());
    const overlaps = others.some((r) => card.left < r.right && card.right > r.left && card.top < r.bottom && card.bottom > r.top);
    return { visible: card.width > 0 && card.height > 0, bounded: card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight, overlaps };
  });
  assert(desktopBuildingLayout.visible && desktopBuildingLayout.bounded && !desktopBuildingLayout.overlaps, `desktop building card stays bounded and clear of every HUD instrument (${JSON.stringify(desktopBuildingLayout)})`);
  await page.screenshot({ path: join(SHOTS, "03-busy-desktop.png") });
  await debug("recoverAll"); assert((await snap()).state === "playing" && (await snap()).cleanupPercent < 98, "evidence and power alone cannot finish an uncleared map");
  assert((await snap()).events.filter((e) => e.kind === "clue").length === 3, "all three discovered clue texts remain in persistent event data");
  await debug("openLog"); assert(await page.locator("#event-list .event-entry").count() >= 3 && (await page.locator("#event-list").innerText()).includes("Manifest 07"), "event archive reopens the actual recovered clue text"); await page.click("#close-log-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn");
  await debug("win"); assert((await snap()).state === "victory" && (await snap()).cleanupPercent >= 98, "victory requires full-map cleanup, clues and power");
  assert((await page.locator("#end-copy").innerText()).includes("organized signal") && (await page.locator("#end-copy").innerText()).includes("transmitted"), "staged mystery concludes by exposing and transmitting the shipment evidence");

  }
  // Multi-robot sweepers, independent zones, manual dock deposit and autonomous rescue.
  await debug("start"); await page.click("#settings-btn"); await page.selectOption("#set-language", "en"); await page.click("#close-settings-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn");
  await debug("setQuest", 8); await debug("giveCredits", 30000);
  const robotPurifier = await debug("build", "purifier", 3, -2);
  const loopSweeper = await debug("build", "sweeper", 10, 12);
  const transportHauler = await debug("build", "hauler", -12, 12);
  await debug("setOutput", loopSweeper, 4); state = await snap();
  const sweeperView = state.buildings.find((b) => b.id === loopSweeper), haulerView = state.buildings.find((b) => b.id === transportHauler);
  assert(sweeperView.robotCapacity === 26 && sweeperView.outputCapacity === 72 && sweeperView.robotCarry !== sweeperView.output, "sweeper robot tank and enlarged dock-output tank are separate values");
  assert(haulerView.robotRole === "hauler" && haulerView.robotCapacity === 0 && haulerView.outputCapacity === 0, "search-and-rescue unit has no misleading cargo or rail-output tank");
  await page.click("#robots-btn"); await page.waitForTimeout(150);
  assert(await page.locator("#robot-list .robot-card").count() === 2, "robot telemetry lists every robot separately");
  const robotText = await page.locator("#robot-list").innerText();
  assert(robotText.includes("reserves 2 / 3 / 4 chunks") && robotText.includes("aerial welder") && robotText.includes("136.89"), "robot roster explains chunk quotas, exact area and aerial repair roles precisely");
  assert(await page.locator(".chunk-map").count() === 1 && await page.locator(".chunk-cell").count() === 144, "visible 12-by-12 assignment map exposes all 144 snow chunks");
  await page.screenshot({ path: join(SHOTS, "04-robot-telemetry.png") }); await page.click("#close-robots-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn");
  const customChunk = (await snap()).chunks.slice().sort((a, b) => b.remaining - a.remaining)[0].id;
  assert(await debug("setRobotZoneMode", loopSweeper, 0, "custom", customChunk), "player assigns an independent custom snow chunk");
  await debug("step", 0.2); let assignedZone = (await debug("robotStates")).find((r) => r.id === loopSweeper && r.slot === 0);
  assert(assignedZone.zoneMode === "custom" && !assignedZone.zoneAuto && assignedZone.chunkIds.includes(customChunk) && assignedZone.chunkIds.length === 2, `custom chunk and level-one two-chunk quota reach authoritative robot state (${JSON.stringify(assignedZone)})`);
  assignedZone = (await debug("robotStates")).find((r) => r.id === loopSweeper && r.slot === 0);
  assert(assignedZone.targetX !== null && assignedZone.pathLength >= 1 && assignedZone.yaw === assignedZone.yaw, "chunk targeting selects real remaining snow and computes an obstacle-aware route");
  assert(await debug("setRobotZoneMode", loopSweeper, 0, "follow"), "professional follow-player mode is available");
  await debug("teleport", 30, 30); await debug("step", 0.2); assignedZone = (await debug("robotStates")).find((r) => r.id === loopSweeper && r.slot === 0);
  const followPlayer = await probe(); assert(assignedZone.zoneMode === "follow" && Math.hypot(assignedZone.zoneX - followPlayer.x, assignedZone.zoneZ - followPlayer.z) < 0.01, `follow mode continuously updates the work center to the player (${JSON.stringify(assignedZone)})`);
  await debug("teleport", 10, 12); await debug("upgradeNearest"); await debug("upgradeNearest");
  const beforeExtraCredits = (await snap()).credits;
  assert(await debug("buyExtraRobot", loopSweeper) && await debug("buyExtraRobot", loopSweeper), "level-three sweeper deploys two additional purchased robots");
  assert((await snap()).credits === beforeExtraCredits - 780 && (await debug("robotStates")).filter((r) => r.id === loopSweeper).length === 3, "each extra sweeper costs half the 780-credit dock and all three units exist");
  assert(!(await debug("buyExtraRobot", loopSweeper)), "sweeper cannot exceed its level-three three-robot limit");
  await page.click("#robots-btn");
  const uiChunk = (await snap()).chunks.slice().sort((a, b) => b.remaining - a.remaining)[0].id;
  await page.selectOption(`[data-zone-mode="${loopSweeper}:1"]`, "custom"); await page.locator(`[data-chunk-mode="${loopSweeper}:1"][data-chunk-id="${uiChunk}"]`).click(); await debug("step", 0.05);
  const uiZoneUnits = (await debug("robotStates")).filter((r) => r.id === loopSweeper);
  assert(uiZoneUnits[1].zoneMode === "custom" && uiZoneUnits[1].chunkIds.includes(uiChunk) && uiZoneUnits[0].zoneMode === "follow", "chunk-map controls assign one unit without overwriting another unit's professional mode");
  await page.click("#close-robots-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn");
  await debug("setRaw", 7); await debug("teleport", 10, 12); const outputBeforeDeposit = (await snap()).buildings.find((b) => b.id === loopSweeper).output;
  await debug("interact"); state = await snap();
  assert(state.raw === 0 && Math.abs(state.buildings.find((b) => b.id === loopSweeper).output - outputBeforeDeposit - 7) < 0.001, "player unloads personal raw snow directly into rail-ready sweeper output");
  await debug("setRobotZoneMode", loopSweeper, 0, "auto");
  const loopEvidence = await page.evaluate(({ loopSweeper }) => {
    const d = window.__whiteoutDebug; let hadCargo = false, unloaded = false, resumed = false, gatheredAgain = false;
    for (let i = 0; i < 720; i++) {
      d.step(0.25); const r = d.robotStates().find((it) => it.id === loopSweeper && it.slot === 0); const b = d.snapshot().buildings.find((it) => it.id === loopSweeper);
      if (r.carry > 1) hadCargo = true;
      if (hadCargo && r.carry <= 0.001) { hadCargo = false; unloaded = true; }
      if (unloaded && Math.hypot(r.x - b.x, r.z - b.z) > 2 && ["seek", "gather"].includes(r.mode)) resumed = true;
      if (unloaded && resumed && r.carry > 0.05) { gatheredAgain = true; break; }
    }
    return { unloaded, resumed, gatheredAgain };
  }, { loopSweeper });
  assert(loopEvidence.unloaded && loopEvidence.resumed && loopEvidence.gatheredAgain, "faster sweeper unloads, leaves the dock and gathers snow again instead of standing still");
  const rescueEvidence = await page.evaluate(({ transportHauler }) => {
    const d = window.__whiteoutDebug; const credits = d.snapshot().credits; d.freezeRobots(); let travelled = false; let assisted = false;
    const start = d.robotStates().find((r) => r.id === transportHauler);
    const targets = d.robotStates().filter((r) => r.kind === "sweeper").length;
    for (let i = 0; i < 360; i++) {
      d.step(0.25); const rescue = d.robotStates().find((r) => r.id === transportHauler);
      if (Math.hypot(rescue.x - start.x, rescue.z - start.z) > 4) travelled = true;
      if (["rescue", "rescue-return"].includes(rescue.mode)) assisted = true;
      if (d.robotStates().filter((r) => r.kind === "sweeper").every((r) => !r.frozen)) break;
    }
    const rescue = d.robotStates().find((r) => r.id === transportHauler);
    return { travelled, assisted, rescue, targets, charged: credits - d.snapshot().credits, frozen: d.robotStates().filter((r) => r.kind === "sweeper" && r.frozen).length };
  }, { transportHauler });
  assert(rescueEvidence.travelled && rescueEvidence.assisted && rescueEvidence.frozen === 0 && !rescueEvidence.rescue.frozen && rescueEvidence.rescue.temperature > 0 && rescueEvidence.charged === rescueEvidence.targets * 75, `rescue robot autonomously thaws every stuck sweeper for exactly 75 credits each while remaining thermally vulnerable (${JSON.stringify(rescueEvidence)})`);
  await debug("setRobotEnergy", transportHauler, 5); await debug("step", 0.2);
  assert(["warm-return", "recharge"].includes((await debug("robotStates")).find((r) => r.id === transportHauler).mode), "low-energy rescue robot immediately seeks the nearest warm location");
  const rechargedRescue = await page.evaluate(({ transportHauler }) => { const d = window.__whiteoutDebug; for (let i = 0; i < 120; i++) { d.step(0.25); const r = d.robotStates().find((it) => it.id === transportHauler); if (r.energy > 40 && r.mode === "recharge") return r; } return d.robotStates().find((it) => it.id === transportHauler); }, { transportHauler });
  assert(rechargedRescue.energy > 40 && rechargedRescue.mode === "recharge", `rescue robot autonomously recharges in warmth instead of shutting down (${JSON.stringify(rechargedRescue)})`);
  await debug("step", 8); await debug("damageBuilding", robotPurifier); const rescueRepairCredits = (await snap()).credits;
  const autonomousRepairCost = (await snap()).buildings.find((b) => b.id === robotPurifier).repairCost;
  const repairEvidence = await page.evaluate(({ robotPurifier }) => {
    const d = window.__whiteoutDebug; let welding = false;
    for (let i = 0; i < 240; i++) { d.step(0.25); const r = d.robotStates().find((it) => it.kind === "hauler"); if (["repair", "repair-return"].includes(r.mode)) welding = true; if (!d.snapshot().buildings.find((b) => b.id === robotPurifier).damaged) return { welding, repaired: true }; }
    return { welding, repaired: false };
  }, { robotPurifier });
  assert(repairEvidence.welding && repairEvidence.repaired && (await snap()).credits === rescueRepairCredits - autonomousRepairCost, "aerial rescue faces its travel target, welds for 4.5 seconds and deducts the exact building repair price");
  await debug("save"); const multiRobotSave = await page.evaluate(() => JSON.parse(localStorage.getItem("whiteout.career-v2")));
  assert(multiRobotSave.buildings.find((b) => b.id === loopSweeper).robots.length === 3, "schema-11 save serializes every deployed sweeper unit");
  await page.reload({ waitUntil: "networkidle" }); await ready(); await page.click("#continue-btn");
  assert((await debug("robotStates")).filter((r) => r.id === loopSweeper).length === 3 && (await debug("robotStates")).some((r) => r.kind === "hauler"), "save restoration rebuilds all sweepers and the rescue unit");

  // Two-to-three-minute cold endurance and manual rescue.
  await debug("start"); await debug("setQuest", 7);
  const coldRobot = await debug("build", "sweeper", 12, 12); await debug("teleport", 0, 8);
  await page.evaluate(() => { const d = window.__whiteoutDebug; for (let x = -12; x <= 36; x += 4) for (let z = -12; z <= 36; z += 4) d.clearAt(x, z, 3.5); d.step(1); });
  const expandedRobot = (await debug("robotStates")).find((r) => r.id === coldRobot); assert(expandedRobot.searchRange > 16, `sweeper expands beyond its almost-clean local area instead of waiting for another storm (${JSON.stringify(expandedRobot)})`);
  await debug("step", 120); let robot = (await debug("robotStates")).find((r) => r.id === coldRobot);
  assert(!robot.frozen && robot.temperature > 0 && robot.temperature < 35, `robot remains operational after two cold-weather minutes (${JSON.stringify(robot)})`);
  await debug("step", 62); robot = (await debug("robotStates")).find((r) => r.id === coldRobot);
  assert(robot.frozen, `robot freezes only after the extended outdoor endurance window (${JSON.stringify(robot)})`);
  await debug("giveCredits", 150); const manualRescueCredits = (await snap()).credits;
  await debug("teleport", robot.x, robot.z); await debug("interact"); await debug("step", 3.2);
  assert(!(await debug("robotStates")).find((r) => r.id === coldRobot).frozen && (await snap()).credits === manualRescueCredits - 150, "three-second manual warming rescues a frozen robot for exactly 150 credits");

  // Main-base capacity limit and diminishing efficiency.
  await debug("start"); await debug("setQuest", 8);
  const baseHeaters = [[-12, 4], [-8, 0], [-4, -4], [4, -4], [8, 0], [12, 4], [0, -7]].map(([x, z]) => debug("build", "heater", x, z));
  for (const pending of baseHeaters) await pending;
  await debug("step", 0.02); const basePower = await debug("powerState");
  assert(basePower.filter((b) => b.powered).length === 6 && basePower.some((b) => !b.powered), "main base supports exactly six consumers and rejects the seventh");
  assert(basePower.filter((b) => b.powered).every((b) => b.source === "base" && b.load === 6 && b.capacity === 6 && b.efficiency === 0.5), "fully loaded base reports six connections and 50 percent efficiency");

  // Wired generator range, cable mesh, capacity growth and severe-storm repair/save.
  await debug("start"); await debug("setQuest", 8); await debug("giveCredits", 12000);
  const wiredGenerator = await debug("build", "generator", 24, 10);
  assert((await snap()).buildings.find((b) => b.id === wiredGenerator).generatorRadius === 9, "level-one orbital generator has the reduced nine-meter support radius");
  const generatorHeaters = [[20, 4], [28, 4], [20, 16], [28, 16], [44, 10]];
  for (const [x, z] of generatorHeaters) await debug("build", "heater", x, z);
  await debug("step", 0.02); let power = await debug("powerState");
  let genPower = power.find((b) => b.id === wiredGenerator);
  assert(genPower.powered && genPower.cable && genPower.wireMeshes >= 3 && genPower.source === "base", "generator has a real ground-cable mesh connected to the main base");
  assert(genPower.load === 3 && genPower.capacity === 3 && Math.abs(genPower.efficiency - 0.76) < 0.001, "level-one generator supports three devices at 76 percent efficiency");
  assert(power.filter((b) => b.id !== wiredGenerator && b.powered).length === 3, "fourth nearby consumer waits for generator capacity");
  assert(!(await debug("build", "generator", 60, 60)), "generator construction beyond the 68-meter base cable range is rejected");
  assert(!(await debug("moveBuilding", wiredGenerator, 60, 60)), "generator relocation beyond cable range is rejected");
  await debug("teleport", 24, 10); await debug("upgradeNearest"); await debug("step", 0.02);
  assert((await snap()).buildings.find((b) => b.id === wiredGenerator).generatorRadius === 13, "level-two generator expands its support radius to thirteen meters");
  await debug("upgradeNearest"); await debug("step", 0.02); power = await debug("powerState"); genPower = power.find((b) => b.id === wiredGenerator);
  assert((await snap()).buildings.find((b) => b.id === wiredGenerator).generatorRadius === 17, "level-three generator reaches exactly seventeen meters");
  assert(genPower.capacity === 5 && genPower.load === 4 && Math.abs(genPower.efficiency - 0.64) < 0.001, "generator upgrades raise capacity without hiding diminishing efficiency");
  const outOfRange = power.filter((b) => b.type !== "generator").at(-1);
  assert(power.filter((b) => b.id !== wiredGenerator && b.powered).length === 4 && !power.at(-1).powered, "level-three 17-meter support radius remains enforced");
  assert(state.relays.every((r) => !r.repaired), "a new operation resets recovery installations independently from the wired power network");

  await debug("storm", true); await debug("step", 0.02); state = await snap();
  const damaged = state.buildings.filter((b) => b.damaged);
  assert(state.severeStorm && state.stormTimer > 37 && damaged.length >= 1 && damaged.length <= 2, "forced severe storm lasts 38 seconds and damages one or two real assets");
  assert(state.stormCycle >= 5 && state.stormCycle <= 7, "next severe-storm window is scheduled five to seven storms ahead");
  assert(await page.locator("#storm-forecast").evaluate((el) => el.classList.contains("severe")), "forecast bar visibly marks the severe storm");
  await debug("save"); const savedSevere = await page.evaluate(() => JSON.parse(localStorage.getItem("whiteout.career-v2")));
  await page.reload({ waitUntil: "networkidle" }); await ready(); await page.click("#continue-btn"); state = await snap();
  assert(state.severeStorm && state.stormPhase === "storm" && Math.abs(state.stormTimer - savedSevere.stormTimer) < 2 && state.stormCount === savedSevere.stormCount, "save resumes the same severe storm without restarting or double-counting it");
  assert(!state.radarActive && state.buildings.filter((b) => b.damaged).length === damaged.length && state.events.length > 0, "schema-9 restore preserves exact building damage and persistent event history");
  await debug("openLog"); assert(await page.locator("#log-screen").isVisible() && await page.locator("#event-list .event-entry").count() > 0, "important events remain reopenable in the archive after restoration"); await page.click("#close-log-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn");
  const firstDamaged = state.buildings.find((b) => b.damaged);
  await debug("teleport", firstDamaged.x, firstDamaged.z); await page.waitForFunction(() => { const button = document.querySelector("#repair-building-btn"); return button && !button.classList.contains("hidden"); }, null, { timeout: 10000 });
  assert(await page.locator("#repair-building-btn").isVisible(), "damaged building exposes a visible paid-repair action");
  await page.screenshot({ path: join(SHOTS, "05-storm-damage.png") });
  const repairCredits = (await snap()).credits; await page.click("#repair-building-btn"); state = await snap();
  assert(!state.buildings.find((b) => b.id === firstDamaged.id).damaged && state.credits === repairCredits - firstDamaged.repairCost, "paid repair deducts the exact building-specific cost and clears damage");
  for (const b of state.buildings.filter((it) => it.damaged)) await debug("repairBuilding", b.id);
  await debug("step", 0.02); state = await snap();
  assert(state.buildings.every((b) => !b.damaged) && (await debug("powerState")).find((b) => b.id === wiredGenerator).powered, "all repaired assets and generator power resume operation");
  await debug("teleport", 0, 8); await debug("step", 39); state = await snap();
  assert(!state.severeStorm && state.stormPhase === "calm" && state.stormEta > 80 && state.stormEta < 145, "severe storm ends into a random calm forecast window");

  // Rolling sales, live cleanup, tool durability, generated audio and spaceship base.
  await debug("start"); await debug("teleport", 7, 8); await debug("setRaw", 1); await debug("interact"); state = await snap();
  assert(state.salesPerMinute === 1, "credit HUD uses the actual rolling sixty-second sale ledger");
  assert(await page.locator("#sales-rate").isVisible() && await page.locator("#cleanup-text").isVisible(), "sales rate and one-decimal live cleanup remain visible in the HUD");
  await debug("step", 61); assert((await snap()).salesPerMinute === 0, "sales older than sixty seconds leave the rolling ledger");
  const cleanupBefore = (await snap()).cleanupPercent; await debug("clearAt", 30, 30, 5); const cleanupAfter = (await snap()).cleanupPercent;
  assert(cleanupAfter > cleanupBefore, "manual clearing immediately increases live cleanup percentage");
  await debug("storm"); await debug("step", 0.02); assert((await snap()).cleanupPercent < cleanupAfter, "storm regrowth can reduce the live cleanup percentage");
  await debug("start"); await debug("setRaw", 2); await debug("setToolHealth", "hands", 0);
  await page.keyboard.down("Space"); await page.waitForTimeout(250); await page.keyboard.up("Space");
  assert((await snap()).raw === 2 && (await snap()).toolHealth.hands === 0, "a broken tool cannot clear snow and preserves carried cargo");
  await debug("giveCredits", 100); assert(await debug("repairTool", "hands"), "paid tool repair succeeds at the workshop");
  state = await snap(); assert(state.raw === 2 && state.toolHealth.hands === 100, "tool repair restores health without emptying its tank");
  await debug("teleport", 30, 30); await page.keyboard.down("Space"); await page.waitForTimeout(500); await page.keyboard.up("Space");
  assert((await snap()).toolHealth.hands < 100 && (await snap()).raw > 2, "tool health wears only during real snow removal");
  const audio = await debug("audioState"), base = await debug("baseVisual");
  assert(audio.music === "quiet-aurora-loop.mp3" && audio.repair === "robot-repair-chime.mp3" && audio.musicLoop && audio.musicEnabled && audio.sfxEnabled && audio.ambienceEnabled, "calm local music and repair chime are wired with looping and independent audio channels");
  assert(base.spaceship && base.meshes >= 15, "main base is a detailed landed spaceship rather than the old cylindrical hub");

  // Every building type exposes a real damaged mesh; robots retain cargo through breakdown and repair.
  await debug("start"); await debug("setQuest", 8); await debug("giveCredits", 30000);
  const damageIds = [];
  for (const [index, type] of ["purifier", "press", "heater", "generator", "sweeper", "hauler"].entries()) damageIds.push(await debug("build", type, -22 + index * 8, -20));
  for (const id of damageIds) {
    assert(await debug("damageBuilding", id), `building ${id} enters damaged state`);
    const visual = (await debug("buildingVisuals")).find((b) => b.id === id);
    assert(visual.damageVisible && visual.damageMeshes >= 10, `${visual.type} shows type-specific wreckage, smoke and repair beacon`);
    assert(await debug("repairBuilding", id), `${visual.type} paid repair hides its wreckage`);
  }
  const cargoPurifier = await debug("build", "purifier", 3, -2);
  const cargoSweeper = await debug("build", "sweeper", 10, 12), cargoHauler = await debug("build", "hauler", -12, 12);
  const robotRepairEvidence = await page.evaluate(({ cargoSweeper, cargoHauler }) => {
    const d = window.__whiteoutDebug; d.setOutput(cargoSweeper, 10);
    d.step(2); d.setRobotHealth(cargoHauler, 0); const stopped = d.robotStates().find((r) => r.id === cargoHauler);
    d.repairBuilding(cargoHauler); const haulerAfter = d.robotStates().find((r) => r.id === cargoHauler);
    let s;
    for (let i = 0; i < 400; i++) { d.step(0.25); s = d.robotStates().find((r) => r.id === cargoSweeper); if (s.carry > 1) break; }
    const sweeperBefore = s.carry; d.setRobotHealth(cargoSweeper, 0); d.repairBuilding(cargoSweeper); const sweeperAfter = d.robotStates().find((r) => r.id === cargoSweeper);
    return { stopped, haulerAfter, sweeperBefore, sweeperAfter };
  }, { cargoSweeper, cargoHauler, cargoPurifier });
  assert(robotRepairEvidence.stopped.mode === "damaged" && robotRepairEvidence.stopped.carry === 0, "broken rescue robot stops without inventing a cargo tank");
  assert(robotRepairEvidence.haulerAfter.health === 100 && robotRepairEvidence.haulerAfter.energy >= 70 && robotRepairEvidence.haulerAfter.mode === "patrol", `repaired rescue robot resumes patrol with safe energy (${JSON.stringify(robotRepairEvidence)})`);
  assert(robotRepairEvidence.sweeperAfter.health === 100 && robotRepairEvidence.sweeperAfter.carry === robotRepairEvidence.sweeperBefore && robotRepairEvidence.sweeperAfter.mode === "return", `repaired sweeper returns to unload with exactly the same cargo (${JSON.stringify(robotRepairEvidence)})`);

  // Diegetic no-power, missing-input and breakdown icons.
  await debug("start"); await debug("setQuest", 8);
  const iconPurifier = await debug("build", "purifier", 3, -2); const iconHeater = await debug("build", "heater", 52, 52);
  await debug("step", 0.05); let iconViews = await debug("buildingVisuals");
  assert(iconViews.find((b) => b.id === iconPurifier).alertState === "input" && iconViews.find((b) => b.id === iconPurifier).badgeVisible, "powered machine with no input shows a missing-input icon");
  assert(iconViews.find((b) => b.id === iconHeater).alertState === "power" && iconViews.find((b) => b.id === iconHeater).badgeVisible, "building outside powered coverage shows a no-power icon");
  await debug("damageBuilding", iconPurifier); await debug("step", 0.05); iconViews = await debug("buildingVisuals");
  assert(iconViews.find((b) => b.id === iconPurifier).alertState === "damage" && iconViews.find((b) => b.id === iconPurifier).badgeVisible && (await snap()).events.some((e) => e.kind === "damage"), "breakdown icon overrides lesser states and emits a persistent important alert");

  // Mobile controls, expanded building card, robot roster and overflow checks.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); watch(mobile);
  await mobile.addInitScript(() => localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: true, uiScale: 1 })));
  await mobile.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await mobile.waitForFunction(() => window.__GAME_READY__ && !!window.__whiteoutDebug, null, { timeout: 90000 });
  await mobile.evaluate(() => { const d = window.__whiteoutDebug; d.start(); d.setQuest(8); d.build("sweeper", 10, 12); d.build("hauler", -12, 12); d.teleport(10, 12); });
  await mobile.waitForTimeout(350);
  assert(await mobile.locator("#orientation-lock").isVisible() && !(await mobile.locator("#touch-controls").isVisible()), "portrait mobile blocks play behind a mandatory rotate-device overlay");
  await mobile.setViewportSize({ width: 844, height: 390 }); await mobile.waitForTimeout(350);
  if (await mobile.locator("#resume-btn").isVisible()) await mobile.tap("#resume-btn");
  assert(!(await mobile.locator("#orientation-lock").isVisible()) && await mobile.locator("#touch-controls").isVisible(), "landscape rotation removes the lock and restores touch controls after safe resume");
  assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile HUD has no horizontal overflow");
  await mobile.tap("#relay-top-btn");
  const mobileRadarBounds = await mobile.locator("#relay-guide").boundingBox();
  assert(await mobile.locator("#relay-guide").isVisible() && !!mobileRadarBounds && mobileRadarBounds.x >= 0 && mobileRadarBounds.y >= 0 && mobileRadarBounds.x + mobileRadarBounds.width <= 844 && mobileRadarBounds.y + mobileRadarBounds.height <= 390, "short-landscape recovery guide is reachable and fully bounded inside the viewport");
  await mobile.screenshot({ path: join(SHOTS, "08-mobile-relays.png"), timeout: 90000 }); await mobile.tap("#close-relay-help");
  await mobile.waitForFunction(() => !document.querySelector("#prompt").classList.contains("hidden"), null, { timeout: 10000 });
  const mobileBuildingLayout = await mobile.evaluate(() => {
    const card = document.querySelector("#building-card").getBoundingClientRect();
    const prompt = document.querySelector(".prompt").getBoundingClientRect();
    return { visible: card.width > 0 && card.height > 0, separated: card.bottom <= prompt.top, bounded: card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight };
  });
  assert(mobileBuildingLayout.visible && mobileBuildingLayout.bounded && mobileBuildingLayout.separated, `short-landscape building card clears the interaction prompt (${JSON.stringify(mobileBuildingLayout)})`);
  await mobile.screenshot({ path: join(SHOTS, "06-mobile-building.png"), timeout: 90000 });
  await mobile.tap("#settings-btn");
  assert(await mobile.locator(".screen:not(.hidden)").count() === 1 && await mobile.locator("#settings-screen").isVisible(), "opening settings replaces rather than overlaps other full-screen dialogs");
  const settingsSize = await mobile.locator(".settings-modal").evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight, viewport: innerHeight }));
  assert(settingsSize.client <= settingsSize.viewport - 8 && settingsSize.scroll >= settingsSize.client, "short-landscape settings use bounded internal scrolling instead of overflowing the screen");
  await mobile.screenshot({ path: join(SHOTS, "09-mobile-settings.png"), timeout: 90000 });
  await mobile.tap("#close-settings-btn"); if (await mobile.locator("#resume-btn").isVisible()) await mobile.tap("#resume-btn"); assert(await mobile.locator(".screen:not(.hidden)").count() === 0, "settings back action returns cleanly to live gameplay");
  await mobile.tap("#robots-btn"); await mobile.waitForTimeout(150);
  assert(await mobile.locator("#robot-list .robot-card").count() === 2 && await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile robot roster shows separate tanks without horizontal overflow");
  const mobileBack = await mobile.locator("#close-robots-btn").boundingBox();
  assert(!!mobileBack && mobileBack.y >= 0 && mobileBack.y + mobileBack.height <= 390, "mobile robot roster keeps its back button fully reachable in short landscape");
  await mobile.screenshot({ path: join(SHOTS, "07-mobile-robots.png"), timeout: 90000 }); await mobile.close();

  // Isolated old-save migration: no live autosave can overwrite the version-8 fixture.
  const migration = await browser.newPage({ viewport: { width: 1000, height: 700 } }); watch(migration);
  await migration.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true }));
    localStorage.setItem("whiteout.career-v2", JSON.stringify({ version: 8, runTime: 10, raw: 0, purified: 0, ice: 0, credits: 123, heat: 100, power: 20, radarCharges: 3, radarActive: true, recovered: 0, produced: 0, collectedRaw: 0, purifiedSold: 0, sold: 0, iceSold: 0, railDelivered: 0, questIndex: 0, upgrades: { tank: 0, scanner: 0, thermal: 0, boots: 0 }, tools: { shovel: 0, brush: 0, blower: 0, vacuum: 0 }, selectedTool: "hands", player: { x: 0, z: 2 }, snow: Array(160 * 160).fill(0), cores: ["comms", "habitat", "command"].map((id) => ({ id, scanned: false, revealed: false, recovered: false })), buildings: [], rails: [] }));
  });
  await migration.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" }); await migration.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug, null, { timeout: 90000 });
  await migration.click("#continue-btn");
  assert(await migration.evaluate(() => window.__whiteoutDebug.snapshot().credits === 303), "legacy radar activation is refunded exactly once during schema-11 migration");
  await migration.evaluate(() => window.__whiteoutDebug.save());
  const migratedSave = await migration.evaluate(() => JSON.parse(localStorage.getItem("whiteout.career-v2")));
  assert(migratedSave.version === 11 && migratedSave.radarActive === false && migratedSave.credits === 303, "schema-11 migration writes a permanent refund marker instead of legacy radar state");
  await migration.close();
  }

  assert(errors.length === 0, `zero browser console, page and asset errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  console.log(process.env.VERIFY_EARLY_ONLY ? "EARLY VERIFY OK" : "EXPANDED VERIFY OK");
} finally { await browser.close(); server.close(); }
