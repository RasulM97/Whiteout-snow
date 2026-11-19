/**
 * Phase 10 UI checks and screenshots. Serves dist/ and blocks outside requests.
 * Portrait frames are desktop emulation, not a physical touchscreen.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const SHOTS = "D:/Game/app/phase10-shots";
mkdirSync(SHOTS, { recursive: true });
if (!existsSync(join(DIST, "index.html"))) { console.error("build dist first"); process.exit(1); }
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".mp3": "audio/mpeg", ".webm": "audio/webm", ".txt": "text/plain", ".md": "text/markdown" };
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
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
for (const executablePath of [process.env.CHROMIUM_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe"].filter(Boolean)) {
  try { browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }); break; } catch { /* next */ }
}
if (!browser) { server.close(); throw new Error("Chrome was not found"); }
const notes = { origin, external: [], shots: [], checks: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); notes.checks.push(message); console.log("PASS:", message); };

async function openPage(context, language) {
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith("blob:") || url.startsWith("data:")) route.continue();
    else { notes.external.push(url); route.abort(); }
  });
  await page.addInitScript((lang) => {
    localStorage.removeItem("whiteout.career-v2");
    localStorage.setItem("whiteout.settings-v2", JSON.stringify({ language: lang, quality: "low", volume: 0, muted: true, cameraShake: false, particles: false, uiScale: 1 }));
  }, language);
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME_READY__ === true);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  return page;
}
async function shot(page, name) {
  const path = join(SHOTS, name);
  await page.screenshot({ path, animations: "disabled" });
  notes.shots.push(path);
}
async function layout(page) {
  return page.evaluate(() => {
    const box = (sel) => { const el = document.querySelector(sel); if (!el || el.closest(".hidden") || getComputedStyle(el).display === "none") return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const buttons = [...document.querySelectorAll("#ui-overlay .icon-btn, #ui-overlay .small-action, #ui-overlay .primary-btn, #ui-overlay .secondary-btn, #ui-overlay .buy-btn, #ui-overlay .battery-btn, #ui-overlay .power-note, #touch-clear, #touch-scan, #touch-interact")].filter((el) => getComputedStyle(el).display !== "none" && !el.closest(".hidden") && el.getClientRects().length).map((el) => { const r = el.getBoundingClientRect(); return { id: el.id || el.className, w: r.width, h: r.height }; });
    const questText = getComputedStyle(document.querySelector("#quest-desc") || document.body).display;
    return {
      quest: box(".quest-card"), tool: box(".tool-chip"), resource: box(".resource-card"),
      heat: document.querySelector("#heat-text")?.textContent || "",
      questText, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      buttons, dir: document.documentElement.dir,
      banner: box("#orientation-lock"),
    };
  });
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  for (const language of ["en", "fa", "zh"]) {
    const page = await openPage(desktop, language);
    await shot(page, `${language}-1280-title.png`);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await shot(page, `${language}-1920-title.png`);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => window.__whiteoutDebug.start());
    await page.waitForTimeout(300);
    let hud = await layout(page);
    assert(hud.quest && hud.resource && hud.quest.left < hud.resource.left && hud.quest.bottom <= hud.tool.top + 1, `${language} 1280 keeps mission left of resources and above the tool`);
    assert(!hud.overflow, `${language} 1280 has no horizontal overflow`);
    assert(hud.buttons.filter((b) => b.h < 44 && b.w > 0).length === 0, `${language} 1280 visible buttons are at least 44px tall`);
    await shot(page, `${language}-1280-hud.png`);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(200);
    hud = await layout(page);
    assert(hud.quest.left < hud.resource.left && hud.quest.bottom <= hud.tool.top + 1, `${language} 1366 keeps the same panel order`);
    await shot(page, `${language}-1366-hud.png`);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(200);
    await shot(page, `${language}-1920-hud.png`);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => window.__whiteoutDebug.openUpgrades());
    await page.waitForTimeout(200);
    await shot(page, `${language}-1280-tools.png`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    assert(await page.locator("#upgrade-screen").isHidden() || !(await page.locator("#upgrade-screen").isVisible()), `${language} Escape leaves the tool shop`);
    await page.evaluate(() => window.__whiteoutDebug.storm(true));
    await page.waitForTimeout(200);
    await shot(page, `${language}-1280-storm.png`);
    await page.click("#settings-btn");
    await shot(page, `${language}-1280-settings.png`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    assert((await page.evaluate(() => window.__whiteoutDebug.snapshot().state)) === "playing", `${language} Escape cancels settings and returns to play`);
    await page.evaluate(() => window.__whiteoutDebug.win());
    await page.waitForSelector("#end-screen:not(.hidden)");
    await shot(page, `${language}-1280-victory.png`);
    await page.close();
  }
  await desktop.close();

  const touch = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  for (const language of ["en", "fa", "zh"]) {
    const page = await openPage(touch, language);
    await shot(page, `${language}-844-title.png`);
    await page.evaluate(() => window.__whiteoutDebug.start());
    await page.waitForTimeout(300);
    let hud = await layout(page);
    assert(hud.quest && hud.resource && hud.quest.left < hud.resource.left, `${language} 844 keeps mission left of resources`);
    assert(hud.questText !== "none", `${language} 844 still shows the mission text`);
    assert(!hud.overflow, `${language} 844 has no horizontal overflow`);
    const clear = await page.locator("#touch-clear").boundingBox();
    assert(clear && clear.width >= 44 && clear.height >= 44, `${language} gather control is at least 44px`);
    await shot(page, `${language}-844-hud.png`);
    await page.setViewportSize({ width: 932, height: 430 });
    await page.waitForTimeout(200);
    await shot(page, `${language}-932-hud.png`);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(200);
    await shot(page, `${language}-1024-hud.png`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const banner = await page.locator("#orientation-lock").boundingBox();
    const state = await page.evaluate(() => window.__whiteoutDebug.snapshot().state);
    assert(state === "playing" && banner && banner.height < 180 && banner.y < 100, `${language} portrait recommendation does not block play`);
    await shot(page, `${language}-390-portrait.png`);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(200);
    await shot(page, `${language}-768-portrait.png`);
    await page.close();
  }
  await touch.close();
  assert(notes.external.length === 0, "screenshots did not request a font or asset CDN");
  writeFileSync("D:/Game/reports/phase10-ui.json", JSON.stringify(notes, null, 2));
  console.log(`PASS phase10 shots ${notes.shots.length}`);
} finally {
  await browser.close();
  server.close();
}
