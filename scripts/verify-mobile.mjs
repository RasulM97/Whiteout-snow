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
  assert(errors.length === 0, `zero browser, console and asset errors across the touch journey (${errors.join(" | ")})`);
  console.log("MOBILE VERIFY OK: real touch joystick, clearing, scanner, rotation, resume and layout");
} finally {
  await browser.close(); server.close();
}
