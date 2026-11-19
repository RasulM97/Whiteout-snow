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
const assert = (value, message) => { if (!value) throw new Error(message); console.log("PASS:", message); };

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1, musicEnabled: false, sfxEnabled: false, ambienceEnabled: false }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  const debug = (method, ...args) => page.evaluate(({ method, args }) => window.__whiteoutDebug[method](...args), { method, args });

  const goal = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start();
    d.teleport(0, 10);
    d.setQuest(9);
    d.step(0.05);
    const opened = d.snapshot();
    const text = document.querySelector("#quest-desc").textContent;
    d.clearAt(0, 10, 6);
    d.step(0.05);
    const partial = d.snapshot();
    d.clearAt(0, 0, 220);
    d.step(0.05);
    const full = d.snapshot();
    d.setPower(40);
    d.step(0.05);
    const lowPower = d.snapshot();
    d.storm(true);
    d.step(1);
    const afterStorm = d.snapshot();
    return {
      text, opened: { certified: opened.cleanupCertified, cleanup: opened.cleanupPercent, state: opened.state },
      partial: { certified: partial.cleanupCertified, cleanup: partial.cleanupPercent },
      full: { certified: full.cleanupCertified, cleanup: full.cleanupPercent, state: full.state, cores: full.cores, power: full.power },
      lowPower: { certified: lowPower.cleanupCertified, state: lowPower.state, power: lowPower.power },
      afterStorm: { certified: afterStorm.cleanupCertified, cleanup: afterStorm.cleanupPercent, state: afterStorm.state },
    };
  });
  assert(goal.text.includes("95%") && !goal.text.includes("98%"), `mission text states 95% clearance (${goal.text.slice(0, 180)})`);
  assert(goal.text.includes("100%"), "uplink requirement stays in the mission text");
  assert(!goal.opened.certified && goal.opened.cleanup < 95 && goal.opened.state === "playing", `a fresh map is not certified (${JSON.stringify(goal.opened)})`);
  assert(!goal.partial.certified && goal.partial.cleanup < 95, `a small clearing stays under the line (${JSON.stringify(goal.partial)})`);
  assert(goal.full.certified && goal.full.cleanup >= 95 && goal.full.state === "playing" && goal.full.cores < 3, `95% certifies without granting cores or victory (${JSON.stringify(goal.full)})`);
  assert(goal.lowPower.certified && goal.lowPower.state === "playing" && goal.lowPower.power < 99, `power is still required for victory (${JSON.stringify(goal.lowPower)})`);
  assert(goal.afterStorm.certified && goal.afterStorm.cleanup < goal.full.cleanup && goal.afterStorm.state === "playing", `a storm does not revoke a 95% certificate (${JSON.stringify(goal.afterStorm)})`);

  await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start();
    d.pause();
    const save = JSON.parse(localStorage.getItem("whiteout.career-v2"));
    if (save.version !== 11 || save.cleanupCertified !== false) throw new Error(`save schema drifted ${save.version} ${save.cleanupCertified}`);
    save.cleanupCertified = true;
    localStorage.setItem("whiteout.career-v2", JSON.stringify(save));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  await page.waitForSelector("#continue-btn:not(.hidden)");
  await page.click("#continue-btn");
  await page.waitForFunction(() => window.__whiteoutDebug.snapshot().state === "playing");
  const kept = await page.evaluate(() => {
    const s = window.__whiteoutDebug.snapshot();
    return { certified: s.cleanupCertified, cleanup: s.cleanupPercent, state: s.state, quest: s.quest.index, version: JSON.parse(localStorage.getItem("whiteout.career-v2")).version };
  });
  assert(kept.certified && kept.cleanup < 95 && kept.state === "playing" && kept.quest === 0 && kept.version === 11, `an older certificate stays valid below 95% and does not skip the other goals (${JSON.stringify(kept)})`);

  await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.pause();
    const save = JSON.parse(localStorage.getItem("whiteout.career-v2"));
    save.cleanupCertified = true;
    save.questIndex = 9;
    save.power = 100;
    save.recovered = 3;
    save.status = "playing";
    localStorage.setItem("whiteout.career-v2", JSON.stringify(save));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ && window.__whiteoutDebug);
  await page.waitForSelector("#continue-btn:not(.hidden)");
  await page.click("#continue-btn");
  await page.waitForFunction(() => window.__whiteoutDebug.snapshot().state === "victory", null, { timeout: 10000 });
  const priorWin = await debug("snapshot");
  assert(priorWin.state === "victory" && priorWin.cleanupCertified && priorWin.cleanupPercent < 95 && priorWin.cores === 3 && priorWin.power >= 99, `a saved certificate still completes victory with the other requirements (${JSON.stringify({ state: priorWin.state, cleanup: priorWin.cleanupPercent, cores: priorWin.cores, power: priorWin.power })})`);

  const thermal = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    const dist = (robot) => Math.hypot(robot.x, robot.z - 10);
    d.start();
    d.teleport(0, 10);
    d.giveCredits(8000);
    const id = d.build("sweeper", 6, 14);
    d.placeRobot(id, 0, 18, 10);
    d.setRobotTemperature(id, 0, 16, false);
    d.setRobotCarry(id, 0, 24);
    const departed = d.robotStates().find((robot) => robot.id === id);
    d.step(2);
    const cargo = d.robotStates().find((robot) => robot.id === id);
    d.storm(true);
    d.step(0.4);
    for (const building of d.snapshot().buildings) if (building.damaged) d.repairBuilding(building.id);
    d.placeRobot(id, 0, 16, 10);
    d.setRobotTemperature(id, 0, 18, false);
    d.setRobotCarry(id, 0, 0);
    d.step(6);
    const sheltered = d.robotStates().find((robot) => robot.id === id);
    const phase = d.snapshot();
    d.step(8);
    const throughStorm = d.robotStates().find((robot) => robot.id === id);
    const stormState = d.snapshot();
    d.placeRobot(id, 0, 58, -48);
    d.setRobotTemperature(id, 0, 20, false);
    d.setRobotCarry(id, 0, 0);
    const exposedStart = d.robotStates().find((robot) => robot.id === id);
    d.step(12);
    const exposed = d.robotStates().find((robot) => robot.id === id);
    const exposure = d.freezeLog().filter((event) => event.id === id);
    const credits = d.snapshot().credits;
    d.placeRobot(id, 0, 30, 30);
    d.setRobotTemperature(id, 0, 0, true);
    d.teleport(30, 30);
    const rescue = d.rescueAt(30, 30);
    const spent = credits - d.snapshot().credits;
    d.step(3.4);
    const thawed = d.robotStates().find((robot) => robot.id === id);
    return {
      cargo: { before: dist(departed), after: dist(cargo), carry: cargo.carry, mode: cargo.mode, returning: cargo.returning, frozen: cargo.frozen },
      sheltered: { dist: dist(sheltered), mode: sheltered.mode, frozen: sheltered.frozen, temp: sheltered.temperature, phase: phase.stormPhase },
      throughStorm: { dist: dist(throughStorm), mode: throughStorm.mode, frozen: throughStorm.frozen, temp: throughStorm.temperature, phase: stormState.stormPhase, severe: stormState.severeStorm },
      exposed: { start: dist(exposedStart), end: dist(exposed), frozen: exposed.frozen, mode: exposed.mode, temp: exposed.temperature },
      exposure: exposure.map((event) => ({ mode: event.mode, gap: Number(event.gap.toFixed(1)), storm: Number(event.storm.toFixed(2)), returning: event.returning, x: Number(event.x.toFixed(1)), z: Number(event.z.toFixed(1)) })),
      rescue, spent, thawed: { frozen: thawed.frozen, temp: thawed.temperature },
    };
  });
  assert(thermal.cargo.after < thermal.cargo.before - 1 && thermal.cargo.carry > 20 && !thermal.cargo.frozen && (thermal.cargo.mode === "warm-return" || thermal.cargo.mode === "recharge"), `a full tank does not block the walk to heat (${JSON.stringify(thermal.cargo)})`);
  assert(!thermal.sheltered.frozen && thermal.sheltered.dist < 10 && (thermal.sheltered.mode === "recharge" || thermal.sheltered.mode === "warm-return"), `a cold sweeper reaches heat during the warning (${JSON.stringify(thermal.sheltered)})`);
  assert(!thermal.throughStorm.frozen && thermal.throughStorm.dist < 11 && thermal.throughStorm.phase === "storm" && thermal.throughStorm.severe, `a sweeper that reached heat stays there through the severe storm (${JSON.stringify(thermal.throughStorm)})`);
  assert(thermal.exposed.frozen && thermal.exposed.end > 20 && thermal.exposure.length > 0 && thermal.exposure[0].gap > 20 && thermal.exposure[0].storm > 1 && thermal.exposure[0].mode !== "recharge", `an exposed sweeper still freezes outside heat in the severe storm (${JSON.stringify({ exposed: thermal.exposed, exposure: thermal.exposure[0] })})`);
  assert(thermal.rescue === "started" && thermal.spent === 150 && !thermal.thawed.frozen && thermal.thawed.temp > 50, `manual rescue still costs 150 and thaws the robot (${JSON.stringify({ rescue: thermal.rescue, spent: thermal.spent, thawed: thermal.thawed })})`);

  const warning = await page.evaluate(() => {
    const d = window.__whiteoutDebug;
    d.start();
    d.teleport(0, 10);
    d.step(137);
    const before = d.snapshot();
    d.step(2);
    const warned = d.snapshot();
    d.step(Math.max(0, warned.stormTimer) + 0.3);
    const active = d.snapshot();
    return { before: before.stormPhase, warned: { phase: warned.stormPhase, timer: warned.stormTimer }, active: active.stormPhase };
  });
  assert(warning.before === "calm" && warning.warned.phase === "warning" && warning.warned.timer > 8 && warning.active === "storm", `the storm warning still leads the storm by more than 8 seconds (${JSON.stringify(warning)})`);

  await page.keyboard.down("ControlLeft");
  await page.waitForFunction(() => document.querySelector("#ui-overlay").classList.contains("details-expanded"));
  const desktopCtrl = await page.evaluate(() => ({
    expanded: document.querySelector("#ui-overlay").classList.contains("details-expanded"),
    hintHidden: document.querySelector("#ctrl-hint").classList.contains("hidden"),
  }));
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(500);
  const moving = (await debug("visualState")).character;
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ControlLeft");
  await page.waitForFunction(() => !document.querySelector("#ui-overlay").classList.contains("details-expanded"));
  assert(desktopCtrl.expanded && desktopCtrl.hintHidden && (moving === "walk" || moving === "run"), `Ctrl still expands the HUD class, stays quiet on a tall screen, and does not block movement (${JSON.stringify({ ...desktopCtrl, moving })})`);

  await page.setViewportSize({ width: 1280, height: 500 });
  await page.waitForTimeout(300);
  const compact = await page.evaluate(() => getComputedStyle(document.querySelector("#quest-desc")).display);
  await page.keyboard.down("ControlLeft");
  await page.waitForTimeout(300);
  const revealed = await page.evaluate(() => ({
    display: getComputedStyle(document.querySelector("#quest-desc")).display,
    hintHidden: document.querySelector("#ctrl-hint").classList.contains("hidden"),
  }));
  await page.keyboard.up("ControlLeft");
  assert(compact !== "none" && revealed.display !== "none" && !revealed.hintHidden, `on a short landscape screen the mission stays readable and Ctrl still shows the control hint (${JSON.stringify({ compact, revealed })})`);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => { window.__whiteoutDebug.setQuest(9); window.__whiteoutDebug.step(0.05); });
  await page.click("#settings-btn");
  await page.selectOption("#set-language", "fa");
  const persian = await page.locator("#quest-desc").innerText();
  await page.selectOption("#set-language", "zh");
  const chinese = await page.locator("#quest-desc").innerText();
  await page.selectOption("#set-language", "en");
  assert(persian.includes("۹۵٪") && !persian.includes("۹۸"), `Persian mission text uses 95% (${persian.slice(0, 80)})`);
  assert(chinese.includes("95%") && !chinese.includes("98%"), `Chinese mission text uses 95% (${chinese.slice(0, 80)})`);

  assert(errors.length === 0, `no page errors ${errors.join(" | ")}`);
  console.log("BATCH4 VERIFY OK");
} finally {
  await browser.close();
  server.close();
}
