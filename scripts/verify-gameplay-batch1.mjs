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
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log("PASS:", message); };

async function openGame() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
    if (!sessionStorage.getItem("batch1-keep")) { localStorage.removeItem("whiteout.career-v2"); sessionStorage.setItem("batch1-keep", "1"); }
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug, null, { timeout: 30000 });
  const debug = (expression, ...args) => page.evaluate(({ expression, args }) => {
    let target = window.__whiteoutDebug;
    for (const part of expression.split(".")) target = target[part];
    return typeof target === "function" ? target(...args) : target;
  }, { expression, args });
  return { page, debug };
}

try {
  const { page, debug } = await openGame();
  await debug("start");
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true })));
  let raw = 0;
  for (let i = 0; i < 14 && raw < 5; i++) {
    await debug("teleport", Math.sin(i) * 5, -7 - (i % 4));
    await debug("step", 0.7);
    raw = (await debug("snapshot")).raw;
  }
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " ", bubbles: true })));
  assert(raw >= 4.9, `fresh career fills the starting tank (${raw})`);
  await debug("teleport", 7, 8);
  await debug("interact");
  const sold = await debug("snapshot");
  assert(sold.quest.index === 1 && sold.rawSold >= 4.9 && sold.credits < 120 && sold.credits > 80, `first manual sale opens the purifier quest below its 120-credit price (${JSON.stringify({ credits: sold.credits, rawSold: sold.rawSold, quest: sold.quest.index })})`);
  const broke = sold.objective;
  assert(broke.key === "objective.snowFund" && (await debug("snowAt", broke.x, broke.z)) >= 0.22, `unaffordable purifier guides to dense snow (${JSON.stringify(broke)})`);
  await debug("clearAt", broke.x, broke.z, 6);
  const moved = (await debug("snapshot")).objective;
  assert(moved.key === "objective.snowFund" && Math.hypot(moved.x - broke.x, moved.z - broke.z) > 3 && (await debug("snowAt", moved.x, moved.z)) >= 0.22, `depleted snow is not used as the guide (${JSON.stringify({ broke, moved, density: await debug("snowAt", moved.x, moved.z) })})`);
  await debug("giveCredits", 120 - sold.credits);
  const funded = (await debug("snapshot")).objective;
  assert(funded.key === "objective.purifierBuild" && Math.hypot(funded.x - 3, funded.z + 2) < 0.1, `affordable purifier restores the build site (${JSON.stringify(funded)})`);
  assert(((await page.locator("[data-building-cost='purifier']").textContent()) || "").includes("120"), "purifier price label reads 120");
  const beforeBuy = (await debug("snapshot")).credits;
  const purifier = await debug("buyBuilding", "purifier", 3, -2);
  const bought = await debug("snapshot");
  assert(purifier && beforeBuy - bought.credits === 40 && bought.quest.index === 2, `buying the purifier charges 120 and pays the 80 quest reward (${JSON.stringify({ purifier, net: beforeBuy - bought.credits, quest: bought.quest.index })})`);

  await debug("giveCredits", 45 - bought.credits);
  const shovelBefore = (await debug("snapshot")).credits;
  await debug("buyTool", "shovel");
  assert(shovelBefore - (await debug("snapshot")).credits === 45, "shovel price stays 45");
  await debug("giveCredits", 480);
  const pressBefore = (await debug("snapshot")).credits;
  const press = await debug("buyBuilding", "press", -3, -3);
  assert(press && pressBefore - (await debug("snapshot")).credits === 480, "ice press price stays 480");

  await debug("setQuest", 7);
  await debug("giveCredits", 780);
  const sweeperBefore = (await debug("snapshot")).credits;
  const sweeper = await debug("buyBuilding", "sweeper", 8, -6);
  assert(sweeper && sweeperBefore - (await debug("snapshot")).credits === 780, "first sweeper dock is purchased at the quest site");
  const capacity = (await debug("logistics")).buildings.find((building) => building.id === sweeper).outputCapacity;
  await debug("setOutput", sweeper, capacity);
  await debug("setRobotCarry", sweeper, 0, 8);
  await debug("setRobotTemperature", sweeper, 0, 28, false);
  const beforeRetreat = (await debug("robotStates")).find((robot) => robot.id === sweeper);
  await debug("step", 2);
  const retreating = (await debug("robotStates")).find((robot) => robot.id === sweeper);
  const dock = (await debug("logistics")).buildings.find((building) => building.id === sweeper);
  assert((retreating.mode === "warm-return" || retreating.mode === "recharge") && retreating.carry >= 7.5 && dock.output >= capacity - 0.01 && !retreating.frozen, `full dock still retreats below 30 degrees and keeps cargo (${JSON.stringify({ before: beforeRetreat, retreating, output: dock.output })})`);
  let recovered = retreating;
  for (let i = 0; i < 20 && !(recovered.temperature >= 62 && recovered.mode !== "warm-return" && recovered.mode !== "recharge"); i++) {
    await debug("step", 0.5);
    recovered = (await debug("robotStates")).find((robot) => robot.id === sweeper);
  }
  assert(recovered.temperature >= 62 && recovered.mode !== "warm-return" && recovered.mode !== "recharge" && recovered.carry >= 7.5 && !recovered.frozen, `sweeper resumes with its cargo after warming (${JSON.stringify(recovered)})`);
  const modes = [];
  for (let i = 0; i < 8; i++) {
    await debug("step", 0.5);
    modes.push((await debug("robotStates")).find((robot) => robot.id === sweeper).mode);
  }
  assert(!modes.includes("warm-return") && !modes.includes("recharge"), `recovery does not immediately retreat again (${modes.join(",")})`);

  await debug("setQuest", 8);
  await debug("build", "hauler", -12, 12);
  const sites = await debug("heaterSites");
  const heaters = [];
  for (const site of sites) heaters.push(await debug("build", "heater", site.x, site.z));
  const powered = (await debug("powerState")).filter((building) => heaters.includes(building.id) && building.powered);
  const mission = await debug("snapshot");
  assert(powered.length < 4 && mission.quest.index === 8 && mission.quest.progress === powered.length, `mission 8 counts only powered heaters (${JSON.stringify({ powered: powered.length, progress: mission.quest.progress, index: mission.quest.index })})`);
  const sixth = await debug("powerPreview", "heater", 0, 16);
  const blockedCredits = (await debug("snapshot")).credits;
  const rejected = await debug("buyBuilding", "heater", 0, 16);
  const hintPage = await debug("selectBuild", "heater");
  await page.mouse.move(640, 400);
  await debug("step", 0.2);
  const hint = await page.locator("#build-hint").innerText();
  await page.keyboard.press("Escape");
  assert(!rejected && (await debug("snapshot")).credits === blockedCredits && sixth && !sixth.connected, `a placement without a free connection is refused and does not charge (${JSON.stringify({ sixth, rejected, hint })})`);
  assert(/connection|Power|efficiency|%|\/6/i.test(hint), `construction hint explains the power result (${hint})`);
  const guide = (await debug("snapshot")).objective;
  assert(guide.key === "objective.generator", `a full power network guides toward a generator (${JSON.stringify(guide)})`);
  const generatorCredits = (await debug("snapshot")).credits;
  await debug("giveCredits", Math.max(0, 520 - generatorCredits));
  const generator = await debug("buyBuilding", "generator", guide.x, guide.z);
  assert(generator && (await debug("snapshot")).credits === Math.max(generatorCredits, 520) - 520, "a generator can still be built when every current connection is full");
  await debug("step", 0.2);
  const afterGenerator = await debug("snapshot");
  assert(afterGenerator.quest.index === 8 && afterGenerator.objective.key === "objective.heater", `spare generator capacity guides a heater into range (${JSON.stringify(afterGenerator.objective)})`);
  const dark = (await debug("powerState")).find((building) => heaters.includes(building.id) && !building.powered);
  assert(await debug("moveBuilding", dark.id, afterGenerator.objective.x, afterGenerator.objective.z), "an unpowered heater can move onto the new connection");
  await debug("step", 0.2);
  const finished = await debug("snapshot");
  const poweredAfter = (await debug("powerState")).filter((building) => heaters.includes(building.id) && building.powered).length;
  assert(finished.quest.index === 9 && poweredAfter >= 4, `four powered heaters complete mission 8 (${JSON.stringify({ quest: finished.quest.index, poweredAfter })})`);

  const savedQuest = finished.quest.index;
  const savedCredits = finished.credits;
  await debug("save");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  await page.click("#continue-btn");
  await page.waitForFunction(() => window.__whiteoutDebug.snapshot().state === "playing");
  const restored = await page.evaluate(() => window.__whiteoutDebug.snapshot());
  assert(restored.quest.index === savedQuest && restored.quest.index === 9 && restored.credits === savedCredits, `an advanced save keeps quest ${savedQuest} and credits ${savedCredits}`);

  await debug("start");
  const isolated = await debug("build", "sweeper", 58, 50);
  await debug("setRobotTemperature", isolated, 0, 4, false);
  let sawRetreat = false;
  for (let i = 0; i < 8; i++) {
    await debug("step", 1);
    const robot = (await debug("robotStates")).find((unit) => unit.id === isolated);
    if (robot.mode === "warm-return" || robot.mode === "recharge") sawRetreat = true;
    if (robot.frozen) break;
  }
  const cold = (await debug("robotStates")).find((unit) => unit.id === isolated);
  assert(!sawRetreat && cold.frozen && cold.temperature <= 0, `unreachable heat still freezes the sweeper (${JSON.stringify(cold)})`);
  const rescueDock = await debug("build", "sweeper", 24, 24);
  await debug("freezeRobot", rescueDock, 0);
  await debug("step", 3);
  const stillFrozen = (await debug("robotStates")).find((unit) => unit.id === rescueDock);
  assert(stillFrozen.frozen, "a frozen sweeper outside heat does not recover by itself");
  await debug("giveCredits", 200);
  const rescueCredits = (await debug("snapshot")).credits;
  const hauler = await debug("build", "hauler", 4, 16);
  let spent = false;
  for (let i = 0; i < 24; i++) {
    await debug("step", 1);
    const robot = (await debug("robotStates")).find((unit) => unit.id === rescueDock);
    if (!robot.frozen) { spent = rescueCredits - (await debug("snapshot")).credits; break; }
  }
  assert(hauler && spent === 75, `rescue drone still performs the paid thaw (${JSON.stringify({ hauler, spent })})`);

  await debug("start");
  for (let i = 0; i < 5; i++) await debug("build", "heater", -6 + i * 3, 8);
  const open = await debug("powerPreview", "heater", 10, 8);
  const closedCredits = (await debug("snapshot")).credits;
  await debug("giveCredits", 300 - closedCredits);
  const sixthId = await debug("buyBuilding", "heater", 10, 8);
  const afterSixth = await debug("powerPreview", "heater", 12, 14);
  const seventhCredits = (await debug("snapshot")).credits;
  const seventh = await debug("buyBuilding", "heater", 12, 14);
  assert(open.connected && open.load === 6 && open.capacity === 6 && Math.abs(open.efficiency - 0.5) < 0.001, `the sixth connection is offered at 50 percent efficiency (${JSON.stringify(open)})`);
  const refusedCredits = (await debug("snapshot")).credits;
  assert(sixthId && !afterSixth.connected && afterSixth.networkFull && !seventh && refusedCredits === seventhCredits, `the seventh connection is refused without a charge (${JSON.stringify({ afterSixth, seventh, credits: refusedCredits })})`);

  if (errors.length) throw new Error(errors.join("\n"));
  console.log("GAMEPLAY BATCH 1: PASS");
} finally {
  await browser.close();
  server.close();
}
