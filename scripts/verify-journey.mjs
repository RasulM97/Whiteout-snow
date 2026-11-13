import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const SHOTS = join(ROOT, "verification-journey");
mkdirSync(SHOTS, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".mp3": "audio/mpeg" };
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
  try { browser = await chromium.launch({headless:!process.env.DISPLAY, executablePath, args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-angle=swiftshader","--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] }); break; } catch { /* next */ }
}
if (!browser) { server.close(); throw new Error("No usable Chromium browser found"); }
const errors = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log("PASS:", message); };
const watch = (page) => {
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() === 404) errors.push(`404 ${r.url()}`); });
};
const ready = async (page) => {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__GAME_READY__ && !!window.__whiteoutDebug, null, { timeout: 90000 });
};
const debug = (page, expression, ...args) => page.evaluate(({ expression, args }) => {
  const parts = expression.split("."); let target = window.__whiteoutDebug;
  for (const part of parts) target = target[part];
  return typeof target === "function" ? target(...args) : target;
}, { expression, args });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage(); page.setDefaultTimeout(30000); watch(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("journey-initialized")) return;
    sessionStorage.setItem("journey-initialized", "1");
    localStorage.clear();
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0.35, musicTrack: "quiet-aurora", musicEnabled: true, musicVolume: 0.55, sfxEnabled: true, sfxVolume: 0.7, ambienceEnabled: true, ambienceVolume: 0.55, cameraShake: true, particles: true, uiScale: 1 }));
  });
  await ready(page);
  await page.screenshot({ path: join(SHOTS, "01-title.png") });
  await page.click("#start-btn");
  assert((await debug(page, "snapshot")).cinematic.active, "real New Operation click starts the landing cinematic");
  await page.waitForTimeout(900);
  const firstCue = await page.locator("#cinematic-subtitle").innerText();
  assert(firstCue.trim().length > 10 && await page.locator("#skip-cinematic").isVisible(), "opening shows live subtitles and a visible skip control");
  await page.screenshot({ path: join(SHOTS, "02-cinematic-descent.png") });
  await page.waitForTimeout(4700);
  const landedAudio = await debug(page, "audioState");
  assert((landedAudio.emitted.landing ?? 0) === 1 && (await debug(page, "snapshot")).cinematic.time >= 4.6, "landing emits its synthesized sound exactly once");
  await page.screenshot({ path: join(SHOTS, "03-cinematic-landing.png") });
  await page.waitForTimeout(4100);
  assert((await page.locator("#cinematic-subtitle").innerText()) !== firstCue, "subtitle cues advance with the arrival sequence");
  await page.screenshot({ path: join(SHOTS, "04-cinematic-walkout.png") });
  await page.waitForFunction(() => document.querySelector("#opening-cinematic")?.classList.contains("hidden"), null, { timeout: 15000 });
  await page.waitForSelector("#interface-tutorial:not(.hidden)");
  const arrival = await debug(page, "snapshot");
  assert(!arrival.cinematic.active && arrival.tutorial.active && arrival.tutorial.step === 0 && arrival.runTime < 0.2, "full cinematic restores gameplay and opens the independent interface tutorial without advancing survival time");
  await page.screenshot({ path: join(SHOTS, "05-tutorial-survival.png") });
  await page.click("#tutorial-next");
  assert((await debug(page, "snapshot")).tutorial.id === "quest", "tutorial Next advances exactly one step");
  await page.click("#tutorial-back");
  assert((await debug(page, "snapshot")).tutorial.id === "survival", "tutorial Back returns to the previous step");
  await page.click("#tutorial-next");
  await page.keyboard.press("Enter"); // Focused Next button: native activation, no global double-action.
  assert((await debug(page, "snapshot")).tutorial.id === "tools", "Enter on a focused tutorial button advances once without double-firing");
  await page.click("#tutorial-skip");
  const tutorialSaved = await page.evaluate(() => JSON.parse(localStorage.getItem("whiteout.interface-tutorial.v1")));
  assert(tutorialSaved.complete && tutorialSaved.version === 1 && !(await debug(page, "snapshot")).tutorial.active, "skipping tutorial persists completion and restores play");

  const beforeW = await page.evaluate(() => window.__gameProbe());
  await page.keyboard.down("KeyW"); await page.waitForTimeout(550); await page.keyboard.up("KeyW");
  const afterW = await page.evaluate(() => window.__gameProbe());
  assert(afterW.z < beforeW.z - 0.1, "real W input moves the character forward after the opening");
  const beforeSprint = await page.evaluate(() => window.__gameProbe());
  await page.keyboard.down("ShiftLeft"); await page.keyboard.down("KeyD"); await page.waitForTimeout(650); await page.keyboard.up("KeyD"); await page.keyboard.up("ShiftLeft");
  const afterSprint = await page.evaluate(() => window.__gameProbe());
  assert(afterSprint.x > beforeSprint.x + 0.2 && (await debug(page, "snapshot")).heat < 100, "real Shift+D movement sprints and uses the survival simulation");
  await debug(page, "setRaw", 0); await debug(page, "setCarried", 0, 0);
  await page.keyboard.down("Space");
  await page.waitForFunction(() => window.__whiteoutDebug.snapshot().raw > 0, null, { timeout: 10000 });
  await page.keyboard.up("Space");
  await page.waitForFunction(() => window.__whiteoutDebug.visualState().character !== "work", null, { timeout: 5000 });
  assert((await debug(page, "snapshot")).raw > 0 && (await debug(page, "visualState")).character !== "work", "holding and releasing Space gathers real snow and exits the work pose");
  await debug(page, "setRaw", 0);
  await page.mouse.move(640, 390); await page.mouse.down();
  await page.waitForFunction(() => window.__whiteoutDebug.snapshot().raw > 0, null, { timeout: 10000 });
  await page.mouse.up();
  assert((await debug(page, "snapshot")).raw > 0, "holding the real left mouse button clears snow toward the pointer");
  await page.click("#shop-btn"); assert(await page.locator("#upgrade-screen").isVisible(), "real Tools button opens the shop");
  await page.click("#close-upgrades-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn"); assert((await debug(page, "snapshot")).state === "playing", "closing the shop resumes gameplay");
  await page.keyboard.press("Escape"); await page.waitForFunction(() => window.__whiteoutDebug.snapshot().state === "paused");
  assert((await debug(page, "snapshot")).state === "paused", "Escape opens the real pause menu");
  await page.click("#tutorial-pause-btn");
  assert((await debug(page, "snapshot")).tutorial.active && (await debug(page, "snapshot")).state === "playing", "pause menu can reopen the interface tutorial");
  for (let i = 0; i < 7; i++) await page.click("#tutorial-next");
  assert(!(await debug(page, "snapshot")).tutorial.active, "seven real Next clicks complete every registered tutorial step");
  await page.click("#pause-btn"); await debug(page, "save");
  const savedRaw = (await debug(page, "snapshot")).raw;
  await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => window.__GAME_READY__ && !!window.__whiteoutDebug, null, { timeout: 90000 });
  assert(await page.locator("#continue-btn").isVisible(), "browser-local save offers Continue after a real reload");
  await page.click("#continue-btn");
  assert(!(await debug(page, "snapshot")).cinematic.active && !(await debug(page, "snapshot")).tutorial.active && Math.abs((await debug(page, "snapshot")).raw - savedRaw) < 0.01, "Continue restores play without replaying completed opening or tutorial");

  await page.click("#settings-btn");
  const audioFiles = await page.evaluate(async () => Promise.all(["arctic-ambience.mp3", "quiet-aurora-loop.mp3", "snowglass-drift-loop.mp3", "polar-night-loop.mp3", "robot-repair-chime.mp3"].map(async (name) => {
    const response = await fetch(`assets/audio/${name}`); return { name, ok: response.ok, bytes: (await response.arrayBuffer()).byteLength };
  })));
  assert(audioFiles.every((file) => file.ok && file.bytes > 10000), "all five local audio files load successfully");
  for (const [track, file] of [["quiet-aurora", "quiet-aurora-loop.mp3"], ["snowglass-drift", "snowglass-drift-loop.mp3"], ["polar-night", "polar-night-loop.mp3"]]) {
    await page.selectOption("#set-music-track", track);
    await page.waitForFunction((file) => {
      const audio = window.__whiteoutDebug.audioState();
      return audio.music === file && audio.musicReady >= 2 && !audio.musicPaused && audio.musicLoop;
    }, file, { timeout: 10000 });
    const audio = await debug(page, "audioState");
    assert(audio.music === file && audio.musicReady >= 2 && !audio.musicPaused && audio.musicLoop, `${file} is loaded, ready, looping and playing after a real settings selection`);
  }
  const audio = await debug(page, "audioState");
  assert(audio.context === "running" && audio.ambienceReady >= 2 && !audio.ambiencePaused && audio.repairReady >= 2 && audio.ambience === "arctic-ambience.mp3", "Web Audio, arctic ambience and repair chime are integrated and ready");
  await page.selectOption("#set-music-track", "none");
  assert((await debug(page, "audioState")).musicPaused && !(await debug(page, "audioState")).ambiencePaused, "music None stops only music and leaves ambience playing");
  await page.click("#close-settings-btn"); if (await page.locator("#resume-btn").isVisible()) await page.click("#resume-btn");
  await context.close();
  if (process.env.JOURNEY_DESKTOP_ONLY === "1") {
    assert(errors.length === 0, `zero browser, console and asset errors across the desktop journey (${errors.join(" | ")})`);
    console.log("JOURNEY VERIFY OK: cinematic, tutorial, keyboard, mouse, persistence and audio");
  } else {
  const mobile = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const mp = await mobile.newPage(); mp.setDefaultTimeout(30000); watch(mp);
  await mp.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: "en", quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1 }));
    localStorage.setItem("whiteout.interface-tutorial.v1", JSON.stringify({ version: 1, complete: true }));
  });
  await ready(mp); await mp.tap("#start-btn"); await mp.tap("#skip-cinematic");
  assert(await mp.locator("#touch-controls").isVisible(), "landscape touch device shows joystick and action controls");
  const cdp = await mobile.newCDPSession(mp);
  const stick = await mp.locator("#move-stick").boundingBox();
  const sx = stick.x + stick.width / 2, sy = stick.y + stick.height / 2;
  const mobileBefore = await mp.evaluate(() => window.__gameProbe());
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: sx + stick.width * 0.28, y: sy, id: 1 }] });
  await mp.waitForTimeout(700);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const mobileAfter = await mp.evaluate(() => window.__gameProbe());
  assert(mobileAfter.x > mobileBefore.x + 0.1, "real touch drag on the joystick moves the character");
  await debug(mp, "setRaw", 0);
  const clear = await mp.locator("#touch-clear").boundingBox();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: clear.x + clear.width / 2, y: clear.y + clear.height / 2, id: 2 }] });
  await mp.waitForTimeout(850);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert((await debug(mp, "snapshot")).raw > 0, "real touch hold on Clear gathers snow");
  const charges = (await debug(mp, "snapshot")).radarCharges;
  const scan = await mp.locator("#touch-scan").boundingBox();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: scan.x + scan.width / 2, y: scan.y + scan.height / 2, id: 3 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await mp.waitForFunction((before) => window.__whiteoutDebug.snapshot().radarCharges === before - 1, charges);
  assert((await debug(mp, "snapshot")).radarCharges === charges - 1, "real touch Scan button consumes a scanner charge");
  // Mobile WebGL compositor screenshots can stall under SwiftShader; the
  // separately captured landscape/portrait frames are visually reviewed.
  console.log("PASS: mobile landscape input flow complete");
  await mp.setViewportSize({ width: 390, height: 844 }); await mp.waitForTimeout(400);
  assert((await debug(mp, "snapshot")).state === "paused" && !(await mp.locator("#touch-controls").isVisible()), "rotating to portrait safely pauses and hides gameplay touch controls");
  assert(await mp.locator("#orientation-lock").isVisible(), "portrait orientation presents the dedicated rotate-to-landscape screen");
  await mp.setViewportSize({ width: 844, height: 390 }); await mp.waitForTimeout(250); await mp.tap("#resume-btn");
  assert((await debug(mp, "snapshot")).state === "playing" && await mp.locator("#touch-controls").isVisible(), "returning to landscape resumes functional touch play");
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert(!overflow, "mobile landscape interface has no horizontal page overflow");
  await mobile.close();
  assert(errors.length === 0, `zero browser, console and asset errors across desktop and touch journeys (${errors.join(" | ")})`);
  console.log("JOURNEY VERIFY OK: cinematic, tutorial, keyboard, mouse, persistence, audio and real touch input");
  }
} finally {
  await browser.close(); server.close();
}
